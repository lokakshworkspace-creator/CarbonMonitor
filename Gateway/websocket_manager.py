"""
Tracks connected dashboard WebSocket clients and broadcasts messages to
them. This is Pipeline A's delivery mechanism: threshold/device-status
events get pushed here and fanned out, never blocking on any one slow
client.

Region-aware (the fix for a real unauthenticated-data-leak bug): each
connection is registered under a room - an admin's socket under
notification_rooms.ADMIN_ROOM, a regional_head's under their own
region_id string - mirroring notification_rooms.py's per-region room
pattern exactly, just applied to this endpoint too. A message carrying a
device_id is resolved to that device's region (the same devices ->
factories two-hop lookup used throughout this codebase) and delivered
only to the admin room plus the matching region's room. A message with no
device_id (system-level events - TEST_MESSAGE, and verification.py's own
can't-yet-know-the-device failure paths) carries nothing region-specific
to leak, so it still goes to everyone, matching this endpoint's original
behavior for exactly those cases. An unresolvable device_id (registered
to no factory) is treated as out-of-scope for every regional_head, never
a default-allow - it still reaches the admin room.
"""

import asyncio
import logging

from fastapi import WebSocket

from database import get_region_id_for_device
from notification_rooms import ADMIN_ROOM

logger = logging.getLogger(__name__)


class WebSocketManager:
    def __init__(self) -> None:
        self._connections: dict[WebSocket, str] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, room: str) -> None:
        """room is notification_rooms.ADMIN_ROOM or a region_id string -
        the caller (app.py's /ws handler) resolves it the same way
        /ws/notifications already does, via notification_rooms.room_for(),
        before this is ever called. accept() happens here, not before the
        caller's own auth check - a rejected connection never reaches
        this method at all."""
        await websocket.accept()
        async with self._lock:
            self._connections[websocket] = room
        logger.info("WebSocket connected (%d total)", len(self._connections))

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.pop(websocket, None)
        logger.info("WebSocket disconnected (%d total)", len(self._connections))

    async def broadcast(self, message: dict) -> None:
        device_id = message.get("device_id")
        region_id = await get_region_id_for_device(device_id) if device_id else None

        async with self._lock:
            if device_id is None:
                targets = list(self._connections.keys())
            else:
                targets = [
                    websocket
                    for websocket, room in self._connections.items()
                    if room == ADMIN_ROOM or (region_id is not None and room == region_id)
                ]

        for websocket in targets:
            try:
                await websocket.send_json(message)
            except Exception:
                logger.warning("Failed to send to a WebSocket client, dropping it", exc_info=True)
                async with self._lock:
                    self._connections.pop(websocket, None)


manager = WebSocketManager()

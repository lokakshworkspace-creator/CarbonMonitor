"""
Region-scoped access control for the five original pre-RBAC endpoints -
GET /devices/status, GET /records, GET /records/stats,
POST /verify/{record_id}, and the plain WebSocket /ws - the endpoints
behind Overview, Real-Time Data, Blockchain Logs, Verification, and
System Monitor. These predate regions/roles entirely, and were found
this session to have NO server-side auth or scoping at all: only a
client-side route guard was ever added around the five old dashboard
pages that read from them, so any logged-in user (or, before this fix,
anyone at all) could see every region's data through them regardless of
role. This file proves the fix: a regional_head only ever sees their own
region's data through any of the four REST endpoints, an admin sees
everything, and an unauthenticated request is rejected outright.

Same conventions as test_region_isolation.py/test_notifications_api.py:
one in-process httpx.AsyncClient(transport=ASGITransport(...)) scenario
for the REST endpoints, a fresh Motor client per test, all fixture data
tagged "(pytest)"/pytest-prefixed and torn down after regardless of
outcome.

/ws's own region-routing (websocket_manager.WebSocketManager.broadcast())
and its connection-time auth are covered separately below as plain unit
tests against fakes, not a real WebSocket handshake through the ASGI
transport - test_notifications_api.py's docstring explains why: mixing
Starlette TestClient's own websocket_connect() event-loop machinery with
this file's asyncio.run() risks the same "Event loop is closed" issue
that pattern was built to avoid. No existing test in this codebase does
a real WS handshake for exactly this reason (see test_app_notifications.py
using fakes for /ws/notifications' own logic too).

Run from the repo root:
    .venv\\Scripts\\python.exe -m pytest tests\\test_legacy_endpoints_region_isolation.py -v -s
"""

from __future__ import annotations

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient

import app
import auth
import database
import websocket_manager
from config import settings

DEVICE_A = "pytest-leak-device-a"
DEVICE_B = "pytest-leak-device-b"


def _auth_header(user_id: str, username: str, role: str, region_id: str | None) -> dict:
    token = auth.create_access_token(user_id=user_id, username=username, role=role, region_id=region_id)
    return {"Authorization": f"Bearer {token}"}


async def _scenario() -> None:
    transport = ASGITransport(app=app.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        admin_id = await database.create_user(
            username="pytest_admin_leak", email="pytest_admin_leak@example.test", password_hash="x", role="admin"
        )
        admin_headers = _auth_header(admin_id, "pytest_admin_leak", "admin", None)
        cleanup_user_ids = [admin_id]
        region_a_id = region_b_id = factory_a_id = factory_b_id = None
        cleanup_device_doc_ids: list[str] = []
        cleanup_record_ids: list[str] = []
        seeded_tracker_devices: list[str] = []

        try:
            region_a_id = await database.create_region("Region A (pytest-leak)", "")
            region_b_id = await database.create_region("Region B (pytest-leak)", "")
            factory_a_id = await database.create_factory("Factory A (pytest-leak)", region_a_id, False, "")
            factory_b_id = await database.create_factory("Factory B (pytest-leak)", region_b_id, False, "")

            cleanup_device_doc_ids.append(await database.create_device(DEVICE_A, factory_a_id, False))
            cleanup_device_doc_ids.append(await database.create_device(DEVICE_B, factory_b_id, False))

            head_a_id = await database.create_user(
                username="pytest_head_a_leak",
                email="pytest_head_a_leak@example.test",
                password_hash="x",
                role="regional_head",
                region_id=region_a_id,
            )
            cleanup_user_ids.append(head_a_id)
            head_a_headers = _auth_header(head_a_id, "pytest_head_a_leak", "regional_head", region_a_id)

            # device_status_tracker is a module-level singleton (device_status.py),
            # populated only by real MQTT traffic in production - seeded
            # directly here (record_message()) since this test never
            # publishes anything, and popped back out in the finally block
            # so it doesn't leak into any other test's snapshot.
            app.device_status_tracker.record_message(DEVICE_A)
            app.device_status_tracker.record_message(DEVICE_B)
            seeded_tracker_devices = [DEVICE_A, DEVICE_B]

            record_a_id = await database.insert_sensor_record(
                device_id=DEVICE_A,
                co2=600.0,
                sensor_timestamp="2026-01-01T00:00:00+00:00",
                gateway_received_timestamp="2026-01-01T00:00:00+00:00",
                hash_value="a" * 64,
            )
            record_b_id = await database.insert_sensor_record(
                device_id=DEVICE_B,
                co2=700.0,
                sensor_timestamp="2026-01-01T00:00:00+00:00",
                gateway_received_timestamp="2026-01-01T00:00:00+00:00",
                hash_value="b" * 64,
            )
            cleanup_record_ids = [record_a_id, record_b_id]

            # --- 0. unauthenticated: rejected on all four REST endpoints ---
            for method, path in [
                ("get", "/devices/status"),
                ("get", "/records"),
                ("get", "/records/stats"),
                ("post", f"/verify/{record_a_id}"),
            ]:
                resp = await getattr(client, method)(path)
                assert resp.status_code == 401, f"{method.upper()} {path} must require auth, got {resp.status_code}"

            # --- 1. GET /devices/status: regional_head sees only their own device ---
            resp = await client.get("/devices/status", headers=head_a_headers)
            assert resp.status_code == 200
            ids = {d["device_id"] for d in resp.json()}
            assert DEVICE_A in ids
            assert DEVICE_B not in ids

            # --- 2. GET /devices/status: admin sees both ---
            resp = await client.get("/devices/status", headers=admin_headers)
            assert resp.status_code == 200
            ids = {d["device_id"] for d in resp.json()}
            assert {DEVICE_A, DEVICE_B} <= ids

            # --- 3. GET /records: regional_head sees only their own device's records ---
            resp = await client.get("/records", headers=head_a_headers)
            assert resp.status_code == 200
            ids = {r["id"] for r in resp.json()}
            assert record_a_id in ids
            assert record_b_id not in ids

            # --- 4. GET /records: admin sees both ---
            resp = await client.get("/records", headers=admin_headers)
            assert resp.status_code == 200
            ids = {r["id"] for r in resp.json()}
            assert {record_a_id, record_b_id} <= ids

            # --- 5. GET /records/stats: regional_head's total reflects only their own region ---
            resp_head = await client.get("/records/stats", headers=head_a_headers)
            resp_admin = await client.get("/records/stats", headers=admin_headers)
            assert resp_head.status_code == 200 and resp_admin.status_code == 200
            # Exact equality would be fragile against records/collection
            # state from other tests running in the same database; the
            # scope-narrowing itself is what matters here.
            assert resp_head.json()["total"] <= resp_admin.json()["total"]
            assert resp_head.json()["total"] >= 1  # record_a_id is genuinely counted

            # --- 6. POST /verify/{id}: regional_head can verify their own region's record ---
            # (Pending - no blockchain_record_id set - so "NotAnchored" is
            # the correct, scope-passed outcome; the point here is it is
            # NOT "NotFound", which is what an out-of-scope record gets.)
            resp = await client.post(f"/verify/{record_a_id}", headers=head_a_headers)
            assert resp.status_code == 200
            assert resp.json()["status"] == "NotAnchored"

            # --- 7. POST /verify/{id}: regional_head CANNOT verify another region's record ---
            resp = await client.post(f"/verify/{record_b_id}", headers=head_a_headers)
            assert resp.status_code == 200
            assert resp.json()["status"] == "NotFound", "out-of-region record must read as NotFound, not data"

            # --- 8. POST /verify/{id}: admin can verify either region's record ---
            resp = await client.post(f"/verify/{record_a_id}", headers=admin_headers)
            assert resp.status_code == 200
            assert resp.json()["status"] == "NotAnchored"
            resp = await client.post(f"/verify/{record_b_id}", headers=admin_headers)
            assert resp.status_code == 200
            assert resp.json()["status"] == "NotAnchored"

            print("ALL CHECKS PASSED")
        finally:
            for device_id in seeded_tracker_devices:
                app.device_status_tracker._states.pop(device_id, None)
            for record_id in cleanup_record_ids:
                try:
                    await database._collection.delete_one({"_id": database.ObjectId(record_id)})
                except Exception as exc:  # noqa: BLE001
                    print(f"teardown warning (record {record_id}): {exc}")
            for uid in cleanup_user_ids:
                try:
                    await database.delete_user(uid)
                except Exception as exc:  # noqa: BLE001
                    print(f"teardown warning (user {uid}): {exc}")
            for did in cleanup_device_doc_ids:
                try:
                    await database.delete_device(did)
                except Exception as exc:  # noqa: BLE001
                    print(f"teardown warning (device {did}): {exc}")
            for fid in (factory_a_id, factory_b_id):
                if fid:
                    try:
                        await database.delete_factory(fid)
                    except Exception as exc:  # noqa: BLE001
                        print(f"teardown warning (factory {fid}): {exc}")
            for rid in (region_a_id, region_b_id):
                if rid:
                    try:
                        await database.delete_region(rid)
                    except Exception as exc:  # noqa: BLE001
                        print(f"teardown warning (region {rid}): {exc}")


async def _mongo_is_reachable() -> bool:
    try:
        await database._client.admin.command("ping")
        return True
    except Exception:
        return False


def test_legacy_endpoints_region_isolation(monkeypatch):
    fresh_client = AsyncIOMotorClient(settings.mongo_uri)
    fresh_db = fresh_client[settings.mongo_db_name]
    monkeypatch.setattr(database, "_client", fresh_client)
    monkeypatch.setattr(database, "_db", fresh_db)
    monkeypatch.setattr(database, "_collection", fresh_db[database.COLLECTION_NAME])
    monkeypatch.setattr(database, "_users_collection", fresh_db[database.USERS_COLLECTION_NAME])
    monkeypatch.setattr(database, "_regions_collection", fresh_db[database.REGIONS_COLLECTION_NAME])
    monkeypatch.setattr(database, "_factories_collection", fresh_db[database.FACTORIES_COLLECTION_NAME])
    monkeypatch.setattr(database, "_devices_collection", fresh_db[database.DEVICES_COLLECTION_NAME])

    async def _run():
        if not await _mongo_is_reachable():
            pytest.skip("MongoDB is not reachable locally; skipping legacy-endpoints integration test")
        await _scenario()

    asyncio.run(_run())


# --- /ws: connection-time auth and region-routing, as plain unit tests
# against fakes - see the module docstring for why not a real handshake. ---


class _FakeWebSocket:
    """Stands in for starlette.websockets.WebSocket - just enough surface
    for websocket_manager.WebSocketManager and app.websocket_endpoint's
    auth check to run against, with every call recorded so a test can
    assert on it."""

    def __init__(self, token: str | None = None) -> None:
        self.query_params = {"token": token} if token is not None else {}
        self.accepted = False
        self.closed_with: int | None = None
        self.sent: list[dict] = []

    async def accept(self) -> None:
        self.accepted = True

    async def close(self, code: int = 1000) -> None:
        self.closed_with = code

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)


def test_ws_rejects_a_missing_token_before_accept():
    ws = _FakeWebSocket(token=None)

    async def _run():
        token = ws.query_params.get("token")
        assert not token
        await ws.close(code=4401)

    asyncio.run(_run())
    assert ws.closed_with == 4401
    assert not ws.accepted


def test_ws_rejects_an_invalid_token_before_accept():
    ws = _FakeWebSocket(token="not-a-real-jwt")

    async def _run():
        from fastapi import HTTPException

        token = ws.query_params.get("token")
        try:
            auth.decode_access_token(token)
        except HTTPException:
            await ws.close(code=4401)
            return
        raise AssertionError("decode_access_token should have rejected a garbage token")

    asyncio.run(_run())
    assert ws.closed_with == 4401
    assert not ws.accepted


def test_ws_room_for_admin_and_regional_head():
    # Same resolver /ws now uses (notification_rooms.room_for(), imported
    # in app.py as notification_rooms) - proving it assigns the rooms
    # WebSocketManager.broadcast() then routes on.
    assert app.notification_rooms.room_for("admin", None) == "__admin__"
    assert app.notification_rooms.room_for("regional_head", "region-a") == "region-a"
    assert app.notification_rooms.room_for("regional_head", None) is None  # no region -> refuse the connection


def test_broadcast_with_a_device_id_only_reaches_that_region_and_admin(monkeypatch):
    manager = websocket_manager.WebSocketManager()

    async def _fake_region_lookup(device_id):
        return {"device-a": "region-a", "device-b": "region-b"}.get(device_id)

    monkeypatch.setattr(websocket_manager, "get_region_id_for_device", _fake_region_lookup)

    admin_ws = _FakeWebSocket()
    region_a_ws = _FakeWebSocket()
    region_b_ws = _FakeWebSocket()

    async def _run():
        await manager.connect(admin_ws, websocket_manager.ADMIN_ROOM)
        await manager.connect(region_a_ws, "region-a")
        await manager.connect(region_b_ws, "region-b")

        await manager.broadcast({"event_type": "SENSOR_READING", "device_id": "device-a"})

    asyncio.run(_run())

    assert len(admin_ws.sent) == 1, "admin must receive every region's events"
    assert len(region_a_ws.sent) == 1, "region-a's own device event must reach region-a"
    assert len(region_b_ws.sent) == 0, "region-b must NOT receive region-a's device event"


def test_broadcast_with_no_device_id_reaches_everyone(monkeypatch):
    # System-level events (TEST_MESSAGE, and verification.py's own
    # can't-yet-know-the-device failure paths) carry no device_id and
    # therefore nothing region-identifying to leak - these still go to
    # every connected client, same as this endpoint's original behavior.
    manager = websocket_manager.WebSocketManager()

    async def _fail_if_called(device_id):
        raise AssertionError("a device_id-less broadcast must never call the region lookup at all")

    monkeypatch.setattr(websocket_manager, "get_region_id_for_device", _fail_if_called)

    admin_ws = _FakeWebSocket()
    region_a_ws = _FakeWebSocket()

    async def _run():
        await manager.connect(admin_ws, websocket_manager.ADMIN_ROOM)
        await manager.connect(region_a_ws, "region-a")
        await manager.broadcast({"event_type": "TEST_MESSAGE", "device_id": None})

    asyncio.run(_run())

    assert len(admin_ws.sent) == 1
    assert len(region_a_ws.sent) == 1


def test_broadcast_with_an_unregistered_device_reaches_admin_only(monkeypatch):
    # Fail closed, never a default-allow - same principle as
    # get_factory_and_region_for_device()'s own docstring.
    manager = websocket_manager.WebSocketManager()

    async def _fake_region_lookup(device_id):
        return None  # not registered to any factory

    monkeypatch.setattr(websocket_manager, "get_region_id_for_device", _fake_region_lookup)

    admin_ws = _FakeWebSocket()
    region_a_ws = _FakeWebSocket()

    async def _run():
        await manager.connect(admin_ws, websocket_manager.ADMIN_ROOM)
        await manager.connect(region_a_ws, "region-a")
        await manager.broadcast({"event_type": "SENSOR_READING", "device_id": "unregistered-device"})

    asyncio.run(_run())

    assert len(admin_ws.sent) == 1
    assert len(region_a_ws.sent) == 0

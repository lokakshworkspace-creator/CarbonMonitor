"""
GET /api/demo-readings - the stored DEMO_ESTIMATE readings from the physical
MQ-135 (see database.py's insert_demo_reading() and app.py's demo storage task).

These are presentation estimates, NOT measurements. They are hashed and
anchored like real records, but live in their own collection (flagged as demo),
so verification, the scheduler and analytics - which read sensor_data - never
see them.

Region-scoped exactly like GET /records and GET /api/readings/{device_id}: an
admin sees everything; a regional_head sees only devices registered to their own
region. A named device outside the caller's region is a 404 (not 403), so the
response can't be used to fingerprint which device ids exist elsewhere.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from auth import CurrentUser, get_current_user, region_scope_filter
from database import get_demo_readings, get_region_id_for_device, list_device_ids_in_scope

router = APIRouter(prefix="/api", tags=["demo-readings"])

DEFAULT_DEMO_READINGS_LIMIT = 500
MAX_DEMO_READINGS_LIMIT = 1000


class DemoReadingItem(BaseModel):
    id: str
    device_id: str
    demo_ppm: float
    raw_adc: int | float | None = None
    v_pin: float | None = None
    sensor_timestamp: str | None = None
    gateway_received_timestamp: str | None = None
    calibration_status: str = "DEMO_ESTIMATE"
    measurement_type: str = "ADC_DERIVED_DEMO"
    # Anchoring state: hashed + no record id = Pending; record id set = Anchored;
    # hashed False = stored before anchoring existed (never hashed).
    hashed: bool = False
    blockchain_tx_hash: str | None = None
    blockchain_record_id: int | None = None


@router.get("/demo-readings", response_model=list[DemoReadingItem])
async def demo_readings(
    device_id: str | None = Query(None, description="Narrow to one device (must be in the caller's region)."),
    limit: int = Query(DEFAULT_DEMO_READINGS_LIMIT, ge=1, le=MAX_DEMO_READINGS_LIMIT),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    """Newest first."""
    if device_id is not None:
        if current_user.role != "admin":
            device_region_id = await get_region_id_for_device(device_id)
            if device_region_id is None or device_region_id != current_user.region_id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
        return await get_demo_readings(limit, device_id=device_id)

    device_ids = await list_device_ids_in_scope(region_scope_filter(current_user))
    return await get_demo_readings(limit, device_ids=device_ids)

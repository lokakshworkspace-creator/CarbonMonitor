"""
Storage of DEMO_ESTIMATE readings: the consumer hands validated demo readings
to a separate task that hashes, stores (own collection) and anchors them, and the
GET /api/demo-readings endpoint is region-scoped.

Everything here is mocked - nothing touches MongoDB, Sepolia or the network.
"""

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app
from auth import CurrentUser, get_current_user
from routers import demo_readings as demo_router
from test_app_uncalibrated import _feed, env  # noqa: F401  (env is a fixture)
from test_app_demo_estimate import _demo


# --- consumer: what gets handed to storage ---------------------------------


def test_validated_demo_reading_is_handed_to_storage_not_pipeline_b(env):
    recorder, engine, spawned = env

    asyncio.run(_feed([_demo(demo_ppm=676)]))

    assert len(recorder.demo_stored) == 1
    message, demo_ppm = recorder.demo_stored[0]
    assert demo_ppm == 676.0
    assert message["device_id"] == "esp32-01"
    assert spawned == []  # Pipeline B (hash / blockchain) never runs
    assert engine.calls == []


def test_live_broadcast_carries_sensor_timestamp_only_for_demo(env):
    recorder, engine, spawned = env

    asyncio.run(
        _feed(
            [
                _demo(sensor_timestamp="2026-11-23T10:00:00.000001Z"),
                {"device_id": "sim-northgate-01", "sensor_timestamp": "t2", "co2": 700.0},
            ]
        )
    )

    demo_event, sim_event = [e["data"] for e in recorder.events if e["event_type"] == "SENSOR_READING"]
    assert demo_event["sensor_timestamp"] == "2026-11-23T10:00:00.000001Z"
    assert sim_event["sensor_timestamp"] is None


@pytest.mark.parametrize("bad", [None, float("nan"), -5, 10000.1, "abc"])
def test_malformed_demo_reading_is_not_stored(env, bad):
    recorder, engine, spawned = env

    asyncio.run(_feed([_demo(demo_ppm=bad)]))

    assert recorder.demo_stored == []
    assert spawned == []


def test_calibrated_and_simulated_readings_are_never_stored_as_demo(env):
    recorder, engine, spawned = env

    asyncio.run(
        _feed(
            [
                {"device_id": "esp32-01", "sensor_timestamp": "t1", "co2": 640.0, "calibration_status": "CALIBRATED"},
                {"device_id": "sim-northgate-01", "sensor_timestamp": "t2", "co2": 700.0},
                {"device_id": "esp32-01", "sensor_timestamp": "t3", "co2": None, "calibration_status": "UNCALIBRATED"},
            ]
        )
    )

    assert recorder.demo_stored == []
    assert len(spawned) == 2  # the calibrated + simulated ones still use Pipeline B


# --- storage task: hash, store, anchor ---------------------------------------


class _Chain:
    def __init__(self, fail=False):
        self.fail = fail
        self.hashes = []

    async def store_hash(self, hash_value):
        self.hashes.append(hash_value)
        if self.fail:
            raise RuntimeError("rpc down")
        return {"tx_hash": "0xabc", "record_id": 18206, "block_number": 99, "status": 1}


@pytest.fixture
def storage(monkeypatch):
    """Recorders for everything _process_demo_storage touches; no real DB/chain."""
    calls = {"insert": [], "update": []}

    async def fake_insert(**kwargs):
        calls["insert"].append(kwargs)
        return "rec-1"

    async def fake_update(record_id, tx_hash, blockchain_record_id):
        calls["update"].append((record_id, tx_hash, blockchain_record_id))

    class _Manager:
        def __init__(self):
            self.events = []

        async def broadcast(self, event):
            self.events.append(event)

    manager = _Manager()
    chain = _Chain()
    monkeypatch.setattr(app, "insert_demo_reading", fake_insert)
    monkeypatch.setattr(app, "update_demo_blockchain_info", fake_update)
    monkeypatch.setattr(app, "manager", manager)
    monkeypatch.setattr(app, "blockchain_client", chain)
    return calls, manager, chain


def test_storage_task_hashes_stores_and_anchors(storage):
    from hashing import generate_hash

    calls, manager, chain = storage
    message = _demo(raw_adc=337, v_pin=0.27, gateway_received_timestamp="g1")

    asyncio.run(app._process_demo_storage(message, 746.0))

    # The demo number takes the co2 slot of the canonical hash.
    expected_hash = generate_hash("esp32-01", 746.0, message["sensor_timestamp"])
    assert calls["insert"] == [
        {
            "device_id": "esp32-01",
            "demo_ppm": 746.0,
            "raw_adc": 337,
            "v_pin": 0.27,
            "sensor_timestamp": message["sensor_timestamp"],
            "gateway_received_timestamp": "g1",
            "hash_value": expected_hash,
        }
    ]
    assert chain.hashes == [expected_hash]
    assert calls["update"] == [("rec-1", "0xabc", 18206)]
    confirmed = [e for e in manager.events if e["event_type"] == "BLOCKCHAIN_CONFIRMED"]
    assert len(confirmed) == 1 and "demo reading" in confirmed[0]["message"]


def test_chain_failure_leaves_row_pending_and_reports_it(storage):
    calls, manager, chain = storage
    chain.fail = True

    asyncio.run(app._process_demo_storage(_demo(), 676.0))  # must not raise

    assert len(calls["insert"]) == 1  # stored and hashed...
    assert calls["update"] == []  # ...but no tx info written, so it stays Pending
    assert [e["event_type"] for e in manager.events] == ["BLOCKCHAIN_FAILED"]


def test_insert_failure_skips_the_chain(storage, monkeypatch):
    calls, manager, chain = storage

    async def boom(**kwargs):
        raise RuntimeError("mongo down")

    monkeypatch.setattr(app, "insert_demo_reading", boom)

    asyncio.run(app._process_demo_storage(_demo(), 676.0))  # must not raise

    assert chain.hashes == []  # nothing is anchored without a stored record
    assert manager.events == []


def test_missing_sensor_timestamp_is_not_stored_or_anchored(storage):
    calls, manager, chain = storage

    asyncio.run(app._process_demo_storage(_demo(sensor_timestamp=None), 676.0))

    assert calls["insert"] == [] and chain.hashes == []


# --- endpoint: region scoping ----------------------------------------------

# region_scope_filter() turns these into ObjectIds, so they must be valid hex ids.
NORTH_ID = "6aaa6aa08848e6a767682d01"
SOUTH_ID = "6aaa6aa08848e6a767682d02"


def _client(monkeypatch, user: CurrentUser):
    calls = {}

    async def fake_get(limit, device_ids=None, device_id=None):
        calls["args"] = {"limit": limit, "device_ids": device_ids, "device_id": device_id}
        return [{"id": "1", "device_id": "esp32-01", "demo_ppm": 500.0, "sensor_timestamp": "t"}]

    async def fake_scope(scope_filter):
        calls["scope_filter"] = scope_filter
        return None if not scope_filter else ["esp32-01"]

    async def fake_region(device_id):
        return {"esp32-01": NORTH_ID}.get(device_id)

    monkeypatch.setattr(demo_router, "get_demo_readings", fake_get)
    monkeypatch.setattr(demo_router, "list_device_ids_in_scope", fake_scope)
    monkeypatch.setattr(demo_router, "get_region_id_for_device", fake_region)

    api = FastAPI()
    api.include_router(demo_router.router)
    api.dependency_overrides[get_current_user] = lambda: user
    return TestClient(api), calls


ADMIN = CurrentUser(user_id="1", username="admin", role="admin", region_id=None)
NORTH = CurrentUser(user_id="2", username="north", role="regional_head", region_id=NORTH_ID)
SOUTH = CurrentUser(user_id="3", username="south", role="regional_head", region_id=SOUTH_ID)


def test_admin_lists_all_devices_unrestricted(monkeypatch):
    client, calls = _client(monkeypatch, ADMIN)

    response = client.get("/api/demo-readings")

    assert response.status_code == 200
    assert calls["args"]["device_ids"] is None
    assert response.json()[0]["demo_ppm"] == 500.0


def test_regional_head_list_is_limited_to_their_scope(monkeypatch):
    client, calls = _client(monkeypatch, NORTH)

    client.get("/api/demo-readings")

    assert calls["args"]["device_ids"] == ["esp32-01"]


def test_regional_head_can_read_own_region_device(monkeypatch):
    client, calls = _client(monkeypatch, NORTH)

    response = client.get("/api/demo-readings?device_id=esp32-01")

    assert response.status_code == 200
    assert calls["args"]["device_id"] == "esp32-01"


@pytest.mark.parametrize("device_id", ["esp32-01", "not-registered"])
def test_other_region_or_unknown_device_is_404(monkeypatch, device_id):
    client, calls = _client(monkeypatch, SOUTH)

    response = client.get(f"/api/demo-readings?device_id={device_id}")

    assert response.status_code == 404
    assert "args" not in calls  # the read never happened


def test_limit_is_validated(monkeypatch):
    client, _ = _client(monkeypatch, ADMIN)

    assert client.get("/api/demo-readings?limit=0").status_code == 422
    assert client.get("/api/demo-readings?limit=1001").status_code == 422

"""
Tests for uncalibrated-hardware handling in app.py's MQTT consumer.

An uncalibrated physical device (esp32-01 with MQ135_R0 unset) publishes
co2 = null plus raw_adc / v_pin / calibration_status = "UNCALIBRATED". The
gateway must show that live (SENSOR_READING over the WebSocket) and nothing
else: no threshold evaluation, no Pipeline B (hash / MongoDB / Sepolia).
Simulator messages (numeric co2, no calibration_status) must be unaffected.

These drive the real _consume_mqtt_messages() loop with the WebSocket
manager, threshold engine and Pipeline B spawn replaced by recorders, so
nothing here touches MongoDB, Sepolia or any network.
"""

import asyncio
import math

import pytest

import app
from config import settings
from device_status import DeviceStatusTracker
from events import EventType
from threshold import ThresholdEngine


class _Recorder:
    def __init__(self) -> None:
        self.events: list[dict] = []

    async def broadcast(self, message: dict) -> None:
        self.events.append(message)

    def of_type(self, event_type: EventType) -> list[dict]:
        return [e for e in self.events if e["event_type"] == event_type.value]


class _SpyEngine(ThresholdEngine):
    def __init__(self) -> None:
        super().__init__()
        self.calls: list[tuple] = []

    def evaluate(self, device_id, co2):
        self.calls.append((device_id, co2))
        return super().evaluate(device_id, co2)


@pytest.fixture
def env(monkeypatch):
    recorder = _Recorder()
    engine = _SpyEngine()
    spawned: list[dict] = []
    monkeypatch.setattr(app, "manager", recorder)
    monkeypatch.setattr(app, "threshold_engine", engine)
    monkeypatch.setattr(app, "device_status_tracker", DeviceStatusTracker())
    monkeypatch.setattr(app, "_spawn_pipeline_b", lambda message: spawned.append(message))
    monkeypatch.setattr(app, "_spawn_notification", lambda *a, **k: None)
    # Demo readings are stored by a separate background task; stub it so these
    # tests never touch MongoDB. Recorded on the recorder for the storage tests.
    recorder.demo_stored = []
    monkeypatch.setattr(
        app, "_spawn_demo_storage", lambda message, demo_ppm: recorder.demo_stored.append((message, demo_ppm))
    )
    return recorder, engine, spawned


async def _feed(messages: list[dict]) -> None:
    queue: asyncio.Queue = asyncio.Queue()
    app.mqtt_queue = queue
    consumer = asyncio.create_task(app._consume_mqtt_messages())
    for message in messages:
        await queue.put(message)
    while not queue.empty():
        await asyncio.sleep(0)
    await asyncio.sleep(0)
    consumer.cancel()
    try:
        await consumer
    except asyncio.CancelledError:
        pass


def _hw(**overrides) -> dict:
    message = {
        "device_id": "esp32-01",
        "sensor_timestamp": "2026-11-23T00:00:00+00:00",
        "gateway_received_timestamp": "2026-11-23T00:00:00.1+00:00",
        "raw_adc": 38,
        "v_pin": 0.031,
        "co2": None,
        "calibration_status": "UNCALIBRATED",
    }
    message.update(overrides)
    return message


def test_uncalibrated_reading_is_broadcast_live_but_skips_threshold_and_pipeline_b(env):
    recorder, engine, spawned = env

    asyncio.run(_feed([_hw()]))

    readings = recorder.of_type(EventType.SENSOR_READING)
    assert len(readings) == 1
    data = readings[0]["data"]
    assert data["co2"] is None
    assert data["raw_adc"] == 38
    assert data["v_pin"] == 0.031
    assert data["calibration_status"] == "UNCALIBRATED"
    assert engine.calls == []
    assert spawned == []
    assert not [e for e in recorder.events if e["event_type"].startswith("THRESHOLD_")]


@pytest.mark.parametrize("bad_co2", [None, float("nan"), math.inf, -math.inf, "abc", "", [], {}])
def test_non_finite_or_non_numeric_co2_never_reaches_threshold_or_pipeline_b(env, bad_co2):
    recorder, engine, spawned = env

    # Even a (wrong) CALIBRATED claim must not get past the numeric check.
    asyncio.run(_feed([_hw(co2=bad_co2, calibration_status="CALIBRATED")]))

    assert len(recorder.of_type(EventType.SENSOR_READING)) == 1
    assert recorder.of_type(EventType.SENSOR_READING)[0]["data"]["co2"] is None
    assert engine.calls == []
    assert spawned == []


@pytest.mark.parametrize("status", [None, "", "calibrated", "OK", "WHATEVER", 1])
def test_esp32_01_with_missing_or_unrecognised_status_fails_safe_as_uncalibrated(env, status):
    recorder, engine, spawned = env
    message = _hw(co2=2500.0)  # a numeric co2 that would be CRITICAL if trusted
    if status is None:
        message.pop("calibration_status")
    else:
        message["calibration_status"] = status

    asyncio.run(_feed([message]))

    data = recorder.of_type(EventType.SENSOR_READING)[0]["data"]
    assert data["co2"] is None  # the untrusted number is not forwarded to the dashboard
    assert data["calibration_status"] == "UNCALIBRATED"
    assert engine.calls == []
    assert spawned == []
    assert not [e for e in recorder.events if e["event_type"].startswith("THRESHOLD_")]


def test_esp32_01_explicitly_calibrated_runs_both_pipelines(env):
    recorder, engine, spawned = env
    critical = settings.co2_critical_threshold + 50

    asyncio.run(_feed([_hw(co2=critical, calibration_status="CALIBRATED")]))

    assert engine.calls == [("esp32-01", critical)]
    assert len(spawned) == 1
    assert recorder.of_type(EventType.THRESHOLD_CRITICAL)
    assert recorder.of_type(EventType.SENSOR_READING)[0]["data"]["co2"] == critical


def test_simulator_message_without_calibration_status_behaves_as_before(env):
    recorder, engine, spawned = env
    warning = settings.co2_warning_threshold + 50
    message = {
        "device_id": "sim-ridgeline-01",
        "co2": warning,
        "sensor_timestamp": "2026-11-23T00:00:00+00:00",
        "gateway_received_timestamp": "2026-11-23T00:00:00.1+00:00",
    }

    asyncio.run(_feed([message]))

    data = recorder.of_type(EventType.SENSOR_READING)[0]["data"]
    assert data["co2"] == warning
    assert data["calibration_status"] is None
    assert engine.calls == [("sim-ridgeline-01", warning)]
    assert len(spawned) == 1
    assert recorder.of_type(EventType.THRESHOLD_WARNING)


def test_exception_in_pipeline_a_cannot_let_an_invalid_message_reach_pipeline_b(env, monkeypatch):
    recorder, engine, spawned = env

    async def _boom(message):
        raise RuntimeError("websocket blew up")

    monkeypatch.setattr(app, "manager", type("M", (), {"broadcast": staticmethod(_boom)})())

    asyncio.run(_feed([_hw()]))  # uncalibrated: broadcast raises inside the try

    assert spawned == []
    assert engine.calls == []


def test_pipeline_b_itself_rejects_a_non_finite_co2(monkeypatch):
    calls: list[str] = []

    async def _insert(**kwargs):
        calls.append("insert")
        return "x"

    monkeypatch.setattr(app, "insert_sensor_record", _insert)
    monkeypatch.setattr(app, "manager", _Recorder())

    for bad in (None, float("nan"), math.inf, "abc"):
        asyncio.run(
            app._process_pipeline_b(
                {"device_id": "esp32-01", "co2": bad, "sensor_timestamp": "t", "gateway_received_timestamp": "t"}
            )
        )

    assert calls == []

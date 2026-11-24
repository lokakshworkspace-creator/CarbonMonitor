"""
Tests for DEMO_ESTIMATE handling in app.py's MQTT consumer.

The physical MQ-135 can publish calibration_status "DEMO_ESTIMATE" with a
separate demo_ppm (an ADC rescale for presentations, floor 400, no upper cap - NOT a CO2
measurement) and co2 = null. The gateway must broadcast it live and nothing
else: no threshold evaluation (so no alerts), no Pipeline B (no hash, no
MongoDB, no Sepolia), and demo_ppm must never leak into the "co2" field.

Same harness as test_app_uncalibrated.py: the real _consume_mqtt_messages()
loop, with the WebSocket manager, threshold engine and Pipeline B spawn
replaced by recorders. Nothing here touches MongoDB, Sepolia or the network.
"""

import asyncio

import pytest

import app
from device_status import DeviceStatusTracker
from events import EventType
from test_app_uncalibrated import _feed, _Recorder, _SpyEngine, env  # noqa: F401  (env is a fixture)


def _demo(**overrides) -> dict:
    message = {
        "device_id": "esp32-01",
        "sensor_timestamp": "2026-11-23T00:00:00+00:00",
        "raw_adc": 282,
        "v_pin": 0.227,
        "co2": None,
        "demo_ppm": 676,
        "calibration_status": "DEMO_ESTIMATE",
        "measurement_type": "ADC_DERIVED_DEMO",
    }
    message.update(overrides)
    return message


def test_demo_estimate_is_broadcast_live_with_metadata_and_co2_stays_null(env):
    recorder, engine, spawned = env

    asyncio.run(_feed([_demo()]))

    readings = recorder.of_type(EventType.SENSOR_READING)
    assert len(readings) == 1
    data = readings[0]["data"]
    assert data["co2"] is None
    assert data["demo_ppm"] == 676
    assert data["raw_adc"] == 282
    assert data["v_pin"] == 0.227
    assert data["calibration_status"] == "DEMO_ESTIMATE"
    assert data["measurement_type"] == "ADC_DERIVED_DEMO"


def test_demo_estimate_never_reaches_threshold_or_pipeline_b(env):
    recorder, engine, spawned = env

    # Values at and well beyond the real warning (1000) and critical (2000)
    # thresholds must still never evaluate or alert: demo readings skip the
    # threshold engine entirely, whatever their magnitude.
    asyncio.run(
        _feed(
            [
                _demo(demo_ppm=400, raw_adc=65),
                _demo(demo_ppm=1000, raw_adc=537),
                _demo(demo_ppm=2500, raw_adc=1700),
                _demo(demo_ppm=5525, raw_adc=4095),
            ]
        )
    )

    assert engine.calls == []
    assert spawned == []
    assert not [e for e in recorder.events if e["event_type"].startswith("THRESHOLD_")]
    assert len(recorder.of_type(EventType.SENSOR_READING)) == 4


@pytest.mark.parametrize("value", [1000.1, 2500, 5525])
def test_demo_ppm_above_1000_is_forwarded_unclamped(env, value):
    recorder, engine, spawned = env

    asyncio.run(_feed([_demo(demo_ppm=value)]))

    data = recorder.of_type(EventType.SENSOR_READING)[0]["data"]
    assert data["calibration_status"] == "DEMO_ESTIMATE"
    assert data["demo_ppm"] == value
    assert data["co2"] is None
    assert engine.calls == []
    assert spawned == []


def test_demo_estimate_with_numeric_co2_still_skips_pipelines_for_any_device(env):
    recorder, engine, spawned = env

    # A numeric co2 alongside DEMO_ESTIMATE, from the hardware id and from a
    # simulator-style id: neither may enter the verified pipelines.
    asyncio.run(_feed([_demo(co2=500), _demo(device_id="sim-northgate-01", co2=500)]))

    assert engine.calls == []
    assert spawned == []
    for reading in recorder.of_type(EventType.SENSOR_READING):
        assert reading["data"]["co2"] is None


@pytest.mark.parametrize("bad", [None, float("nan"), float("inf"), -5, 399.9, 10000.1, "abc", [], {}])
def test_malformed_demo_ppm_degrades_to_uncalibrated_and_is_not_forwarded(env, bad):
    recorder, engine, spawned = env

    asyncio.run(_feed([_demo(demo_ppm=bad)]))

    data = recorder.of_type(EventType.SENSOR_READING)[0]["data"]
    assert data["calibration_status"] == "UNCALIBRATED"
    assert data["demo_ppm"] is None
    assert data["co2"] is None
    assert engine.calls == []
    assert spawned == []


def test_demo_fields_are_absent_from_non_demo_readings(env):
    recorder, engine, spawned = env

    # Real calibrated hardware reading and a simulator reading behave as before.
    asyncio.run(
        _feed(
            [
                {"device_id": "esp32-01", "sensor_timestamp": "t1", "co2": 640.0, "calibration_status": "CALIBRATED"},
                {"device_id": "sim-northgate-01", "sensor_timestamp": "t2", "co2": 700.0},
            ]
        )
    )

    readings = recorder.of_type(EventType.SENSOR_READING)
    assert [r["data"]["co2"] for r in readings] == [640.0, 700.0]
    assert all(r["data"]["demo_ppm"] is None for r in readings)
    assert all(r["data"]["measurement_type"] is None for r in readings)
    assert len(engine.calls) == 2
    assert len(spawned) == 2

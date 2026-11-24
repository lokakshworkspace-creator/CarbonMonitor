# CarbonMonitor hardware guide

The sensor node is an **ESP32 with an MQ-135 gas sensor**. It is deliberately simple: read the
sensor, work out a value, publish JSON over MQTT. Hashing, storage and the blockchain all happen in
the gateway.

## 1. Parts

| Part | Notes |
|---|---|
| ESP32 development board | Classic ESP32 (Wi-Fi 2.4 GHz only) |
| MQ-135 gas sensor module | The analog output pin `AO` is used |
| Two resistors | A 2:1 divider, so the sensor's up-to-5 V output stays under the ESP32's 3.3 V limit |
| Active buzzer module | Optional local alarm |
| USB cable, jumper wires | |

## 2. Wiring

| From | To |
|---|---|
| MQ-135 `VCC` | ESP32 `VIN` (5 V) |
| MQ-135 `GND` | ESP32 `GND` |
| MQ-135 `AO` | the 2:1 divider, then ESP32 **GPIO34** |
| Buzzer `+` | ESP32 **GPIO25** |
| Buzzer `-` | ESP32 `GND` |

- **GPIO34** is an ADC1 pin. ADC1 stays reliable while Wi-Fi is on, unlike ADC2 pins.
- The firmware assumes the divider ratio of 2 (`MQ135_VOLTAGE_DIVIDER_RATIO`), so the sensor's 0 to 5 V
  output arrives at the pin as 0 to 2.5 V. If you build a different divider, change that constant.
- The buzzer code assumes an **active** buzzer (sounds on a plain `HIGH`). For a passive buzzer, see the
  note in `ESP32/config.example.h`.
- The MQ-135 has a heater and needs a **warm-up and burn-in** period before its readings mean anything
  (see section 6).

## 3. Software setup

1. Install the Arduino IDE (or `arduino-cli`) and the **ESP32 board package**.
2. Install the libraries **PubSubClient** and **ArduinoJson 7.x**.
3. Copy `ESP32/config.example.h` to **`ESP32/main/config.h`** and fill it in. This file is git-ignored
   and must never be committed.

| Setting | What to put |
|---|---|
| `WIFI_SSID`, `WIFI_PASSWORD` | A **2.4 GHz, WPA2** network (see section 8) |
| `MQTT_BROKER_HOST` | The **LAN IP of the computer running Mosquitto and the gateway**, not `localhost` (the ESP32 is a separate device) |
| `MQTT_BROKER_PORT`, `MQTT_TOPIC` | Must match `Gateway/.env` exactly |
| `MQTT_USERNAME`, `MQTT_PASSWORD` | The broker account created for the device |
| `DEVICE_ID` | Unique per node. It is part of every hash, so do not change it after readings are anchored |
| `MQ135_PIN`, `BUZZER_PIN` | 34 and 25 by default |

4. Open `ESP32/main/main.ino`, select the ESP32 board, and upload. Or build from the command line:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 ESP32/main
```

## 4. What the node does

On startup it connects to Wi-Fi and **waits for NTP time**. The timestamp is one of the three hashed
fields, so it will not publish with a guessed clock. It then loops every 20 seconds:

1. Average 10 ADC samples to smooth noise.
2. Convert to a CO₂ estimate (only possible once calibrated).
3. Build the JSON payload, check that it fits the 256-byte buffer, and publish.
4. Check that `publish()` succeeded.

The serial monitor (115200 baud) shows each step, ending with `Published to MQTT: {...}`.

**Buzzer alarm.** It runs on the device itself and depends only on the sensor, not on MQTT or the
gateway. It sounds when the estimated CO₂ is at or above 2000 ppm for 3 consecutive readings, clears after
3 readings below, and will not retrigger within 60 seconds. It is only evaluated on a valid, calibrated
reading, never on a demo value.

### Payloads

Calibrated (real CO₂ estimate):

```json
{ "device_id": "esp32-01", "sensor_timestamp": "…Z", "raw_adc": 1800, "v_pin": 1.45,
  "co2": 412.4, "calibration_status": "CALIBRATED" }
```

Not yet calibrated (presentation demo mode):

```json
{ "device_id": "esp32-01", "sensor_timestamp": "…Z", "raw_adc": 193, "v_pin": 0.155,
  "co2": null, "demo_ppm": 563,
  "calibration_status": "DEMO_ESTIMATE", "measurement_type": "ADC_DERIVED_DEMO" }
```

`co2` is `null` in the second case on purpose: the node has no real CO₂ value to report.

## 5. Demo mode (before calibration)

While `MQ135_R0` is still the placeholder `-1.0`, the CO₂ formula cannot run. For presentations, the node
adds a **demo estimate**: a straight-line rescale of the raw ADC value.

```
demo_ppm = max(400, 400 + (raw_adc - 65) / (537 - 65) * 600)
```

The two anchor points came from real readings: ADC 65 in still indoor air, and ADC 537 at the peak with
incense smoke. Above 537 the line keeps rising.

| raw ADC | 65 | 88 | 129 | 282 | 349 | 415 | 537 | 1000 | 4095 |
|---|---|---|---|---|---|---|---|---|---|
| demo ppm | 400 | 429 | 481 | 676 | 761 | 845 | 1000 | 1589 | 5523 |

**This is not a measurement of CO₂.** It only shows the sensor reacting. The dashboard labels these values
as "demo ppm", shows them against separate display-only bands, and the gateway never uses them for
alerts, the measurement history or verification (see [ARCHITECTURE.md](ARCHITECTURE.md), section 6).

## 6. Calibrating for real CO₂ readings

1. **Burn in** the sensor for 24 to 48 hours, powered, in normal air.
2. Put it in **clean outdoor air** for 15 to 30 minutes.
3. Read the line `Baseline R0 (Clean Air Estimate): … kOhm` from the serial monitor.
4. In `ESP32/main/mq135_calibration.h`, set `MQ135_R0` to that value. Leave
   `R0_PLACEHOLDER_CALIBRATE_ME` itself untouched, so it keeps meaning "uncalibrated".
5. Re-flash. The node now publishes `co2` with `calibration_status: "CALIBRATED"`, and the full alerting,
   hashing and anchoring pipeline applies.

Even then the MQ-135 is a low-cost sensor: treat its output as an estimate.

## 7. Checking that it works

- **Serial monitor:** `WiFi reconnected, IP: …`, then `Waiting for NTP time sync... done.`, then
  `Connecting to MQTT broker... connected.`
- **Gateway log:** a line per reading for `esp32-01`.
- **Dashboard:** Real-Time Data → choose the hardware factory.

## 8. Troubleshooting

| What you see | Likely cause and fix |
|---|---|
| `WiFi reconnect attempt timed out` repeating, then stuck on `Waiting for NTP time sync...` | The board never joined Wi-Fi (NTP needs a network). The usual cause: the network is **5 GHz only or WPA3 only**. An ESP32 needs **2.4 GHz and WPA2**. On a phone hotspot, turn on "Maximize Compatibility" (iPhone) or set the band to 2.4 GHz and security to WPA2 (Android), and keep the hotspot screen on. Also check the SSID and password. |
| `Connecting to MQTT broker... failed, rc=-2` | The board reached the network but **cannot open a connection to the broker**. Check, in order: the board and the computer are on the **same network**; `MQTT_BROKER_HOST` is the computer's **current** IP (`ipconfig`); the **firewall allows inbound TCP 1883** for the active network profile (see below); the network does not isolate clients (some campus Wi-Fi does). |
| `rc=4` or `rc=5` | Wrong or unauthorised MQTT username or password |
| `rc=-4` | Connection timed out. Check the broker address and network |
| Connects, but nothing arrives | Topic mismatch with `Gateway/.env`, or a payload over the buffer limit. `MQTT_MAX_PACKET_SIZE` is set to 256 in `main.ino` |
| Gateway shows the device but the dashboard shows "Uncalibrated" or "demo" | Expected until `MQ135_R0` is calibrated (section 6) |

**The broker address changes with the network.** The computer's IP on a college network or phone hotspot
differs from the one at home. After moving networks, update `MQTT_BROKER_HOST` and re-flash.

**Windows Firewall and the network profile.** Windows blocks inbound connections by default and treats each
network as *Public* or *Private*. Mosquitto's own firewall rule may exist only for one of them, and a new
network can land in the other. If the board shows `rc=-2` but the computer can ping it, allow the port for
the profile in use (an administrator PowerShell, here limited to a local subnet and Private networks):

```powershell
New-NetFirewallRule -DisplayName "mosquitto-1883-private" -Direction Inbound -Protocol TCP `
  -LocalPort 1883 -Profile Private -RemoteAddress 10.80.0.0/16 -Action Allow
```

Change `10.80.0.0/16` to your network's range. Run `Get-NetConnectionProfile` to see whether the network is
Public or Private. The broker still requires its username and password.

// ESP32 + MQ135 sensor node firmware.
//
// Deliberately lightweight per the project architecture: read the MQ135
// -> convert to a CO2 estimate -> build the exact three-field JSON
// payload the gateway expects -> publish over MQTT -> wait 20 seconds ->
// repeat. No hashing, no blockchain, no heavy logic runs on the device -
// all of that lives in the Gateway, one layer up.
//
// One exception to "everything else lives in the Gateway": a local
// buzzer alarm (buzzer_alarm.h), by design - it's the physical demo
// alarm, and it must keep working when WiFi/MQTT/the gateway are down,
// which is only possible if it never depends on any of them. See
// updateBuzzerAlarm()'s call site in loop() below for exactly where it
// sits relative to the network-dependent code.
//
// Requires config.h (copy config.example.h and fill in real values - see
// README.md) and mq135_calibration.h (see that file for the CO2 math and
// the mandatory R0 calibration step before readings mean anything).

#include "config.h"
#include "mq135_calibration.h"
#include "buzzer_alarm.h"

#include <WiFi.h>

// Must be defined before including PubSubClient.h: the library's default
// buffer (128 bytes on older releases) is too small for this JSON
// payload plus MQTT framing overhead, and publishes are silently dropped
// if they don't fit rather than erroring - a well-known real-world
// gotcha with this library, worth guarding against here rather than
// discovering it during Phase 5 bring-up.
#define MQTT_MAX_PACKET_SIZE 256
#include <PubSubClient.h>

#include <ArduinoJson.h>

#include <time.h>
#include <sys/time.h>

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

const unsigned long PUBLISH_INTERVAL_MS = 20000;  // CLAUDE.md's specified real-world interval
const unsigned long WIFI_RECONNECT_TIMEOUT_MS = 15000;

// --- PRESENTATION DEMO ONLY - NOT A CALIBRATION, NOT A CO2 MEASUREMENT ---
// A linear rescale of the raw ADC reading onto a "demo ppm" scale (floor 400,
// no upper cap), anchored on two observed readings: indoor baseline (ADC 65)
// = 400 and peak during dhoop-smoke exposure (ADC 537) = 1000; readings above
// the observed peak keep rising along the same line. It has no relationship to real CO2
// concentration. It is published in its own "demo_ppm" field - never in "co2"
// - so nothing downstream can mistake it for a measurement. MQ135_R0 and the
// real calibration path (mq135_calibration.h) are untouched.
const float DEMO_ADC_BASELINE = 65.0f;
const float DEMO_ADC_PEAK     = 537.0f;
const float DEMO_PPM_MIN      = 400.0f;
const float DEMO_PPM_SPAN     = 600.0f;  // demo ppm gained between baseline and peak ADC

// demo_ppm = 400 + ((raw_adc - 65) / (537 - 65)) * 600, floored at 400 (no upper cap;
// the 12-bit ADC tops out at 4095, i.e. about 5525).
// Float arithmetic throughout; rounding happens only at JSON serialisation.
float demoPpmFromRawAdc(int rawAdc) {
  float ppm = DEMO_PPM_MIN +
              ((rawAdc - DEMO_ADC_BASELINE) / (DEMO_ADC_PEAK - DEMO_ADC_BASELINE)) * DEMO_PPM_SPAN;
  if (ppm < DEMO_PPM_MIN) ppm = DEMO_PPM_MIN;
  return ppm;
}

void ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.println("WiFi disconnected, reconnecting...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_RECONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print("WiFi reconnected, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println();
    Serial.println("WiFi reconnect attempt timed out - will retry next loop.");
  }
}

void ensureMqttConnected() {
  if (mqttClient.connected()) {
    return;
  }

  Serial.print("Connecting to MQTT broker...");
#if defined(MQTT_USERNAME) && defined(MQTT_PASSWORD)
  if (mqttClient.connect(DEVICE_ID, MQTT_USERNAME, MQTT_PASSWORD)) {
#else
  if (mqttClient.connect(DEVICE_ID)) {
#endif
    Serial.println(" connected.");
  } else {
    Serial.print(" failed, rc=");
    Serial.print(mqttClient.state());
    Serial.println(" - will retry next loop.");
  }
}

// Builds an ISO 8601 UTC timestamp with microsecond precision, e.g.
// "2026-08-24T06:12:27.975061Z" - matching the precision (though not the
// literal "+00:00" vs "Z" UTC suffix) of what
// tests/mqtt_test_publisher.py produces via Python's
// datetime.now(timezone.utc).isoformat(). Both are equally valid ISO
// 8601 UTC representations; sensor_timestamp is stored and hashed as an
// opaque string everywhere in the gateway (never parsed back into a
// datetime), so this difference has no functional effect - see
// Gateway/hashing.py.
String currentIsoTimestamp() {
  struct timeval tv;
  gettimeofday(&tv, NULL);

  struct tm utc;
  gmtime_r(&tv.tv_sec, &utc);

  char buf[40];
  snprintf(
      buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d.%06ldZ",
      utc.tm_year + 1900, utc.tm_mon + 1, utc.tm_mday,
      utc.tm_hour, utc.tm_min, utc.tm_sec, (long)tv.tv_usec
  );
  return String(buf);
}

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);  // silent until a real reading says otherwise

  // PRE-WIFI ADC diagnostic check (prior to turning on RF / WiFi subsystem)
  int preWifiRaw = analogRead(MQ135_PIN);
  uint32_t preWifiMv = analogReadMilliVolts(MQ135_PIN);
  Serial.println("\n==================================================");
  Serial.println("         PRE-WIFI ADC DIAGNOSTIC CHECK            ");
  Serial.println("==================================================");
  Serial.print("[PRE-WIFI] Raw ADC: ");
  Serial.print(preWifiRaw);
  Serial.print(" | GPIO Voltage: ");
  Serial.print(preWifiMv);
  Serial.print(" mV (");
  Serial.print(preWifiMv / 1000.0, 3);
  Serial.println(" V)");
  Serial.print("[PRE-WIFI] Sensor AO Voltage (approx 2x): ");
  Serial.print((preWifiMv * 2.0) / 1000.0, 3);
  Serial.println(" V");
  Serial.println("==================================================\n");

  WiFi.mode(WIFI_STA);
  ensureWiFiConnected();

  // NTP sync - must happen once WiFi is up (it is, by this point), and
  // must succeed before the first reading is published. The ESP32 has no
  // real-time clock of its own, and sensor_timestamp is one of the three
  // canonical hash fields (device_id + co2 + sensor_timestamp per
  // CLAUDE.md) - publishing a wrong or placeholder timestamp here would
  // silently produce a record that looks fine but can never be correctly
  // re-verified later. There is no meaningful fallback if NTP fails, so
  // this blocks and retries indefinitely rather than proceeding with a
  // guessed time.
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");  // 0, 0: UTC directly, no DST offset
  Serial.print("Waiting for NTP time sync...");
  struct tm timeinfo;
  while (!getLocalTime(&timeinfo)) {
    Serial.print(".");
    delay(500);
  }
  Serial.println(" done.");

  mqttClient.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  // Belt-and-suspenders alongside the compile-time #define MQTT_MAX_PACKET_SIZE 256
  // above: setBufferSize() is the runtime override available since PubSubClient 2.8
  // and takes effect even if the library was compiled without seeing the #define.
  mqttClient.setBufferSize(256);
  mqttClient.setKeepAlive(60);
}

void loop() {
  ensureWiFiConnected();
  ensureMqttConnected();
  mqttClient.loop();

  // 10-sample ADC averaging to filter high-frequency noise
  long adcSum = 0;
  for (int i = 0; i < 10; i++) {
    adcSum += analogRead(MQ135_PIN);
    delay(2);
  }
  int rawAdc = (int)(adcSum / 10);
  uint32_t postWifiMv = analogReadMilliVolts(MQ135_PIN);

  float vPin = mq135RawToPinVoltage(rawAdc);
  float vAO = mq135RawToVoltage(rawAdc);
  float rs = mq135VoltageToRs(vAO);
  float r0CleanAirEstimate = mq135CalibrateR0(rawAdc);
  float co2Ppm = mq135ReadPpm(rawAdc);

  Serial.println("--------------------------------------------------");
  Serial.print("[POST-WIFI] Raw ADC (avg): "); Serial.print(rawAdc);
  Serial.print(" | Measured: "); Serial.print(postWifiMv); Serial.print(" mV");
  Serial.print(" | V_pin: "); Serial.print(vPin, 3); Serial.print("V");
  Serial.print(" | V_AO: "); Serial.print(vAO, 3); Serial.print("V");
  Serial.print(" | Rs: "); Serial.print(rs, 2); Serial.println(" kOhm");
  Serial.print("[POST-WIFI] Baseline R0 (Clean Air Estimate): "); Serial.print(r0CleanAirEstimate, 2); Serial.println(" kOhm");

  // Always publish a payload, calibrated or not.
  //
  // When R0 is configured: co2Ppm is a valid float, calibration_status is
  // "CALIBRATED", and the gateway runs both Pipeline A (threshold/WebSocket)
  // and Pipeline B (hash/MongoDB/blockchain) exactly as before.
  //
  // When R0 is still the -1.0 placeholder: co2Ppm is NAN, so the JSON co2
  // field is null and calibration_status is "DEMO_ESTIMATE" (with a separate
  // demo_ppm field, see demoPpmFromRawAdc()). The gateway broadcasts this to
  // the dashboard via WebSocket but skips threshold evaluation and Pipeline B
  // entirely.
  //
  // v_pin is an ADC-derived voltage estimate computed from the averaged raw
  // reading via mq135RawToPinVoltage() - it is not a directly measured or
  // verified physical voltage.
  String timestamp = currentIsoTimestamp();

  JsonDocument doc;
  doc["device_id"]        = DEVICE_ID;
  doc["sensor_timestamp"] = timestamp;
  doc["raw_adc"]          = rawAdc;
  doc["v_pin"]            = vPin;  // ADC-derived estimate; see mq135_calibration.h

  if (isfinite(co2Ppm)) {
    doc["co2"]                = co2Ppm;
    doc["calibration_status"] = "CALIBRATED";
    // Buzzer evaluated only on a valid calibrated reading - never on null CO2.
    updateBuzzerAlarm(BUZZER_PIN, co2Ppm);
    Serial.print("Estimated CO2 Concentration: "); Serial.print(co2Ppm, 1); Serial.println(" ppm");
  } else {
    // Still uncalibrated: co2 stays null. For the presentation we additionally
    // publish a clearly-marked ADC-derived demo estimate in its own field. The
    // gateway never hashes/stores/alerts on it (see Gateway/app.py).
    float demoPpm = demoPpmFromRawAdc(rawAdc);
    doc["co2"]                = nullptr;  // ArduinoJson serialises nullptr as JSON null
    doc["demo_ppm"]           = (int)lroundf(demoPpm);
    doc["calibration_status"] = "DEMO_ESTIMATE";
    doc["measurement_type"]   = "ADC_DERIVED_DEMO";
    Serial.print("[DEMO ESTIMATE - NOT CALIBRATED] Raw ADC: "); Serial.print(rawAdc);
    Serial.print(" -> Estimated Demo PPM: "); Serial.println(demoPpm, 1);
    Serial.println("[CALIBRATION REQUIRED] co2=null; demo_ppm is a presentation rescale, not a CO2 measurement.");
    Serial.print("==> Place sensor in clean air, wait 15-30m, then copy R0 baseline (");
    Serial.print(r0CleanAirEstimate, 2);
    Serial.println(" kOhm) into MQ135_R0 in mq135_calibration.h");
  }

  // Verify payload fits the buffer before serialising. measureJson() gives
  // the exact byte count ArduinoJson would write (excluding the null
  // terminator), so this catches overflow before it happens rather than
  // discovering a silently-truncated, malformed JSON string on the wire.
  char payload[256];
  size_t requiredSize = measureJson(doc);
  if (requiredSize >= sizeof(payload)) {
    Serial.print("[ERROR] JSON payload too large for buffer (");
    Serial.print(requiredSize);
    Serial.println(" bytes required, 255 available) - publish skipped.");
  } else {
    size_t payloadLen = serializeJson(doc, payload, sizeof(payload));
    if (mqttClient.connected()) {
      bool published = mqttClient.publish(MQTT_TOPIC, (const uint8_t *)payload, payloadLen);
      if (published) {
        Serial.print("Published to MQTT: "); Serial.println(payload);
      } else {
        Serial.println("[ERROR] mqttClient.publish() returned false - packet may exceed broker/buffer limit.");
      }
    } else {
      Serial.println("MQTT not connected - skipping publish this cycle.");
    }
  }

  delay(PUBLISH_INTERVAL_MS);
}

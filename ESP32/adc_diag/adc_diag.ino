// Standalone ADC Diagnostic Sketch for ESP32 GPIO34
// Isolates hardware ADC sampling from WiFi, MQTT, NTP, and application logic.

const int ADC_PIN = 34;

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println();
  Serial.println("==================================================");
  Serial.println("      ESP32 GPIO34 Hardware ADC Diagnostic       ");
  Serial.println("==================================================");
  Serial.println("Sampling GPIO34 every 1 second...");
}

void loop() {
  int rawAdc = analogRead(ADC_PIN);
  uint32_t mv = analogReadMilliVolts(ADC_PIN);

  Serial.print("Raw ADC: ");
  Serial.print(rawAdc);
  Serial.print(" \t| Measured: ");
  Serial.print(mv);
  Serial.print(" mV \t(");
  Serial.print(mv / 1000.0f, 3);
  Serial.println(" V)");

  delay(1000);
}

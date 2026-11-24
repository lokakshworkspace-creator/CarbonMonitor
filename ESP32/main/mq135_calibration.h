#pragma once

#include <math.h>

// ==============================================================================
// MQ135 Gas Sensor Estimation & Calibration Math
//
// Hardware Circuit Configuration:
//   - MQ-135 Module VCC: 5.0V (Standard heater & sensor supply voltage)
//   - External Voltage Divider: Two equal 10kΩ resistors between AO and GND
//   - ESP32 ADC Input: GPIO34 (ADC1_CH6, input-only, WiFi-safe)
//   - Voltage Scaling: V_AO = 2.0 * V_pin (steps 0-5V down to 0-2.5V safe for ESP32)
// ==============================================================================

// --- Circuit Constants ---

// Supply voltage feeding the MQ135 module (5.0V standard for MQ heater/circuit)
static const float MQ135_SUPPLY_VCC = 5.0f;

// ESP32 ADC reference full-scale voltage
static const float ESP32_ADC_VREF = 3.3f;

// External voltage divider scaling ratio: (R1 + R2) / R2 = (10k + 10k) / 10k = 2.0
static const float MQ135_VOLTAGE_DIVIDER_RATIO = 2.0f;

// Standard onboard load resistor value used on MQ135 breakout modules (kOhm)
static const float MQ135_RL_KOHM = 10.0f;

// ESP32 12-bit ADC full-scale resolution: 0 - 4095
static const int MQ135_ADC_MAX_RAW = 4095;

// --- CO2 / Air Quality Curve Constants (MQ135 datasheet log-log fit) ---
static const float MQ135_PARA = 116.6020682f;
static const float MQ135_PARB = 2.769034857f;

// Assumed ambient clean-air baseline concentration (ppm)
static const float MQ135_ATMOCO2_PPM = 397.13f;

// --- R0: Physical Sensor Resistance in Clean Air ---
//
// R0 is this specific MQ135 unit's sensor resistance in known-clean air.
// The placeholder -1.0f deliberately triggers NaN so uncalibrated sensors
// are caught immediately in the Serial Monitor rather than publishing invalid data.
//
// Once observed from the Serial Monitor in clean air, paste the measured value here:
static const float R0_PLACEHOLDER_CALIBRATE_ME = -1.0f;

// Change ONLY this value to your measured clean-air R0 (e.g. 25.4f):
static const float MQ135_R0 = R0_PLACEHOLDER_CALIBRATE_ME;

// --- Conversion Functions ---

// 1. Raw ADC (0-4095) -> Voltage at ESP32 GPIO pin (0.0V - 2.5V max)
inline float mq135RawToPinVoltage(int rawAdc) {
  return (rawAdc / (float)MQ135_ADC_MAX_RAW) * ESP32_ADC_VREF;
}

// 2. Pin Voltage -> Actual MQ-135 AO pin voltage before the voltage divider (0.0V - 5.0V max)
inline float mq135PinVoltageToSensorVoltage(float vPin) {
  return vPin * MQ135_VOLTAGE_DIVIDER_RATIO;
}

// 3. Raw ADC -> Actual MQ-135 AO pin voltage (convenience helper)
inline float mq135RawToVoltage(int rawAdc) {
  return mq135PinVoltageToSensorVoltage(mq135RawToPinVoltage(rawAdc));
}

// 4. Sensor AO Voltage -> Sensor resistance Rs (kOhm)
// Formula: Rs = RL * (Vsupply - V_AO) / V_AO
inline float mq135VoltageToRs(float vAO) {
  if (vAO <= 0.0f) {
    return INFINITY;
  }
  if (vAO >= MQ135_SUPPLY_VCC) {
    return 0.001f; // Prevent division by zero / negative resistance on saturation
  }
  return MQ135_RL_KOHM * (MQ135_SUPPLY_VCC - vAO) / vAO;
}

// 5. Rs/R0 ratio -> Estimated CO2-equivalent ppm
inline float mq135RsToPpm(float rs, float r0) {
  if (r0 <= 0.0f || rs <= 0.0f || isnan(rs) || isinf(rs)) {
    return NAN;
  }
  return MQ135_PARA * pow(rs / r0, -MQ135_PARB);
}

// 6. Full Reading Pipeline: Raw ADC -> Estimated CO2 ppm
inline float mq135ReadPpm(int rawAdc) {
  float vAO = mq135RawToVoltage(rawAdc);
  float rs = mq135VoltageToRs(vAO);
  return mq135RsToPpm(rs, MQ135_R0);
}

// 7. Calculate R0 from clean-air reading
// In clean air (397.13 ppm CO2 reference), R0 = Rs_clean * (ATMOCO2 / PARA)^(1 / PARB)
inline float mq135CalibrateR0(int rawAdcInCleanAir) {
  float vAO = mq135RawToVoltage(rawAdcInCleanAir);
  float rs = mq135VoltageToRs(vAO);
  return rs * pow(MQ135_ATMOCO2_PPM / MQ135_PARA, 1.0f / MQ135_PARB);
}

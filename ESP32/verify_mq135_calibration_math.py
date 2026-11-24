"""
Standalone sanity check for the MQ135 ADC -> CO2 ppm math in
mq135_calibration.h, reimplemented here in Python so the formula's logic
can be verified without any ESP32 hardware or Arduino toolchain.

This is NOT a substitute for real hardware calibration - R0 for a real
physical sensor can only be determined by mq135CalibrateR0() run on the
actual unit during Phase 5 bring-up, in known-clean air, after burn-in.
This script only proves the *formula* is implemented correctly and
behaves sensibly, using the same published MQ135 datasheet curve
constants as the firmware. Every constant and formula below must be kept
in sync with mq135_calibration.h by hand - there is no shared source
between the C++ header and this script.

Run: python ESP32/verify_mq135_calibration_math.py
"""

import math

# --- Constants: must match mq135_calibration.h exactly ---
MQ135_SUPPLY_VCC = 5.0
ESP32_ADC_VREF = 3.3
MQ135_VOLTAGE_DIVIDER_RATIO = 2.0
MQ135_RL_KOHM = 10.0
MQ135_ADC_MAX_RAW = 4095

MQ135_PARA = 116.6020682
MQ135_PARB = 2.769034857
MQ135_ATMOCO2_PPM = 397.13


def raw_to_pin_voltage(raw_adc: int) -> float:
    return (raw_adc / MQ135_ADC_MAX_RAW) * ESP32_ADC_VREF


def raw_to_sensor_voltage(raw_adc: int) -> float:
    return raw_to_pin_voltage(raw_adc) * MQ135_VOLTAGE_DIVIDER_RATIO


def voltage_to_rs(v_ao: float) -> float:
    if v_ao <= 0:
        return math.inf
    if v_ao >= MQ135_SUPPLY_VCC:
        return 0.001
    return MQ135_RL_KOHM * (MQ135_SUPPLY_VCC - v_ao) / v_ao


def rs_to_ppm(rs: float, r0: float) -> float:
    # math.pow (not the ** operator) to mirror C's pow() semantics: a
    # negative base with a non-integer exponent raises a domain error in
    # both, whereas Python's ** operator would instead silently return a
    # complex number - which would defeat check 5 below.
    return MQ135_PARA * math.pow(rs / r0, -MQ135_PARB)


def calibrate_r0(rs_in_clean_air: float) -> float:
    return rs_in_clean_air * math.pow(MQ135_ATMOCO2_PPM / MQ135_PARA, 1.0 / MQ135_PARB)


def check(label: str, condition: bool) -> None:
    print(f"{'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        raise SystemExit(1)


def main() -> None:
    # --- Check 1: raw ADC -> voltage is a clean linear mapping ---
    check("raw=0 -> pin voltage=0.0V (bottom of range)", raw_to_pin_voltage(0) == 0.0)
    check("raw=4095 -> pin voltage=3.3V (full scale)", raw_to_pin_voltage(MQ135_ADC_MAX_RAW) == ESP32_ADC_VREF)
    midpoint_vpin = raw_to_pin_voltage(2048)
    check(f"raw=2048 -> pin voltage={midpoint_vpin:.4f}V (~half of 3.3V)", abs(midpoint_vpin - 1.65) < 0.001)

    # Voltage divider scaling check
    check("raw=2048 -> sensor AO voltage=3.30V (2x of pin voltage)", abs(raw_to_sensor_voltage(2048) - 3.30) < 0.002)

    # --- Check 2: voltage -> Rs, a clean round-number case ---
    # At V_AO = VCC/2 (2.5V), the divider is balanced, so Rs must equal RL
    # exactly: Rs = RL*(VCC-V_AO)/V_AO = RL*(2.5)/(2.5) = RL.
    rs_at_half_vcc = voltage_to_rs(MQ135_SUPPLY_VCC / 2)
    check(
        f"Rs at V_AO=VCC/2 equals RL ({rs_at_half_vcc:.6f} == {MQ135_RL_KOHM})",
        abs(rs_at_half_vcc - MQ135_RL_KOHM) < 1e-9,
    )

    # --- Check 3: R0 calibration round-trips back to ATMOCO2 ---
    # If we "measure" some arbitrary Rs in clean air and derive R0 from
    # it, recomputing ppm from that SAME Rs/R0 ratio must reproduce the
    # clean-air reference concentration - this is the defining property
    # of a correct calibration formula, independent of any specific
    # sensor's real-world Rs value.
    for assumed_clean_air_rs in (5.0, 20.0, 76.63, 150.0):
        r0 = calibrate_r0(assumed_clean_air_rs)
        round_tripped_ppm = rs_to_ppm(assumed_clean_air_rs, r0)
        check(
            f"R0 round-trip for Rs={assumed_clean_air_rs} kOhm -> "
            f"R0={r0:.4f} -> ppm={round_tripped_ppm:.2f} (~{MQ135_ATMOCO2_PPM})",
            abs(round_tripped_ppm - MQ135_ATMOCO2_PPM) < 0.01,
        )

    # --- Check 4: monotonicity - lower Rs (more gas) -> higher ppm ---
    # MQ135's resistance drops as CO2 concentration rises, so for a fixed
    # R0, ppm must be a strictly decreasing function of Rs.
    r0 = calibrate_r0(20.0)
    rs_values = (30.0, 20.0, 10.0, 5.0, 1.0)
    ppms = [rs_to_ppm(rs, r0) for rs in rs_values]
    check(
        f"ppm strictly increases as Rs decreases: {[round(p, 1) for p in ppms]}",
        all(a < b for a, b in zip(ppms, ppms[1:])),
    )

    # --- Check 5: the placeholder R0 must NOT produce a plausible reading ---
    # Mirrors mq135_calibration.h's R0_PLACEHOLDER_CALIBRATE_ME = -1.0: a
    # negative R0 makes the Rs/R0 ratio negative, and a non-integer power
    # of a negative number is a math domain error - the same failure mode
    # C's pow() hits (returning NaN) that math.pow() hits here (raising).
    try:
        implausible_result = rs_to_ppm(20.0, -1.0)
        check(f"placeholder R0=-1.0 should not reach a numeric result (got {implausible_result})", False)
    except ValueError:
        check("placeholder R0=-1.0 raises a math domain error, never a plausible ppm value", True)

    print("\nAll MQ135 calibration math checks passed.")
    print(
        "Reminder: this only proves the FORMULA is self-consistent - it does not\n"
        "and cannot verify a real sensor's actual R0, which requires the physical\n"
        "unit, burn-in, and calibration described in README.md."
    )


if __name__ == "__main__":
    main()

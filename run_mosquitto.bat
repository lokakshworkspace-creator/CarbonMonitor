@echo off
title Mosquitto MQTT Broker (Authenticated - 0.0.0.0:1883)
echo Starting Mosquitto with project configuration: %~dp0mosquitto.conf
"C:\Program Files\Mosquitto\mosquitto.exe" -c "%~dp0mosquitto.conf" -v
pause


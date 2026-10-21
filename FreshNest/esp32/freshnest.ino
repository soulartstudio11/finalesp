/* FreshNest ESP32 starter firmware
   IMPORTANT:
   - This is a wiring/template starting point, not calibrated fruit-spoilage detection.
   - Confirm the exact gas-sensor module and its analog-output voltage before wiring.
   - ESP32 GPIO pins are NOT 5V tolerant. Never feed 5V into an ESP32 ADC pin.
   - Load cell support uses an HX711 module. Install the "HX711" library from the Arduino Library Manager.
   - Set WIFI_SSID, WIFI_PASSWORD, API_URL and DEVICE_TOKEN to match your server.
*/
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "HX711.h"

const char* WIFI_SSID = "YOUR_PHONE_HOTSPOT_NAME";
const char* WIFI_PASSWORD = "YOUR_PHONE_HOTSPOT_PASSWORD";
const char* API_URL = "http://YOUR_COMPUTER_LAN_IP:3000/api/readings";
const char* DEVICE_TOKEN = "replace-this-with-a-long-random-secret";
const char* DEVICE_NAME = "FreshNest-Basket-01";

const int GAS1_PIN = 34;  // ADC input only; verify safe voltage
const int GAS2_PIN = 35;  // ADC input only; verify safe voltage
const int HX711_DOUT_PIN = 4;
const int HX711_SCK_PIN = 5;

HX711 scale;
// Replace after calibrating with known weights. Do not trust this placeholder value.
float calibrationFactor = 1.0f;
unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL_MS = 5000;

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to hotspot");
  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 20000) {
    delay(500); Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected; ESP32 IP: "); Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi connection failed; retrying later.");
  }
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12); // ESP32 ADC range is typically 0..4095
  scale.begin(HX711_DOUT_PIN, HX711_SCK_PIN);
  scale.set_scale(calibrationFactor);
  scale.tare(); // Run with empty basket/load cell at startup
  connectWiFi();
}

void loop() {
  connectWiFi();
  if (millis() - lastSend < SEND_INTERVAL_MS) { delay(50); return; }
  lastSend = millis();

  int gas1 = analogRead(GAS1_PIN);
  int gas2 = analogRead(GAS2_PIN);
  float weightKg = 0.0f;
  if (scale.is_ready()) {
    // Calibration and units depend on your specific load cell/HX711 setup.
    // Treat this as a placeholder until calibrated using known weights.
    float measured = scale.get_units(5);
    weightKg = measured / 1000.0f;
    if (weightKg < 0) weightKg = 0;
  } else {
    Serial.println("HX711 not ready; sending 0 kg placeholder.");
  }
  Serial.printf("Gas1=%d Gas2=%d Weight=%.3f kg\n", gas1, gas2, weightKg);

  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(API_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", DEVICE_TOKEN);
  StaticJsonDocument<256> doc;
  doc["deviceName"] = DEVICE_NAME;
  doc["weightKg"] = weightKg;
  doc["gasRaw"] = gas1;
  doc["gas2Raw"] = gas2;
  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  Serial.printf("API HTTP status: %d\n", code);
  if (code > 0) Serial.println(http.getString());
  http.end();
}

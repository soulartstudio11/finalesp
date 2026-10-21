FRESHNEST SMART FRUIT BASKET — LOCAL SETUP BUNDLE

WHAT IS INCLUDED
- index.html: FreshNest website dashboard
- server/server.js: Node.js server, website hosting, and sensor API
- server/package.json: required Node.js packages
- server/.env.example: environment-variable template
- start.bat: Windows one-click launcher (installs dependencies the first time)
- esp32/freshnest.ino: starter ESP32 firmware template

REQUIREMENTS
1. Install Node.js LTS from https://nodejs.org/ (npm is included).
2. Internet access is needed for the first npm package installation.
3. Extract this ZIP into a normal writable folder (not inside the ZIP preview).

EASIEST WAY — WINDOWS
1. Extract the ZIP.
2. Open the extracted FreshNest folder.
3. Double-click start.bat.
4. Wait until the terminal says "FreshNest API listening on port 3000".
5. Open http://localhost:3000 in your browser.
6. Keep the terminal window open while using the website.
7. To stop the server, click the terminal and press Ctrl+C.

MANUAL WAY — POWERSHELL
Open PowerShell in the extracted FreshNest folder, then run:
  cd server
  npm install
  npm start
Then open http://localhost:3000.

CHECK THAT IT WORKS
- Website: http://localhost:3000
- API health: http://localhost:3000/api/health
- Latest readings: http://localhost:3000/api/readings
The API should initially return zero readings until a device sends data. This is expected.

IMPORTANT ABOUT THE HARDWARE
- This bundle does not need an ESP32 to open the website; hardware is a later step.
- In the website Settings, the local API URL defaults to http://localhost:3000/api and is saved in this browser.
- The ESP32 cannot use localhost to reach your computer. For ESP32 testing, use your computer's LAN IP and ensure both devices can reach each other on the same network/hotspot. For remote access, deploy the API to a reachable HTTPS host.
- Before wiring, identify the exact gas sensor models and verify their analog output voltage. ESP32 GPIO inputs are NOT 5V tolerant.
- In server/.env, set DEVICE_TOKEN to a long random secret, then use the same token in esp32/freshnest.ino. Do not publish the token.
- The firmware needs ArduinoJson and HX711 libraries in Arduino IDE. Its weight calibration factor and kg conversion are placeholders; calibrate with known weights before trusting readings.
- Gas readings do not prove fruit is spoiled; treat them as experimental warnings only.

NOT IMPLEMENTED YET
- Email and WhatsApp notifications need a separate secure provider integration.
- The Smart Orders screen creates demo requests only; it does not place real purchases.
- The API keeps the latest reading in memory, so readings reset if the server restarts.

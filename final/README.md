
# FreshNest — Smart Fruit Basket 🍎

FreshNest is an IoT smart fruit basket that monitors fruit quantity and gas sensor readings using an ESP32, HC-SR04 ultrasonic sensor, and MQ-3 gas sensor.

## Features

- Live fruit quantity percentage
- Live gas sensor readings
- MQTT communication through EMQX Cloud
- Low-fruit email alerts
- High-gas email alerts
- Dashboard with charts and history
- Adjustable basket height and full-distance calibration
- Adjustable low-fruit threshold
- JSON-based settings and history storage
- Admin-protected settings
- Gmail SMTP email notifications
- Responsive web dashboard

## Hardware

- ESP32
- HC-SR04 ultrasonic sensor
- MQ-3 gas sensor
- Fruit basket
- Resistors or a suitable logic-level divider for safe ESP32 inputs

### Example wiring

| Component | ESP32 pin |
|---|---|
| HC-SR04 TRIG | GPIO 5 |
| HC-SR04 ECHO | GPIO 18 through a voltage divider |
| MQ-3 analog output | GPIO 34, with safe input voltage |

**Electrical safety:** ESP32 GPIO pins are not 5 V tolerant. Ensure the HC-SR04 ECHO signal and MQ-3 analog output cannot exceed the ESP32 input voltage limit.

## Repository structure

```text
finalesp/
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── server/
│   ├── package.json
│   ├── server.js
│   ├── .gitignore
│   └── .env.example
├── render.yaml
└── README.md
```

## 1. Configure EMQX Cloud

Use your existing EMQX deployment.

Configure these backend environment variables in Render:

- `MQTT_HOST`
- `MQTT_PORT`
- `MQTT_USERNAME`
- `MQTT_PASSWORD`
- `MQTT_TOPIC`

Use TLS on port `8883` and keep certificate verification enabled.

Default telemetry topic:

```text
freshnest/basket01/telemetry
```

The ESP32 should publish JSON telemetry containing fields such as:

```json
{
  "distanceCm": 18.5,
  "gasRaw": 1250,
  "sensorValid": true,
  "timestampMs": 1792600000000,
  "deviceName": "FreshNest Basket 01"
}
```

The numbers above are examples only. Publish actual sensor readings from your device.

## 2. Deploy the backend to Render

1. Push all project files to GitHub.
2. Sign in to Render.
3. Create a new Blueprint deployment using this repository.
4. Render will read `render.yaml`.
5. Provide the requested secret environment variables privately in Render.
6. Deploy the service.
7. Check the service logs for MQTT connection and startup errors.
8. Confirm that the health endpoint responds successfully:

```text
https://YOUR-RENDER-SERVICE.onrender.com/api/health
```

Replace the example hostname with your actual Render service URL.

### Required environment variables

| Variable | Purpose |
|---|---|
| `ADMIN_USERNAME` | Admin login username |
| `ADMIN_PASSWORD` | Strong, unique admin password |
| `MQTT_USERNAME` | EMQX username |
| `MQTT_PASSWORD` | EMQX password |
| `SMTP_USER` | Gmail sender account |
| `SMTP_PASSWORD` | Gmail app password |
| `SMTP_FROM` | Sender email address |
| `DATA_DIR` | Persistent JSON storage directory |
| `FRONTEND_ORIGINS` | Permitted frontend origin |

Never commit real credentials to GitHub.

## 3. Configure Gmail alerts

1. Enable two-step verification on your Gmail account.
2. Create a Gmail App Password if your account supports it.
3. Set the SMTP variables in Render.
4. Use SMTP port `465` with secure TLS.
5. Set the sender address using `SMTP_FROM`.
6. Enter the recipient email in the FreshNest dashboard settings.
7. Test email delivery using the dashboard's test-email control.

Do not use your normal Gmail account password as the SMTP password.

## 4. Publish the frontend using GitHub Pages

1. Open your GitHub repository.
2. Navigate to **Settings → Pages**.
3. Select **Deploy from a branch**.
4. Select your main branch.
5. Select the `/frontend` folder if GitHub Pages offers it as a publishing source.
6. Save the configuration.

If GitHub Pages cannot publish `/frontend` directly, move or copy the frontend files into a supported publishing folder, or configure a separate frontend deployment.

Open `frontend/app.js` and replace the placeholder API URL:

```javascript
const API_BASE_URL = "https://YOUR-RENDER-SERVICE.onrender.com";
```

Use your actual Render backend URL. Commit and push the changes.

## 5. Calibrate the basket

1. Set the actual basket height in the dashboard.
2. Measure the sensor distance when the basket is empty.
3. Measure the distance when the basket is full.
4. Enter the measured full-distance value.
5. Confirm that an empty basket reads approximately 0%.
6. Confirm that a full basket reads approximately 100%.

The default settings are starting values only. Recalibrate them for your basket and sensor mounting position.

## 6. Configure alerts

- Low-fruit threshold: initially 15%.
- Gas threshold: leave unconfigured until you have collected sensor readings.
- Recipient email: enter a valid email address.
- Low-fruit alert: enable or disable in dashboard settings.
- High-gas alert: enable or disable in dashboard settings.

MQ-3 readings alone cannot reliably confirm that fruit is spoiled. Calibrate the sensor and interpret readings cautiously.

## 7. JSON storage

FreshNest uses JSON files stored under:

```text
/var/data/freshnest
```

The directory is on the Render persistent disk when configured correctly.

Do not store secrets in the frontend or public JSON files. JSON files should only be accessed through authorized backend routes.

## 8. Troubleshooting

### Dashboard cannot connect

- Confirm the Render service is running.
- Check `API_BASE_URL` in `frontend/app.js`.
- Verify CORS allows your frontend origin.
- Inspect the browser developer console.

### MQTT is disconnected

- Check the EMQX hostname and credentials.
- Confirm TLS port `8883`.
- Verify the topic matches the ESP32 publish topic.
- Review Render service logs.

### Emails are not received

- Verify Gmail SMTP configuration.
- Use a Gmail App Password where required.
- Check the recipient address and spam folder.
- Use the test-email function and inspect server logs.

### Sensor values are incorrect

- Check wiring and common ground.
- Ensure safe voltage levels on ESP32 inputs.
- Recalibrate basket height and full distance.
- Do not configure the gas threshold until readings have been tested.

## Important deployment note

The backend must implement every API route expected by the frontend, including `/api/health`. Confirm that the backend persists JSON files on the mounted disk and authenticates admin-only routes before considering deployment complete.

**Ordering is disabled for now.**

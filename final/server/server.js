
'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

const PORT = Number(process.env.PORT || 10000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const HISTORY_DAYS = 7;
const MAX_HISTORY = 20000;

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '100kb' }));

const allowedOrigins = (process.env.FRONTEND_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Origin not allowed by FreshNest CORS'));
  }
}));

function readJson(filename, fallback) {
  const fullPath = path.join(DATA_DIR, filename);

  try {
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, JSON.stringify(fallback, null, 2));
      return structuredClone(fallback);
    }

    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (error) {
    console.error(`Could not read ${filename}:`, error.message);
    return structuredClone(fallback);
  }
}

function writeJson(filename, value) {
  const fullPath = path.join(DATA_DIR, filename);
  const tempPath = `${fullPath}.${process.pid}.tmp`;

  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, fullPath);
}

const defaultSettings = {
  basketHeightCm: 40,
  fullDistanceCm: 2,
  lowFruitThreshold: 15,
  gasThreshold: null,
  recipientEmail: 'rdstechnics@gmail.com',
  lowFruitAlertsEnabled: true,
  highGasAlertsEnabled: true
};

let settings = {
  ...defaultSettings,
  ...readJson('settings.json', defaultSettings)
};

let history = readJson('telemetry.json', []);
let alerts = readJson('alerts.json', []);

let latest = null;
let mqttConnected = false;
let lastMessageAt = null;
let emailTransporter = null;

const alertState = {
  lowFruitActive: false,
  highGasActive: false
};

function saveSettings() {
  writeJson('settings.json', settings);
}

function saveHistory() {
  const cutoff = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;

  history = history.filter(item => {
    const timestamp = Date.parse(item.timestamp);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });

  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY);
  }

  writeJson('telemetry.json', history);
}

function saveAlerts() {
  alerts = alerts.slice(-1000);
  writeJson('alerts.json', alerts);
}

function addAlert(type, message, value) {
  const alert = {
    id: crypto.randomUUID(),
    type,
    message,
    value: value ?? null,
    timestamp: new Date().toISOString(),
    emailSent: false
  };

  alerts.push(alert);
  saveAlerts();

  sendAlertEmail(alert).catch(error => {
    console.error('Email alert failed:', error.message);
  });

  return alert;
}

function createEmailTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;

  if (!host || !user || !password) {
    console.warn('Email is not configured. Set SMTP variables in Render.');
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: { user, pass: password }
  });
}

emailTransporter = createEmailTransporter();

async function sendAlertEmail(alert) {
  if (!emailTransporter) {
    console.warn('Alert saved, but email is not configured.');
    return;
  }

  const recipient = settings.recipientEmail;

  if (!recipient || !recipient.includes('@')) {
    console.warn('No valid alert recipient is configured.');
    return;
  }

  await emailTransporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: recipient,
    subject: `FreshNest Alert: ${alert.type}`,
    text: [
      'FreshNest Smart Fruit Basket',
      '',
      alert.message,
      `Reading: ${alert.value ?? 'Not available'}`,
      `Time: ${alert.timestamp}`,
      '',
      'This is an automatic alert from your FreshNest monitoring system.'
    ].join('\n')
  });

  const storedAlert = alerts.find(item => item.id === alert.id);

  if (storedAlert) {
    storedAlert.emailSent = true;
    saveAlerts();
  }

  console.log(`Alert email sent to ${recipient}`);
}

function calculateFruitPercentage(distanceCm) {
  const height = Number(settings.basketHeightCm);
  const fullDistance = Number(settings.fullDistanceCm);

  if (!Number.isFinite(distanceCm) ||
      !Number.isFinite(height) ||
      !Number.isFinite(fullDistance) ||
      height <= fullDistance) {
    return null;
  }

  // The sensor measures the empty space above the fruit.
  const usableDistance = Math.max(
    0,
    Math.min(height - fullDistance, distanceCm - fullDistance)
  );

  const percentage =
    ((height - fullDistance - usableDistance) /
      (height - fullDistance)) * 100;

  return Math.round(Math.max(0, Math.min(100, percentage)));
}

function processTelemetry(payload) {
  const distanceCm = Number(payload.distanceCm);
  const gasRaw = Number(payload.gasRaw);

  if (!Number.isFinite(distanceCm) ||
      !Number.isFinite(gasRaw) ||
      distanceCm <= 0 ||
      gasRaw < 0) {
    console.warn('Ignored invalid sensor message.');
    return;
  }

  const fruitPercentage = calculateFruitPercentage(distanceCm);
  const timestamp = new Date().toISOString();

  latest = {
    distanceCm,
    gasRaw,
    fruitPercentage,
    sensorValid: payload.sensorValid !== false,
    timestamp,
    deviceName: String(payload.deviceName || 'FreshNest Basket')
  };

  lastMessageAt = timestamp;

  history.push(latest);
  saveHistory();

  const lowFruit =
    fruitPercentage !== null &&
    fruitPercentage < Number(settings.lowFruitThreshold);

  if (settings.lowFruitAlertsEnabled && lowFruit &&
      !alertState.lowFruitActive) {
    alertState.lowFruitActive = true;

    addAlert(
      'LOW_FRUIT',
      `Fruit level is ${fruitPercentage}%, below the configured ${settings.lowFruitThreshold}% threshold.`,
      fruitPercentage
    );
  } else if (!lowFruit) {
    alertState.lowFruitActive = false;
  }

  const gasThreshold = Number(settings.gasThreshold);
  const gasConfigured =
    settings.gasThreshold !== null &&
    settings.gasThreshold !== '' &&
    Number.isFinite(gasThreshold);

  const highGas = gasConfigured && gasRaw >= gasThreshold;

  if (settings.highGasAlertsEnabled && highGas &&
      !alertState.highGasActive) {
    alertState.highGasActive = true;

    addAlert(
      'HIGH_GAS',
      `Gas sensor reading ${gasRaw} reached or exceeded the configured threshold of ${gasThreshold}. Check the fruit and sensor.`,
      gasRaw
    );
  } else if (!highGas) {
    alertState.highGasActive = false;
  }
}

function startMqtt() {
  const host = process.env.MQTT_HOST;
  const username = process.env.MQTT_USERNAME;
  const password = process.env.MQTT_PASSWORD;
  const topic = process.env.MQTT_TOPIC || 'freshnest/basket01/telemetry';

  if (!host || !username || !password) {
    console.error('MQTT is not configured. Set MQTT variables in Render.');
    return;
  }

  const client = mqtt.connect(`mqtts://${host}:${process.env.MQTT_PORT || 8883}`, {
    username,
    password,
    clientId: `freshnest-server-${crypto.randomBytes(6).toString('hex')}`,
    clean: true,
    connectTimeout: 15000,
    reconnectPeriod: 5000,
    rejectUnauthorized: true
  });

  client.on('connect', () => {
    mqttConnected = true;
    console.log('Connected to EMQX over secure MQTT.');

    client.subscribe(topic, { qos: 0 }, error => {
      if (error) {
        console.error('MQTT subscribe failed:', error.message);
      } else {
        console.log(`Subscribed to ${topic}`);
      }
    });
  });

  client.on('reconnect', () => {
    mqttConnected = false;
    console.log('Reconnecting to EMQX...');
  });

  client.on('close', () => {
    mqttConnected = false;
  });

  client.on('error', error => {
    mqttConnected = false;
    console.error('MQTT error:', error.message);
  });

  client.on('message', (receivedTopic, buffer) => {
    try {
      const payload = JSON.parse(buffer.toString('utf8'));
      processTelemetry(payload);
    } catch (error) {
      console.error('Invalid MQTT JSON payload:', error.message);
    }
  });

  return client;
}

function requireAdmin(req, res, next) {
  const expectedUsername = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;
  const header = req.headers.authorization || '';

  if (!expectedUsername || !expectedPassword) {
    return res.status(503).json({
      error: 'Admin login is not configured on the server.'
    });
  }

  if (!header.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="FreshNest Admin"');
    return res.status(401).json({ error: 'Admin login required.' });
  }

  let decoded;

  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return res.status(401).json({ error: 'Invalid login.' });
  }

  const separator = decoded.indexOf(':');

  if (separator < 0) {
    return res.status(401).json({ error: 'Invalid login.' });
  }

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  const safeEqual = (a, b) => {
    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);

    return aBuffer.length === bBuffer.length &&
      crypto.timingSafeEqual(aBuffer, bBuffer);
  };

  if (!safeEqual(username, expectedUsername) ||
      !safeEqual(password, expectedPassword)) {
    return res.status(401).json({ error: 'Incorrect login.' });
  }

  next();
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mqttConnected,
    lastMessageAt,
    serverTime: new Date().toISOString()
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    mqttConnected,
    lastMessageAt,
    latest,
    settings: {
      basketHeightCm: settings.basketHeightCm,
      fullDistanceCm: settings.fullDistanceCm,
      lowFruitThreshold: settings.lowFruitThreshold,
      gasThreshold: settings.gasThreshold,
      lowFruitAlertsEnabled: settings.lowFruitAlertsEnabled,
      highGasAlertsEnabled: settings.highGasAlertsEnabled
    }
  });
});

app.get('/api/history', (req, res) => {
  const requestedLimit = Number(req.query.limit || 500);
  const limit = Math.max(1, Math.min(2000, requestedLimit));

  res.json({
    history: history.slice(-limit)
  });
});

app.get('/api/alerts', (req, res) => {
  res.json({
    alerts: alerts.slice(-100).reverse()
  });
});

app.get('/api/settings', requireAdmin, (req, res) => {
  res.json({ settings });
});

app.put('/api/settings', requireAdmin, (req, res) => {
  const body = req.body || {};
  const next = { ...settings };

  if (body.basketHeightCm !== undefined) {
    const value = Number(body.basketHeightCm);

    if (!Number.isFinite(value) || value < 5 || value > 200) {
      return res.status(400).json({
        error: 'Basket height must be between 5 and 200 cm.'
      });
    }

    next.basketHeightCm = value;
  }

  if (body.fullDistanceCm !== undefined) {
    const value = Number(body.fullDistanceCm);

    if (!Number.isFinite(value) || value < 0 || value >= next.basketHeightCm) {
      return res.status(400).json({
        error: 'Full distance must be non-negative and less than basket height.'
      });
    }

    next.fullDistanceCm = value;
  }

  if (body.lowFruitThreshold !== undefined) {
    const value = Number(body.lowFruitThreshold);

    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return res.status(400).json({
        error: 'Low fruit threshold must be between 0 and 100%.'
      });
    }

    next.lowFruitThreshold = value;
  }

  if (body.gasThreshold !== undefined) {
    if (body.gasThreshold === null || body.gasThreshold === '') {
      next.gasThreshold = null;
    } else {
      const value = Number(body.gasThreshold);

      if (!Number.isFinite(value) || value < 0 || value > 4095) {
        return res.status(400).json({
          error: 'Gas threshold must be between 0 and 4095.'
        });
      }

      next.gasThreshold = value;
    }
  }

  if (body.recipientEmail !== undefined) {
    const email = String(body.recipientEmail).trim();

    if (email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        error: 'Enter a valid receiving email address.'
      });
    }

    next.recipientEmail = email;
  }

  if (body.lowFruitAlertsEnabled !== undefined) {
    if (typeof body.lowFruitAlertsEnabled !== 'boolean') {
      return res.status(400).json({
        error: 'lowFruitAlertsEnabled must be true or false.'
      });
    }

    next.lowFruitAlertsEnabled = body.lowFruitAlertsEnabled;
  }

  if (body.highGasAlertsEnabled !== undefined) {
    if (typeof body.highGasAlertsEnabled !== 'boolean') {
      return res.status(400).json({
        error: 'highGasAlertsEnabled must be true or false.'
      });
    }

    next.highGasAlertsEnabled = body.highGasAlertsEnabled;
  }

  settings = next;
  saveSettings();

  res.json({
    message: 'Settings saved.',
    settings
  });
});

app.post('/api/admin/test-email', requireAdmin, async (req, res) => {
  if (!emailTransporter) {
    return res.status(503).json({
      error: 'Email is not configured. Check SMTP settings in Render.'
    });
  }

  try {
    await emailTransporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: settings.recipientEmail,
      subject: 'FreshNest test email',
      text: 'Your FreshNest email alert setup is working.'
    });

    res.json({ message: 'Test email sent.' });
  } catch (error) {
    console.error('Test email failed:', error.message);

    res.status(500).json({
      error: 'Could not send test email. Check the server logs and SMTP settings.'
    });
  }
});

app.get('/', (req, res) => {
  res.json({
    name: 'FreshNest Smart Fruit Basket API',
    status: 'running'
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`FreshNest server listening on port ${PORT}`);
  startMqtt();
});

function shutdown() {
  console.log('Shutting down FreshNest...');

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

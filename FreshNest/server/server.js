require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json({ limit: '20kb' }));

// Serve only the website entry point; do not expose project files as static assets.
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));

const PORT = Number(process.env.PORT || 3000);
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || 'change-me-before-use';
let latest = { deviceName: 'FreshNest-Basket-01', weightKg: 0, gasRaw: 0, gas2Raw: 0, updatedAt: null };

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'FreshNest API' }));
app.get('/api/readings', (_req, res) => res.json(latest));
app.post('/api/readings', (req, res) => {
  const token = req.get('x-device-token');
  if (!token || token !== DEVICE_TOKEN) return res.status(401).json({ error: 'Unauthorized device' });
  const { deviceName, weightKg, gasRaw, gas2Raw } = req.body || {};
  if (![weightKg, gasRaw].every(v => typeof v === 'number' && Number.isFinite(v)) || weightKg < 0 || gasRaw < 0) {
    return res.status(400).json({ error: 'weightKg and gasRaw must be non-negative numbers' });
  }
  latest = {
    deviceName: typeof deviceName === 'string' ? deviceName.slice(0, 80) : 'FreshNest-Basket-01',
    weightKg,
    gasRaw: Math.round(gasRaw),
    gas2Raw: typeof gas2Raw === 'number' && Number.isFinite(gas2Raw) ? Math.round(gas2Raw) : null,
    updatedAt: new Date().toISOString()
  };
  res.json({ ok: true, reading: latest });
});
app.listen(PORT, '0.0.0.0', () => console.log(`FreshNest API listening on port ${PORT}`));

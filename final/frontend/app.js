
'use strict';

/* =========================================
   FRESHNEST FRONTEND APPLICATION
========================================= */

// Replace this with your actual Render backend URL.
// Example: https://your-freshnest-service.onrender.com
const API_BASE_URL = 'https://YOUR-RENDER-SERVICE.onrender.com';

const REFRESH_INTERVAL_MS = 500;
const MAX_CHART_POINTS = 100;

const $ = id => document.getElementById(id);

const state = {
  status: null,
  history: [],
  alerts: [],
  settings: null,
  currentPage: 'overview',
  adminAuth: null,
  requestInProgress: false,
  lastStatusSuccess: 0,
  lastHistoryFetch: 0,
  lastAlertsFetch: 0
};

const pageDescriptions = {
  overview: 'Your fruit basket, intelligently monitored.',
  monitor: 'Monitor the latest readings received from your ESP32.',
  alerts: 'Review important events from your smart fruit basket.',
  history: 'Explore recorded readings from the last seven days.',
  settings: 'Configure basket calibration and email alerts.'
};

const pageTitles = {
  overview: 'Overview',
  monitor: 'Live monitoring',
  alerts: 'Alerts',
  history: 'Sensor history',
  settings: 'Settings'
};

/* =========================================
   TOAST NOTIFICATIONS
========================================= */

function showToast(message, type = 'info') {
  const container = $('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 4500);
}

/* =========================================
   API HELPERS
========================================= */

function getApiBase() {
  return API_BASE_URL.replace(/\/+$/, '');
}

function isApiConfigured() {
  return !getApiBase().includes('YOUR-RENDER-SERVICE');
}

function getAuthHeaders() {
  if (!state.adminAuth) return {};

  return {
    Authorization: `Basic ${state.adminAuth}`
  };
}

async function apiRequest(endpoint, options = {}) {
  if (!isApiConfigured()) {
    throw new Error(
      'Set API_BASE_URL in frontend/app.js to your deployed Render backend URL.'
    );
  }

  const headers = {
    Accept: 'application/json',
    ...getAuthHeaders(),
    ...(options.headers || {})
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let response;

  try {
    response = await fetch(`${getApiBase()}${endpoint}`, {
      ...options,
      headers,
      cache: 'no-store'
    });
  } catch {
    throw new Error(
      'Cannot reach the FreshNest backend. Check the Render URL and service status.'
    );
  }

  if (response.status === 401) {
    state.adminAuth = null;
    throw new Error('Admin login required or credentials are incorrect.');
  }

  let data = {};

  try {
    data = await response.json();
  } catch {
    // The server may have returned an empty or non-JSON response.
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }

  return data;
}

function showApiError(message) {
  const notice = $('apiNotice');
  const noticeText = $('apiNoticeText');

  if (notice && noticeText) {
    notice.classList.remove('hidden');
    noticeText.textContent = message;
  }
}

function hideApiError() {
  $('apiNotice')?.classList.add('hidden');
}

/* =========================================
   ADMIN LOGIN
========================================= */

function requestAdminLogin() {
  if (state.adminAuth) {
    const logout = window.confirm(
      'You are currently authenticated as admin. Log out?'
    );

    if (logout) {
      state.adminAuth = null;
      showToast('Admin session cleared.', 'success');
    }

    return;
  }

  const username = window.prompt('Enter your FreshNest admin username:');

  if (username === null || !username.trim()) return;

  const password = window.prompt('Enter your FreshNest admin password:');

  if (password === null || !password) return;

  state.adminAuth = btoa(`${username}:${password}`);

  showToast('Credentials entered. They will be checked by the server.', 'info');
  loadSettings(true);
}

/* =========================================
   NAVIGATION
========================================= */

function showPage(pageName) {
  if (!pageTitles[pageName]) return;

  state.currentPage = pageName;

  document.querySelectorAll('.page').forEach(page => {
    page.classList.toggle('active', page.id === `page-${pageName}`);
  });

  document.querySelectorAll('.nav-link').forEach(button => {
    button.classList.toggle(
      'active',
      button.dataset.page === pageName
    );
  });

  if ($('breadcrumbPage')) {
    $('breadcrumbPage').textContent = pageTitles[pageName];
  }

  if ($('headerSubtitle')) {
    $('headerSubtitle').textContent = pageDescriptions[pageName];
  }

  $('sidebar')?.classList.remove('open');

  if (pageName === 'alerts') {
    loadAlerts(true);
  }

  if (pageName === 'history') {
    loadHistory(true);
  }

  if (pageName === 'settings') {
    loadSettings(false);
  }

  window.dispatchEvent(new Event('resize'));
}

function setupNavigation() {
  document.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click', () => {
      showPage(button.dataset.page);
    });
  });

  document.querySelectorAll('[data-goto]').forEach(button => {
    button.addEventListener('click', () => {
      showPage(button.dataset.goto);
    });
  });

  $('menuButton')?.addEventListener('click', () => {
    $('sidebar')?.classList.toggle('open');
  });

  $('adminButton')?.addEventListener('click', requestAdminLogin);

  $('refreshButton')?.addEventListener('click', async () => {
    await refreshAll(true);
    showToast('Dashboard refreshed.', 'success');
  });

  $('refreshAlertsButton')?.addEventListener('click', () => {
    loadAlerts(true);
  });
}

/* =========================================
   FORMATTERS
========================================= */

function formatTime(value) {
  if (!value) return 'Waiting for data';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatDateTime(value) {
  if (!value) return 'Unknown';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function numberOrDash(value, decimals = 0) {
  if (value === null || value === undefined || value === '') {
    return '--';
  }

  const number = Number(value);

  if (!Number.isFinite(number)) return '--';

  return number.toFixed(decimals);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

/* =========================================
   CONNECTION STATUS
========================================= */

function setConnectionStatus(connected, hasData = false) {
  const text = connected ? 'Connected' : 'Disconnected';

  const dotIds = [
    'connectionDot',
    'sidebarStatusDot',
    'deviceStatusDot'
  ];

  dotIds.forEach(id => {
    const element = $(id);
    if (!element) return;

    element.classList.toggle('connected', connected);
    element.classList.toggle('disconnected', !connected);
  });

  if ($('connectionText')) {
    $('connectionText').textContent = connected
      ? 'MQTT connected'
      : 'MQTT offline';
  }

  if ($('sidebarConnection')) {
    $('sidebarConnection').textContent = text;
  }

  if ($('deviceStatus')) {
    $('deviceStatus').textContent = connected
      ? (hasData ? 'Online' : 'Connected')
      : 'Offline';
  }

  if ($('mqttStateLabel')) {
    $('mqttStateLabel').textContent = text;
  }

  if ($('diagMqtt')) {
    $('diagMqtt').textContent = text;
  }
}

/* =========================================
   LOAD BACKEND STATUS
========================================= */

async function loadStatus() {
  try {
    const data = await apiRequest('/api/status');

    state.status = data;
    state.settings = data.settings || state.settings;
    state.lastStatusSuccess = Date.now();

    hideApiError();

    const latest = data.latest;
    const connected = data.mqttConnected === true;

    setConnectionStatus(connected, Boolean(latest));

    if (latest) {
      renderLatest(latest);
    } else {
      renderNoReading();
    }

    renderSettingsSummary(data.settings || {});

    if ($('lastUpdated')) {
      $('lastUpdated').textContent = latest
        ? formatTime(latest.timestamp)
        : 'Waiting for data';
    }

    if ($('diagLastMessage')) {
      $('diagLastMessage').textContent =
        data.lastMessageAt ? formatDateTime(data.lastMessageAt) : 'No messages';
    }

    if ($('diagDeviceName')) {
      $('diagDeviceName').textContent =
        latest?.deviceName || 'FreshNest Basket';
    }

    if ($('diagSensorValidity')) {
      $('diagSensorValidity').textContent =
        latest ? (latest.sensorValid ? 'Valid' : 'Check sensor') : 'Unknown';
    }

    if ($('deviceDescription')) {
      $('deviceDescription').textContent = latest
        ? `Last sensor update at ${formatTime(latest.timestamp)}.`
        : 'Waiting for the first sensor message.';
    }
  } catch (error) {
    setConnectionStatus(false, false);
    showApiError(error.message);

    if (Date.now() - state.lastStatusSuccess > 15000) {
      renderNoReading();
    }
  }
}

function renderNoReading() {
  const ids = [
    'fruitPercentage',
    'gasReading',
    'fruitDistance',
    'gasStatus',
    'fruitStatus',
    'chartCurrentValue',
    'monitorFruitPercentage',
    'monitorDistance',
    'monitorGasReading',
    'monitorFruitStatus',
    'monitorGasStatus',
    'historyLatestFruit',
    'historyLatestGas'
  ];

  ids.forEach(id => {
    const element = $(id);
    if (!element) return;

    if (id === 'fruitDistance' || id === 'monitorDistance') {
      element.textContent = '-- cm';
    } else if (id === 'chartCurrentValue' ||
               id === 'monitorFruitPercentage' ||
               id === 'historyLatestFruit') {
      element.textContent = '--%';
    } else {
      element.textContent = '--';
    }
  });

  if ($('fruitProgress')) $('fruitProgress').style.width = '0%';
  if ($('basketLevelFill')) $('basketLevelFill').style.width = '0%';
  if ($('basketLevelLabel')) $('basketLevelLabel').textContent = '--% filled';
  if ($('gasMeter')) $('gasMeter').style.width = '0%';
  if ($('monitorGasProgress')) $('monitorGasProgress').style.width = '0%';

  if ($('fruitCircularMeter')) {
    $('fruitCircularMeter').style.background =
      'conic-gradient(#e8f0e9 0deg, #e8f0e9 360deg)';
  }

  if ($('chartEmpty')) $('chartEmpty').classList.remove('hidden');
  if ($('historyChartEmpty')) $('historyChartEmpty').classList.remove('hidden');
}

function renderLatest(latest) {
  const fruit = Number(latest.fruitPercentage);
  const gas = Number(latest.gasRaw);
  const distance = Number(latest.distanceCm);

  const validFruit = Number.isFinite(fruit) && fruit >= 0 && fruit <= 100;
  const validGas = Number.isFinite(gas) && gas >= 0;

  if ($('fruitPercentage')) {
    $('fruitPercentage').textContent = validFruit
      ? Math.round(fruit)
      : '--';
  }

  if ($('chartCurrentValue')) {
    $('chartCurrentValue').textContent = validFruit
      ? `${Math.round(fruit)}%`
      : '--%';
  }

  if ($('monitorFruitPercentage')) {
    $('monitorFruitPercentage').textContent = validFruit
      ? `${Math.round(fruit)}%`
      : '--%';
  }

  if ($('fruitDistance')) {
    $('fruitDistance').textContent = Number.isFinite(distance)
      ? `${distance.toFixed(1)} cm`
      : '-- cm';
  }

  if ($('monitorDistance')) {
    $('monitorDistance').textContent = Number.isFinite(distance)
      ? `${distance.toFixed(1)} cm`
      : '-- cm';
  }

  if ($('fruitProgress')) {
    $('fruitProgress').style.width =
      validFruit ? `${Math.max(0, Math.min(100, fruit))}%` : '0%';
  }

  if ($('basketLevelFill')) {
    $('basketLevelFill').style.width =
      validFruit ? `${Math.max(0, Math.min(100, fruit))}%` : '0%';
  }

  if ($('basketLevelLabel')) {
    $('basketLevelLabel').textContent = validFruit
      ? `${Math.round(fruit)}% filled`
      : '--% filled';
  }

  if ($('fruitStatus')) {
    $('fruitStatus').textContent = getFruitStatus(fruit, validFruit);
  }

  if ($('monitorFruitStatus')) {
    $('monitorFruitStatus').textContent = getFruitStatus(fruit, validFruit);
  }

  if ($('fruitCircularMeter')) {
    const degrees = validFruit ? Math.max(0, Math.min(100, fruit)) * 3.6 : 0;

    $('fruitCircularMeter').style.background =
      `conic-gradient(var(--green-500) ${degrees}deg, #e8f0e9 ${degrees}deg)`;
  }

  if ($('gasReading')) {
    $('gasReading').textContent = validGas ? Math.round(gas) : '--';
  }

  if ($('monitorGasReading')) {
    $('monitorGasReading').textContent = validGas ? Math.round(gas) : '--';
  }

  const gasPercent = validGas
    ? Math.max(0, Math.min(100, (gas / 4095) * 100))
    : 0;

  if ($('gasMeter')) {
    $('gasMeter').style.width = `${gasPercent}%`;
  }

  if ($('monitorGasProgress')) {
    $('monitorGasProgress').style.width = `${gasPercent}%`;
  }

  const gasThreshold = state.settings?.gasThreshold;
  const hasGasThreshold =
    gasThreshold !== null &&
    gasThreshold !== undefined &&
    gasThreshold !== '' &&
    Number.isFinite(Number(gasThreshold));

  const highGas = validGas && hasGasThreshold &&
    gas >= Number(gasThreshold);

  if ($('gasStatus')) {
    $('gasStatus').textContent = !validGas
      ? 'Awaiting reading'
      : !hasGasThreshold
        ? 'Not calibrated'
        : highGas
          ? 'Threshold reached'
          : 'Within threshold';
  }

  if ($('monitorGasStatus')) {
    $('monitorGasStatus').textContent = !validGas
      ? 'Awaiting data'
      : !hasGasThreshold
        ? 'Not calibrated'
        : highGas
          ? 'Threshold reached'
          : 'Within threshold';
  }

  if ($('gasThresholdLabel')) {
    $('gasThresholdLabel').textContent = hasGasThreshold
      ? `Threshold: ${Number(gasThreshold)}`
      : 'Threshold: unset';
  }

  if ($('monitorGasThreshold')) {
    $('monitorGasThreshold').textContent = hasGasThreshold
      ? String(gasThreshold)
      : 'Not set';
  }

  if ($('basketEmoji')) {
    $('basketEmoji').textContent = !validFruit
      ? '🍎'
      : fruit <= 15
        ? '🧺'
        : fruit <= 40
          ? '🍊'
          : '🍎';
  }

  if ($('lastUpdated')) {
    $('lastUpdated').textContent = formatTime(latest.timestamp);
  }

  if ($('historyLatestFruit')) {
    $('historyLatestFruit').textContent = validFruit
      ? `${Math.round(fruit)}%`
      : '--%';
  }

  if ($('historyLatestGas')) {
    $('historyLatestGas').textContent = validGas
      ? String(Math.round(gas))
      : '--';
  }

  if ($('deviceDescription')) {
    $('deviceDescription').textContent =
      `Latest sensor update: ${formatTime(latest.timestamp)}.`;
  }
}

function getFruitStatus(fruit, valid) {
  if (!valid) return 'Waiting for sensor';

  const threshold = Number(
    state.settings?.lowFruitThreshold ?? 15
  );

  if (fruit < threshold) return 'Low fruit level';
  if (fruit < 40) return 'Fruit running low';
  if (fruit < 75) return 'Good fruit level';

  return 'Basket well stocked';
}

function renderSettingsSummary(settings) {
  if ($('basketHeightLabel')) {
    $('basketHeightLabel').textContent =
      `${settings.basketHeightCm ?? 40} cm`;
  }

  if ($('lowThresholdLabel')) {
    $('lowThresholdLabel').textContent =
      `${settings.lowFruitThreshold ?? 15}%`;
  }
}

/* =========================================
   LOAD HISTORY
========================================= */

async function loadHistory(force = false) {
  if (!force && Date.now() - state.lastHistoryFetch < 5000) {
    return;
  }

  try {
    const data = await apiRequest('/api/history?limit=2000');

    state.history = Array.isArray(data.history)
      ? data.history
      : [];

    state.lastHistoryFetch = Date.now();

    renderHistory();
  } catch (error) {
    console.error('History request failed:', error.message);
  }
}

function renderHistory() {
  const items = state.history;
  const latest = items.length ? items[items.length - 1] : null;

  if ($('historyTotal')) {
    $('historyTotal').textContent = String(items.length);
  }

  if ($('historyLatestFruit')) {
    $('historyLatestFruit').textContent =
      latest && Number.isFinite(Number(latest.fruitPercentage))
        ? `${Math.round(Number(latest.fruitPercentage))}%`
        : '--%';
  }

  if ($('historyLatestGas')) {
    $('historyLatestGas').textContent =
      latest && Number.isFinite(Number(latest.gasRaw))
        ? String(Math.round(Number(latest.gasRaw)))
        : '--';
  }

  drawLineChart(
    $('fruitChart'),
    items.slice(-MAX_CHART_POINTS),
    'fruitPercentage',
    $('chartEmpty')
  );

  drawLineChart(
    $('historyChart'),
    items.slice(-MAX_CHART_POINTS),
    'fruitPercentage',
    $('historyChartEmpty')
  );

  renderHistoryTable(items.slice(-200).reverse());
}

function renderHistoryTable(items) {
  const tbody = $('historyTableBody');
  if (!tbody) return;

  if (!items.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="table-empty">
          No sensor readings received yet.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = items.map(item => {
    const fruit = Number(item.fruitPercentage);
    const distance = Number(item.distanceCm);
    const gas = Number(item.gasRaw);

    return `
      <tr>
        <td>${escapeHtml(formatDateTime(item.timestamp))}</td>
        <td>${Number.isFinite(fruit) ? `${Math.round(fruit)}%` : '--'}</td>
        <td>${Number.isFinite(distance) ? `${distance.toFixed(1)} cm` : '--'}</td>
        <td>${Number.isFinite(gas) ? Math.round(gas) : '--'}</td>
        <td>${item.sensorValid === false ? 'Check sensor' : 'Received'}</td>
      </tr>
    `;
  }).join('');
}

/* =========================================
   CANVAS LINE CHART
========================================= */

function drawLineChart(canvas, items, key, emptyElement) {
  if (!canvas) return;

  const validItems = items.filter(item =>
    Number.isFinite(Number(item[key]))
  );

  if (!validItems.length) {
    if (emptyElement) emptyElement.classList.remove('hidden');

    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  if (emptyElement) emptyElement.classList.add('hidden');

  const bounds = canvas.getBoundingClientRect();

  if (bounds.width <= 0 || bounds.height <= 0) {
    return;
  }

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.floor(bounds.width);
  const height = Math.floor(bounds.height);

  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);

  const ctx = canvas.getContext('2d');

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const padding = {
    top: 14,
    right: 12,
    bottom: 28,
    left: 34
  };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  if (chartWidth <= 0 || chartHeight <= 0) return;

  const minY = 0;
  const maxY = 100;

  ctx.font = '10px "DM Sans", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;

  // Horizontal grid and Y-axis labels.
  [0, 25, 50, 75, 100].forEach(value => {
    const y = padding.top +
      chartHeight -
      ((value - minY) / (maxY - minY)) * chartHeight;

    ctx.beginPath();
    ctx.strokeStyle = '#edf2ed';
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();

    ctx.fillStyle = '#91a096';
    ctx.textAlign = 'right';
    ctx.fillText(String(value), padding.left - 8, y);
  });

  const points = validItems.map((item, index) => {
    const value = Math.max(0, Math.min(100, Number(item[key])));

    const x = padding.left +
      (validItems.length === 1
        ? chartWidth / 2
        : (index / (validItems.length - 1)) * chartWidth);

    const y = padding.top +
      chartHeight -
      ((value - minY) / (maxY - minY)) * chartHeight;

    return { x, y, value, item };
  });

  // Area fill.
  if (points.length > 1) {
    const gradient = ctx.createLinearGradient(
      0,
      padding.top,
      0,
      padding.top + chartHeight
    );

    gradient.addColorStop(0, 'rgba(64, 174, 112, 0.20)');
    gradient.addColorStop(1, 'rgba(64, 174, 112, 0.01)');

    ctx.beginPath();
    ctx.moveTo(points[0].x, padding.top + chartHeight);

    points.forEach(point => {
      ctx.lineTo(point.x, point.y);
    });

    ctx.lineTo(
      points[points.length - 1].x,
      padding.top + chartHeight
    );

    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  // Line.
  ctx.beginPath();

  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });

  ctx.strokeStyle = '#36a962';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // Latest point.
  const latestPoint = points[points.length - 1];

  ctx.beginPath();
  ctx.arc(latestPoint.x, latestPoint.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(latestPoint.x, latestPoint.y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = '#36a962';
  ctx.fill();

  // Time labels.
  ctx.fillStyle = '#91a096';
  ctx.textAlign = 'left';
  ctx.fillText(
    formatTime(validItems[0].timestamp),
    padding.left,
    height - 9
  );

  ctx.textAlign = 'right';
  ctx.fillText(
    formatTime(validItems[validItems.length - 1].timestamp),
    width - padding.right,
    height - 9
  );
}

/* =========================================
   ALERTS
========================================= */

async function loadAlerts(force = false) {
  if (!force && Date.now() - state.lastAlertsFetch < 5000) {
    return;
  }

  try {
    const data = await apiRequest('/api/alerts');

    state.alerts = Array.isArray(data.alerts)
      ? data.alerts
      : [];

    state.lastAlertsFetch = Date.now();

    renderAlerts();
  } catch (error) {
    console.error('Alert request failed:', error.message);
  }
}

function getAlertDetails(alert) {
  if (alert.type === 'LOW_FRUIT') {
    return {
      title: 'Low fruit level',
      icon: '↓',
      symbolClass: 'low-fruit'
    };
  }

  if (alert.type === 'HIGH_GAS') {
    return {
      title: 'High gas sensor reading',
      icon: '⌁',
      symbolClass: 'high-gas'
    };
  }

  return {
    title: alert.type || 'System event',
    icon: 'i',
    symbolClass: 'info'
  };
}

function renderAlertItem(alert) {
  const details = getAlertDetails(alert);

  const emailStatus = alert.emailSent
    ? '<span class="email-status">✓ Email sent</span>'
    : '<span class="email-status failed">Email not confirmed</span>';

  return `
    <div class="alert-row">
      <div class="alert-symbol ${details.symbolClass}">
        ${details.icon}
      </div>

      <div class="alert-content">
        <strong>${escapeHtml(details.title)}</strong>
        <p>${escapeHtml(alert.message || 'No additional details.')}</p>

        <div class="alert-meta">
          <span>${escapeHtml(formatDateTime(alert.timestamp))}</span>
          ${alert.value !== null && alert.value !== undefined
            ? `<span>Reading: ${escapeHtml(alert.value)}</span>`
            : ''}
          ${emailStatus}
        </div>
      </div>
    </div>
  `;
}

function renderAlerts() {
  const all = state.alerts;
  const recent = all.slice(0, 4);

  if ($('alertCount')) {
    $('alertCount').textContent = String(all.length);
  }

  if ($('activeAlerts')) {
    $('activeAlerts').textContent = String(all.length);
  }

  const lowFruitCount = all.filter(a => a.type === 'LOW_FRUIT').length;
  const highGasCount = all.filter(a => a.type === 'HIGH_GAS').length;
  const emailsSent = all.filter(a => a.emailSent === true).length;

  if ($('lowFruitAlertCount')) {
    $('lowFruitAlertCount').textContent = String(lowFruitCount);
  }

  if ($('highGasAlertCount')) {
    $('highGasAlertCount').textContent = String(highGasCount);
  }

  if ($('emailsSentCount')) {
    $('emailsSentCount').textContent = String(emailsSent);
  }

  if ($('recentAlerts')) {
    $('recentAlerts').innerHTML = recent.length
      ? recent.map(renderAlertItem).join('')
      : `
        <div class="empty-state">
          <span class="empty-state-icon">✓</span>
          <strong>All quiet for now</strong>
          <p>New alerts will appear here when sensor readings cross configured thresholds.</p>
        </div>
      `;
  }

  if ($('allAlerts')) {
    $('allAlerts').innerHTML = all.length
      ? all.map(renderAlertItem).join('')
      : `
        <div class="empty-state">
          <span class="empty-state-icon">✓</span>
          <strong>No alerts yet</strong>
          <p>Alerts will appear here when configured conditions are triggered.</p>
        </div>
      `;
  }
}

/* =========================================
   SETTINGS
========================================= */

async function loadSettings(showErrors = false) {
  try {
    const data = await apiRequest('/api/settings');

    state.settings = data.settings || {};

    populateSettingsForm(state.settings);
    renderSettingsSummary(state.settings);

    if ($('settingsSaveStatus')) {
      $('settingsSaveStatus').textContent = 'Settings loaded';
      $('settingsSaveStatus').classList.add('saved');
    }
  } catch (error) {
    if (showErrors || state.currentPage === 'settings') {
      showToast(error.message, 'error');
    }

    if ($('settingsMessage')) {
      $('settingsMessage').textContent = error.message;
      $('settingsMessage').classList.add('error');
    }
  }
}

function populateSettingsForm(settings) {
  const values = {
    basketHeightInput: settings.basketHeightCm ?? 40,
    fullDistanceInput: settings.fullDistanceCm ?? 2,
    lowThresholdInput: settings.lowFruitThreshold ?? 15,
    gasThresholdInput: settings.gasThreshold ?? '',
    recipientEmailInput: settings.recipientEmail ?? 'rdstechnics@gmail.com'
  };

  Object.entries(values).forEach(([id, value]) => {
    const element = $(id);
    if (element) element.value = value;
  });

  if ($('lowAlertsEnabled')) {
    $('lowAlertsEnabled').checked =
      settings.lowFruitAlertsEnabled !== false;
  }

  if ($('highGasAlertsEnabled')) {
    $('highGasAlertsEnabled').checked =
      settings.highGasAlertsEnabled !== false;
  }
}

async function saveSettings(event) {
  event.preventDefault();

  const message = $('settingsMessage');
  const saveButton = $('saveSettingsButton');

  if (message) {
    message.textContent = '';
    message.classList.remove('error');
  }

  const payload = {
    basketHeightCm: Number($('basketHeightInput').value),
    fullDistanceCm: Number($('fullDistanceInput').value),
    lowFruitThreshold: Number($('lowThresholdInput').value),
    gasThreshold: $('gasThresholdInput').value.trim() === ''
      ? null
      : Number($('gasThresholdInput').value),
    recipientEmail: $('recipientEmailInput').value.trim(),
    lowFruitAlertsEnabled: $('lowAlertsEnabled').checked,
    highGasAlertsEnabled: $('highGasAlertsEnabled').checked
  };

  if (!Number.isFinite(payload.basketHeightCm) ||
      payload.basketHeightCm < 5 ||
      payload.basketHeightCm > 200) {
    showToast('Basket height must be between 5 and 200 cm.', 'error');
    return;
  }

  if (!Number.isFinite(payload.fullDistanceCm) ||
      payload.fullDistanceCm < 0 ||
      payload.fullDistanceCm >= payload.basketHeightCm) {
    showToast(
      'Full distance must be non-negative and less than basket height.',
      'error'
    );
    return;
  }

  if (!Number.isFinite(payload.lowFruitThreshold) ||
      payload.lowFruitThreshold < 0 ||
      payload.lowFruitThreshold > 100) {
    showToast('Low fruit threshold must be between 0 and 100%.', 'error');
    return;
  }

  if (payload.gasThreshold !== null &&
      (!Number.isFinite(payload.gasThreshold) ||
       payload.gasThreshold < 0 ||
       payload.gasThreshold > 4095)) {
    showToast('Gas threshold must be between 0 and 4095.', 'error');
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.recipientEmail)) {
    showToast('Enter a valid receiving email address.', 'error');
    return;
  }

  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
  }

  try {
    const data = await apiRequest('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });

    state.settings = data.settings;

    populateSettingsForm(state.settings);
    renderSettingsSummary(state.settings);

    if (message) {
      message.textContent = 'Settings saved successfully.';
      message.classList.remove('error');
    }

    if ($('settingsSaveStatus')) {
      $('settingsSaveStatus').textContent = 'Saved';
      $('settingsSaveStatus').classList.add('saved');
    }

    showToast('FreshNest settings saved.', 'success');

    await loadStatus();
  } catch (error) {
    if (message) {
      message.textContent = error.message;
      message.classList.add('error');
    }

    showToast(error.message, 'error');
  } finally {
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = 'Save settings';
    }
  }
}

async function sendTestEmail() {
  const button = $('testEmailButton');
  if (!button) return;

  button.disabled = true;
  button.textContent = 'Sending...';

  try {
    await apiRequest('/api/admin/test-email', {
      method: 'POST',
      body: JSON.stringify({})
    });

    showToast('Test email sent successfully.', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Send test email';
  }
}

/* =========================================
   CSV EXPORT
========================================= */

function exportHistoryCSV() {
  if (!state.history.length) {
    showToast('There are no readings to export yet.', 'error');
    return;
  }

  const rows = [
    [
      'Timestamp',
      'Fruit Percentage',
      'Distance CM',
      'Gas Raw',
      'Sensor Valid',
      'Device Name'
    ]
  ];

  state.history.forEach(item => {
    rows.push([
      item.timestamp ?? '',
      item.fruitPercentage ?? '',
      item.distanceCm ?? '',
      item.gasRaw ?? '',
      item.sensorValid === false ? 'false' : 'true',
      item.deviceName ?? ''
    ]);
  });

  const csv = rows.map(row =>
    row.map(value => {
      const text = String(value);
      return `"${text.replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\r\n');

  const blob = new Blob(
    ['\uFEFF', csv],
    { type: 'text/csv;charset=utf-8;' }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = `freshnest-history-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);

  showToast('CSV history exported.', 'success');
}

/* =========================================
   REFRESH LOOP
========================================= */

async function refreshAll(force = false) {
  if (state.requestInProgress) return;

  state.requestInProgress = true;

  try {
    await loadStatus();

    const now = Date.now();

    if (force || now - state.lastHistoryFetch >= 5000) {
      await loadHistory(true);
    }

    if (force || now - state.lastAlertsFetch >= 5000) {
      await loadAlerts(true);
    }
  } finally {
    state.requestInProgress = false;
  }
}

/* =========================================
   INITIALIZATION
========================================= */

function setupSettings() {
  $('settingsForm')?.addEventListener('submit', saveSettings);
  $('testEmailButton')?.addEventListener('click', sendTestEmail);
  $('exportHistoryButton')?.addEventListener('click', exportHistoryCSV);

  $('basketHeightInput')?.addEventListener('input', () => {
    if ($('settingsSaveStatus')) {
      $('settingsSaveStatus').textContent = 'Unsaved changes';
      $('settingsSaveStatus').classList.remove('saved');
    }
  });

  $('fullDistanceInput')?.addEventListener('input', () => {
    if ($('settingsSaveStatus')) {
      $('settingsSaveStatus').textContent = 'Unsaved changes';
      $('settingsSaveStatus').classList.remove('saved');
    }
  });

  $('lowThresholdInput')?.addEventListener('input', () => {
    if ($('settingsSaveStatus')) {
      $('settingsSaveStatus').textContent = 'Unsaved changes';
      $('settingsSaveStatus').classList.remove('saved');
    }
  });
}

function initialize() {
  setupNavigation();
  setupSettings();

  if (!isApiConfigured()) {
    showApiError(
      'Open frontend/app.js and replace YOUR-RENDER-SERVICE with your real Render service hostname.'
    );
  }

  refreshAll(true);

  window.setInterval(() => {
    refreshAll(false);
  }, REFRESH_INTERVAL_MS);

  window.addEventListener('resize', () => {
    if (state.history.length) {
      drawLineChart(
        $('fruitChart'),
        state.history.slice(-MAX_CHART_POINTS),
        'fruitPercentage',
        $('chartEmpty')
      );

      drawLineChart(
        $('historyChart'),
        state.history.slice(-MAX_CHART_POINTS),
        'fruitPercentage',
        $('historyChartEmpty')
      );
    }
  });
}

document.addEventListener('DOMContentLoaded', initialize);

// server_launch_skyplot.js
// GNSS-SDR web monitor (PVT + channels + map + time-series)
// with simple GNSS-SDR launcher (two configs) and El/Az columns (no skyplot)

const http = require("http");
const dgram = require("dgram");
const WebSocket = require("ws");
const protobuf = require("protobufjs");
const { spawn } = require("child_process");
const os = require("os");
const path = require("path");

// ----------------- Configuration -----------------
const HTTP_PORT       = 4242;
const UDP_PORT_OBS    = 1112; // Monitor.udp_port
const UDP_PORT_PVT    = 1111; // PVT.monitor_udp_port
const MAX_PLOT_POINTS = 300;  // Initial default, user can change via slider

// GNSS-SDR executable and configs
const GNSS_CMD   = "gnss-sdr";
const GNSS_BASE = process.env.GNSS_SDR_HOME || path.join(os.homedir(), "gnss-sdr");
const GNSS_CONF1 = path.join(GNSS_BASE, "conf", "File_input", "file_GPS_L1_alta_dinamica.conf");
const GNSS_CONF2 = path.join(GNSS_BASE, "conf", "RealTime_input", "all_bands_rtl_realtime.conf");

// Track child process we spawn
let gnssProcess = null;
let gnssCurrentConfig = null;

// --- UI Dependencies: Chart.js ---
const CHART_JS_CDN = "https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js";

// ------------- HTML UI -------------
const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>GNSS-SDR Live Monitor</title>
  <script src="${CHART_JS_CDN}"></script>

  <!-- Leaflet (OpenStreetMap) -->
  <link
    rel="stylesheet"
    href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
    integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
    crossorigin=""
  />
  <script
    src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
    integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
    crossorigin=""
  ></script>

  <style>
    :root {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color-scheme: dark;
    }
    body {
      margin: 0;
      padding: 1.2rem 1.5rem 1.5rem;
      background: #020617;
      color: #e5e7eb;
    }
    h1 {
      margin: 0 0 0.25rem 0;
      font-size: 1.5rem;
      border-bottom: 2px solid #1f2937;
      padding-bottom: 0.5rem;
    }
    #subtitle {
      font-size: 0.85rem;
      opacity: 0.8;
      margin-bottom: 1rem;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
      gap: 1.5rem;
      align-items: flex-start;
    }
    .card {
      background: #0f172a;
      border-radius: 0.75rem;
      border: 1px solid #1f2937;
      padding: 1rem;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    }
    .card h2 {
      margin: 0 0 0.6rem 0;
      font-size: 1.05rem;
      color: #93c5fd;
    }
    .card small {
      opacity: 0.8;
      font-size: 0.75rem;
    }

    .pvt-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.5rem;
      margin-top: 0.5rem;
      font-size: 0.9rem;
    }
    .pvt-label {
      opacity: 0.75;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      grid-column: 1 / span 3;
      border-top: 1px dashed #1e293b;
      padding-top: 0.4rem;
      margin-top: 0.4rem;
    }
    .pvt-label:first-child {
      border-top: none;
    }
    .pvt-value {
      font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
      font-weight: 500;
      color: #e5e7eb;
    }
    .pvt-dops-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
    }
    .pvt-dops-row .pvt-value {
      grid-column: 1 / span 2;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
      font-size: 0.75rem;
      background: #1e293b;
      border: 1px solid #334155;
      margin-top: 0.6rem;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
      70% { box-shadow: 0 0 0 10px rgba(34, 197, 94, 0); }
      100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
    }
    #pvt-dot-bad { background: #f97316; animation: none; }
    #pvt-dot-ok { background: #22c55e; }

    #pvt-age {
      opacity: 0.7;
      font-size: 0.7rem;
      margin-bottom: 0.5rem;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
      table-layout: fixed;
    }
    thead {
      background: #0f172a;
      position: sticky;
      top: 0;
      z-index: 2;
    }
    th, td {
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid #1e293b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    th {
      text-align: left;
      font-weight: 600;
      font-size: 0.75rem;
      opacity: 0.85;
      text-transform: uppercase;
    }
    .num {
      text-align: right;
      font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
    }
    #channels-container {
      max-height: 420px;
      overflow-y: auto;
      border-radius: 0.6rem;
      border: 1px solid #1f2937;
      margin-top: 0.8rem;
      background: #020617;
    }
    .cn0-good      { color: #22c55e; }
    .cn0-mid       { color: #eab308; }
    .cn0-bad       { color: #f97316; }
    .cn0-terrible  { color: #dc2626; text-decoration: underline wavy #dc2626; }

    #footer-log {
      margin-top: 1.5rem;
      font-size: 0.75rem;
      opacity: 0.6;
      font-family: "JetBrains Mono", "SF Mono", Menlo, monospace;
      white-space: pre-wrap;
      border-top: 1px solid #1f2937;
      padding-top: 0.6rem;
    }
    #ws-status {
      font-size: 0.78rem;
      opacity: 0.9;
    }
    .ws-ok { color: #4ade80; }
    .ws-bad { color: #f97316; }

    /* GNSS-SDR control card */
    #gnss-control-card {
      margin-bottom: 1rem;
    }
    .gnss-control-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      margin-top: 0.5rem;
    }
    .gnss-control-row button {
      border-radius: 999px;
      border: 1px solid #1e40af;
      background: #1d4ed8;
      color: #e5e7eb;
      padding: 0.25rem 0.8rem;
      font-size: 0.8rem;
      cursor: pointer;
    }
    .gnss-control-row button[disabled] {
      opacity: 0.5;
      cursor: default;
    }
    .gnss-control-row button.stop {
      border-color: #b91c1c;
      background: #b91c1c;
    }
    #gnss-status {
      font-size: 0.78rem;
      opacity: 0.9;
    }

    /* Map + plots in one row */
    .map-plots-row {
      display: grid;
      grid-template-columns: minmax(260px, 1.2fr) minmax(380px, 2fr);
      gap: 1rem;
      margin-top: 1.2rem;
      align-items: stretch;
    }
    @media (max-width: 1100px) {
      .map-plots-row {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 800px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }

    #map {
      width: 100%;
      height: 260px;
      border-radius: 0.6rem;
      overflow: hidden;
      margin-top: 0.6rem;
    }

    /* Plots stacked in one wide card */
    #plots-card h2 {
      margin-bottom: 0.25rem;
    }
    .plot-wrapper {
      margin-top: 0.9rem;
      border-top: 1px solid #1e293b;
      padding-top: 0.7rem;
    }
    .plot-wrapper:first-child {
      border-top: none;
      margin-top: 0.4rem;
      padding-top: 0;
    }
    .plot-title {
      font-size: 0.9rem;
      opacity: 0.95;
      margin-bottom: 0.3rem;
      color: #e0f2f1;
    }
    canvas {
      width: 100%;
      max-height: 190px;
      display: block;
    }

    /* Slider */
    #max-points-container {
      margin-top: 0.3rem;
      font-size: 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      opacity: 0.85;
    }
    #max-points-slider {
      flex: 1 1 140px;
    }
  </style>
</head>
<body>
  <h1>🛰️ GNSS-SDR Live Monitor</h1>
  <div id="subtitle">
    <span id="ws-status" class="ws-bad">WebSocket: connecting…</span>
  </div>

  <div class="grid">
    <section>
      <!-- GNSS-SDR CONTROL -->
      <section class="card" id="gnss-control-card">
        <h2>GNSS-SDR Control</h2>
        <small>Start/stop local gnss-sdr process</small>
        <div class="gnss-control-row">
          <button id="btn-gnss-start">Replay high dynamics</button>
          <button id="btn-gnss-start-2">Start GNSS-SDR (RTL Real-Time)</button>
          <button id="btn-gnss-stop" class="stop">Stop</button>
          <span id="gnss-status">Status: unknown</span>
        </div>
      </section>

      <!-- PVT CARD -->
      <section class="card">
        <h2>Position, Velocity, Time (PVT)</h2>
        <small id="pvt-age">No data yet</small>

        <div class="pvt-label">Geographic Coordinates</div>
        <div class="pvt-row">
          <div class="pvt-value" id="pvt-lat">Lat: –</div>
          <div class="pvt-value" id="pvt-lon">Lon: –</div>
          <div class="pvt-value" id="pvt-height">Alt: –</div>
        </div>

        <div class="pvt-label">Velocity ENU (m/s)</div>
        <div class="pvt-row">
          <div class="pvt-value" id="pvt-vel-e">E: –</div>
          <div class="pvt-value" id="pvt-vel-n">N: –</div>
          <div class="pvt-value" id="pvt-vel-u">U: –</div>
        </div>

        <div class="pvt-label">DOPs & Satellites</div>
        <div class="pvt-dops-row">
          <div class="pvt-value" id="pvt-dops">GDOP – PDOP – HDOP – VDOP –</div>
          <div class="pvt-value" id="pvt-sats">Sats: –</div>
        </div>

        <div class="pvt-label">Time</div>
        <div class="pvt-dops-row">
          <div class="pvt-value" id="pvt-weektow">Week –  TOW –</div>
          <div class="pvt-value" id="pvt-time-rx">UTC Time: –</div>
        </div>

        <div class="status-pill">
          <span class="status-dot" id="pvt-dot-bad"></span>
          <span id="pvt-sol-status">No solution</span>
        </div>
      </section>

      <!-- Map + plots in a single row -->
      <div class="map-plots-row">
        <!-- Map card -->
        <section class="card" id="map-card">
          <h2>Map (OpenStreetMap)</h2>
          <small>Current receiver position</small>
          <div id="map"></div>
        </section>

        <!-- Time Series Plots (wide card) -->
        <section class="card" id="plots-card">
          <h2>Time Series Plots</h2>
          <small>Last <span id="max-points-label-inline">${MAX_PLOT_POINTS}</span> samples – Chart.js</small>

          <div id="max-points-container">
            <span>History length:</span>
            <input
              type="range"
              id="max-points-slider"
              min="50"
              max="1000"
              step="50"
              value="${MAX_PLOT_POINTS}"
            />
            <span><span id="max-points-label-inline-2">${MAX_PLOT_POINTS}</span> samples</span>
          </div>

          <div class="plot-wrapper">
            <div class="plot-title">Altitude [m]</div>
            <canvas id="alt-canvas"></canvas>
          </div>
          <div class="plot-wrapper">
            <div class="plot-title">C/N₀ [dB-Hz]</div>
            <canvas id="cn0-canvas"></canvas>
          </div>
          <div class="plot-wrapper">
            <div class="plot-title">Carrier Doppler [Hz]</div>
            <canvas id="dop-canvas"></canvas>
          </div>
        </section>
      </div>
    </section>

    <section>
      <section class="card">
        <h2>Tracking Channels</h2>
        <small>Status of all actively tracked channels</small>
        <div id="channels-container">
          <table>
            <thead>
              <tr>
                <th style="width:3rem;">CH</th>
                <th style="width:3.5rem;">PRN</th>
                <th style="width:3.5rem;">Sys</th>
                <th style="width:3.5rem;">Sig</th>
                <th style="width:4.5rem;" class="num">C/N₀</th>
                <th style="width:6rem;" class="num">Doppler</th>
                <th style="width:4rem;" class="num">El [°]</th>
                <th style="width:4rem;" class="num">Az [°]</th>
                <th>Last update</th>
              </tr>
            </thead>
            <tbody id="channels-body"></tbody>
          </table>
        </div>
      </section>
    </section>
  </div>

  <div id="footer-log"></div>

<script>
(function() {
  // --- DOM Elements ---
  const wsStatus    = document.getElementById('ws-status');
  const pvtAge      = document.getElementById('pvt-age');
  const pvtLat      = document.getElementById('pvt-lat');
  const pvtLon      = document.getElementById('pvt-lon');
  const pvtH        = document.getElementById('pvt-height');
  const pvtVE       = document.getElementById('pvt-vel-e');
  const pvtVN       = document.getElementById('pvt-vel-n');
  const pvtVU       = document.getElementById('pvt-vel-u');
  const pvtDops     = document.getElementById('pvt-dops');
  const pvtSats     = document.getElementById('pvt-sats');
  const pvtWeekTow  = document.getElementById('pvt-weektow');
  const pvtTimeRx   = document.getElementById('pvt-time-rx');
  const pvtDot      = document.querySelector('.status-dot');
  const pvtSolStatus= document.getElementById('pvt-sol-status');
  const footerLog   = document.getElementById('footer-log');
  const tbody       = document.getElementById('channels-body');

  const altCanvas   = document.getElementById('alt-canvas');
  const cn0Canvas   = document.getElementById('cn0-canvas');
  const dopCanvas   = document.getElementById('dop-canvas');

  const maxPointsSlider       = document.getElementById('max-points-slider');
  const maxPointsLabelInline1 = document.getElementById('max-points-label-inline');
  const maxPointsLabelInline2 = document.getElementById('max-points-label-inline-2');

  // GNSS-SDR buttons
  const btnGnssStart  = document.getElementById('btn-gnss-start');
  const btnGnssStart2 = document.getElementById('btn-gnss-start-2');
  const btnGnssStop   = document.getElementById('btn-gnss-stop');
  const gnssStatus    = document.getElementById('gnss-status');

  // Initial max points, user-adjustable via slider
  let maxPoints = ${MAX_PLOT_POINTS};

  const channelRows = new Map();
  let lastPvtTime   = null;
  let t0            = Date.now();

  // --- Leaflet map state ---
  let map = null;
  let mapMarker = null;
  let mapTrack = null;
  const mapTrackCoords = [];
  const MAX_TRACK_POINTS = 200;
  let lastMapUpdateMs = 0;
  const MAP_UPDATE_MIN_MS = 500; // ms, limit map updates

  // --- Chart state + throttling flags ---
  const CHART_COLORS = [
    'rgb(34, 197, 94)',  'rgb(56, 189, 248)', 'rgb(234, 179, 8)',
    'rgb(249, 115, 22)', 'rgb(168, 85, 247)', 'rgb(244, 114, 182)',
    'rgb(45, 212, 191)', 'rgb(74, 222, 128)', 'rgb(96, 165, 250)',
    'rgb(251, 113, 133)'
  ];

  const plotData = {
    alt: { labels: [], data: [] },
    cn0: { datasets: new Map() },
    dop: { datasets: new Map() }
  };

  let altChart, cn0Chart, dopChart;
  let needsAltUpdate = false;
  let needsCn0Update = false;
  let needsDopUpdate = false;
  let renderScheduled = false;

  // ---- GNSS-SDR control helpers ----
  function setGnssUi(running, config, msg) {
    if (btnGnssStart)  btnGnssStart.disabled  = running;
    if (btnGnssStart2) btnGnssStart2.disabled = running;
    if (btnGnssStop)   btnGnssStop.disabled   = !running;

    let statusText = "stopped";
    if (running) {
      const cfg = config === "conf2" ? "RTL real-time" : "high dynamics replay";
      statusText = "running (" + cfg + ")";
    }
    if (msg) statusText += " – " + msg;

    if (gnssStatus) gnssStatus.textContent = "Status: " + statusText;
  }

  async function callGnssApi(path, method = "POST") {
    try {
      const res = await fetch(path, { method });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok !== false) {
        setGnssUi(!!data.running, data.config || null, data.message || "");
      } else {
        setGnssUi(false, null, data.error || "error");
      }
    } catch (e) {
      console.error("GNSS API error", e);
      setGnssUi(false, null, "API error");
    }
  }

  async function initGnssStatus() {
    try {
      const res = await fetch("/api/gnss/status");
      if (!res.ok) {
        setGnssUi(false, null, "status unknown");
        return;
      }
      const data = await res.json().catch(() => ({}));
      setGnssUi(!!data.running, data.config || null, "");
    } catch (e) {
      setGnssUi(false, null, "status error");
    }
  }

  if (btnGnssStart) {
    btnGnssStart.addEventListener("click", () => {
      callGnssApi("/api/gnss/start/conf1", "POST");
    });
  }
  if (btnGnssStart2) {
    btnGnssStart2.addEventListener("click", () => {
      callGnssApi("/api/gnss/start/conf2", "POST");
    });
  }
  if (btnGnssStop) {
    btnGnssStop.addEventListener("click", () => {
      callGnssApi("/api/gnss/stop", "POST");
    });
  }

  // ---- Chart helpers ----
  function scheduleChartRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      if (altChart && needsAltUpdate) altChart.update('none');
      if (cn0Chart && needsCn0Update) cn0Chart.update('none');
      if (dopChart && needsDopUpdate) dopChart.update('none');
      needsAltUpdate = needsCn0Update = needsDopUpdate = false;
      renderScheduled = false;
    });
  }

  function trimChartDataToMaxPoints() {
    const altData = plotData.alt;
    while (altData.labels.length > maxPoints) altData.labels.shift();
    while (altData.data.length   > maxPoints) altData.data.shift();

    for (const ds of plotData.cn0.datasets.values()) {
      while (ds.data.length > maxPoints) ds.data.shift();
    }
    for (const ds of plotData.dop.datasets.values()) {
      while (ds.data.length > maxPoints) ds.data.shift();
    }

    needsAltUpdate = needsCn0Update = needsDopUpdate = true;
    scheduleChartRender();
  }

  if (maxPointsSlider) {
    maxPointsSlider.addEventListener('input', () => {
      const val = parseInt(maxPointsSlider.value, 10);
      if (!isNaN(val) && val > 0) {
        maxPoints = val;
        if (maxPointsLabelInline1) maxPointsLabelInline1.textContent = String(maxPoints);
        if (maxPointsLabelInline2) maxPointsLabelInline2.textContent = String(maxPoints);
        trimChartDataToMaxPoints();
      }
    });
  }

  function getChartConfig(title, yLabel, yMin, yMax, isSingleSeries) {
    return {
      type: 'line',
      data: {
        labels: isSingleSeries ? plotData.alt.labels : [],
        datasets: isSingleSeries ? [{
          label: title,
          data: plotData.alt.data,
          borderColor: CHART_COLORS[0],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.1
        }] : Array.from(plotData.cn0.datasets.values()),
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Time since start [s]' },
            ticks: { callback: (val) => val.toFixed(1) }
          },
          y: {
            title: { display: true, text: yLabel },
            suggestedMin: yMin,
            suggestedMax: yMax
          }
        },
        plugins: {
          legend: { display: !isSingleSeries, position: 'top', labels: { boxWidth: 10 } },
          tooltip: { mode: 'index', intersect: false }
        }
      }
    };
  }

  function initCharts() {
    altChart = new Chart(altCanvas, getChartConfig('Altitude', 'Height (m)', null, null, true));
    cn0Chart = new Chart(cn0Canvas, getChartConfig('C/N₀ per PRN', 'C/N₀ (dB-Hz)', 20, 55, false));
    dopChart = new Chart(dopCanvas, getChartConfig('Doppler per PRN', 'Doppler (Hz)', null, null, false));

    cn0Chart.data.datasets = Array.from(plotData.cn0.datasets.values());
    dopChart.data.datasets = Array.from(plotData.dop.datasets.values());
  }

  function initMap() {
    const mapDiv = document.getElementById('map');
    if (!mapDiv || typeof L === 'undefined') {
      console.warn('Leaflet map could not be initialized.');
      return;
    }

    map = L.map('map');
    map.setView([40.0, 0.0], 4);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    mapMarker = L.marker([40.0, 0.0]).addTo(map);

    mapTrack = L.polyline([], {
      weight: 3,
      color: '#f97316',
      opacity: 0.9
    }).addTo(map);
  }

  function cn0Class(cn0) {
    if (cn0 >= 45) return 'cn0-good';
    if (cn0 >= 35) return 'cn0-mid';
    if (cn0 >= 25) return 'cn0-bad';
    return 'cn0-terrible';
  }

  function fmt(v, digits, unit) {
    if (v == null || isNaN(v)) return '–';
    return Number(v).toFixed(digits) + (unit || '');
  }

  function gpsToUtcDate(week, tow_ms) {
    if (week == null || tow_ms == null) return null;
    var GPS_EPOCH_MS = Date.UTC(1980, 0, 6, 0, 0, 0);
    var SECONDS_PER_WEEK = 604800;
    var GPS_UTC_OFFSET = 18;
    var gpsMs = GPS_EPOCH_MS + week * SECONDS_PER_WEEK * 1000 + tow_ms;
    var utcMs = gpsMs - GPS_UTC_OFFSET * 1000;
    return new Date(utcMs);
  }

  // -------- PVT handling ----------
  function updatePvt(msg) {
    const now = Date.now();
    const t   = (now - t0) / 1000.0;

    lastPvtTime = new Date(msg.timestamp || now);

    pvtLat.textContent = 'Lat: ' + fmt(msg.lat, 6, ' °');
    pvtLon.textContent = 'Lon: ' + fmt(msg.lon, 6, ' °');
    pvtH.textContent   = 'Alt: ' + fmt(msg.height, 2, ' m');

    pvtVE.textContent  = 'E: ' + fmt(msg.vel_e, 2);
    pvtVN.textContent  = 'N: ' + fmt(msg.vel_n, 2);
    pvtVU.textContent  = 'U: ' + fmt(msg.vel_u, 2);

    const g = fmt(msg.gdop, 1);
    const p = fmt(msg.pdop, 1);
    const h = fmt(msg.hdop, 1);
    const v = fmt(msg.vdop, 1);
    pvtDops.textContent = 'GDOP ' + g + '  |  PDOP ' + p + '  |  HDOP ' + h + '  |  VDOP ' + v;

    pvtSats.textContent = 'Sats: ' + (msg.valid_sats != null ? msg.valid_sats : '–');

    pvtWeekTow.textContent =
      'Week ' + (msg.week != null ? msg.week : '–') +
      '  |  TOW ' + (msg.tow_ms != null ? fmt(msg.tow_ms / 1000.0, 3, ' s') : '–');

    var utc = gpsToUtcDate(msg.week, msg.tow_ms);
    if (utc) {
      pvtTimeRx.textContent = 'UTC Time: ' +
        utc.toISOString().replace('T', ' ').replace('Z', ' UTC');
    } else {
      pvtTimeRx.textContent = 'UTC Time: –';
    }

    var status = (msg.solution_status != null ? msg.solution_status : 0);
    var sats   = (typeof msg.valid_sats === 'number' ? msg.valid_sats : 0);
    var hasSol = status !== 0 && sats >= 4;

    pvtDot.id = hasSol ? 'pvt-dot-ok' : 'pvt-dot-bad';

    if (hasSol) {
      var typeText = (msg.solution_type != null ? msg.solution_type : '–');
      pvtSolStatus.textContent =
        'Solution status ' + status + ' (sats: ' + sats + ', type=' + typeText + ')';
    } else {
      pvtSolStatus.textContent =
        'No valid solution (status=' + status + ', sats=' + sats + ')';
    }

    pvtAge.textContent = 'Last PVT: just now';

    if (map && typeof msg.lat === 'number' && typeof msg.lon === 'number' &&
        !isNaN(msg.lat) && !isNaN(msg.lon)) {
      const nowMs = Date.now();
      if (nowMs - lastMapUpdateMs > MAP_UPDATE_MIN_MS) {
        const latlng = [msg.lat, msg.lon];

        if (mapMarker) {
          mapMarker.setLatLng(latlng);
        }

        mapTrackCoords.push(latlng);
        if (mapTrackCoords.length > MAX_TRACK_POINTS) {
          mapTrackCoords.shift();
        }
        if (mapTrack) {
          mapTrack.setLatLngs(mapTrackCoords);
        }

        if (!map.getBounds().contains(latlng)) {
          map.panTo(latlng);
        }

        lastMapUpdateMs = nowMs;
      }
    }

    if (!isNaN(msg.height)) {
      const altData = plotData.alt;
      altData.labels.push(t);
      altData.data.push(msg.height);
      if (altData.labels.length > maxPoints) {
        altData.labels.shift();
        altData.data.shift();
      }
      needsAltUpdate = true;
      scheduleChartRender();
    }
  }

  // -------- Channel handling ----------
  function updateChannel(sample) {
    const id   = sample.channel_id;
    const now  = Date.now();
    const t    = (now - t0) / 1000.0;
    const prnKey = (sample.system || 'UNK') + String(sample.prn != null ? sample.prn : id);

    let tr = channelRows.get(id);
    if (!tr) {
      tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="num ch"></td>' +
        '<td class="num prn"></td>' +
        '<td class="sys"></td>'  +
        '<td class="sig"></td>'  +
        '<td class="num cn0"></td>' +
        '<td class="num dop"></td>' +
        '<td class="num el"></td>' +
        '<td class="num az"></td>' +
        '<td class="time"></td>';
      channelRows.set(id, tr);
      tbody.appendChild(tr);
    }

    tr.querySelector('.ch').textContent  = id;
    tr.querySelector('.prn').textContent = (sample.prn != null ? sample.prn : '–');
    tr.querySelector('.sys').textContent = sample.system || '';
    tr.querySelector('.sig').textContent = sample.signal || '';

    const cn0Cell = tr.querySelector('.cn0');
    if (typeof sample.cn0_db_hz === 'number' && sample.cn0_db_hz > 0) {
      cn0Cell.textContent = sample.cn0_db_hz.toFixed(1);
      cn0Cell.className   = 'num cn0 ' + cn0Class(sample.cn0_db_hz);
    } else {
      cn0Cell.textContent = '–';
      cn0Cell.className   = 'num cn0';
    }

    tr.querySelector('.dop').textContent =
      (typeof sample.doppler_hz === 'number' ? sample.doppler_hz.toFixed(1) : '–');

    // Elevation / Azimuth (may be undefined if GNSS-SDR does not send them yet)
    const elCell = tr.querySelector('.el');
    const azCell = tr.querySelector('.az');
    if (elCell) {
      elCell.textContent =
        (typeof sample.el_deg === 'number' ? sample.el_deg.toFixed(1) : '–');
    }
    if (azCell) {
      azCell.textContent =
        (typeof sample.az_deg === 'number' ? sample.az_deg.toFixed(1) : '–');
    }

    const tt = new Date(sample.timestamp || Date.now());
    tr.querySelector('.time').textContent = tt.toLocaleTimeString();

    updateMultiSeriesPlot(plotData.cn0, cn0Chart, prnKey, t, sample.cn0_db_hz, 'C/N₀', id);
    updateMultiSeriesPlot(plotData.dop, dopChart, prnKey, t, sample.doppler_hz, 'Doppler', id);
  }

  function updateMultiSeriesPlot(plotObj, chart, key, t, y, labelPrefix, chId) {
    if (typeof y !== 'number' || isNaN(y) || y <= 0) return;

    let dataset = plotObj.datasets.get(key);
    if (!dataset) {
      const colorIndex = plotObj.datasets.size % CHART_COLORS.length;
      dataset = {
        label: labelPrefix + ' ' + key + ' (Ch ' + chId + ')',
        data: [],
        borderColor: CHART_COLORS[colorIndex],
        borderWidth: 1.5,
        pointRadius: 1.5,
        fill: false,
        tension: 0.1,
        parsing: false
      };
      plotObj.datasets.set(key, dataset);
      chart.data.datasets = Array.from(plotObj.datasets.values());
    }

    dataset.data.push({ x: t, y: y });
    if (dataset.data.length > maxPoints) dataset.data.shift();

    if (chart === cn0Chart) {
      needsCn0Update = true;
    } else if (chart === dopChart) {
      needsDopUpdate = true;
    }
    scheduleChartRender();
  }

  function handleMessage(msg) {
    if (Array.isArray(msg)) {
      msg.forEach(handleMessage);
      return;
    }

    if (msg.type === 'pvt') {
      updatePvt(msg);
      footerLog.textContent = 'Last PVT: ' + JSON.stringify(msg).slice(0, 260) + '...';
    } else if (msg.type === 'observables') {
      updateChannel(msg);
    }
  }

  function connectWS() {
    const proto = (location.protocol === 'https:') ? 'wss://' : 'ws://';
    const ws    = new WebSocket(proto + location.host + '/ws');

    ws.onopen = function() {
      wsStatus.textContent = 'WebSocket: connected';
      wsStatus.className   = 'ws-ok';
    };

    ws.onclose = function() {
      wsStatus.textContent = 'WebSocket: disconnected (retrying…)';
      wsStatus.className   = 'ws-bad';
      setTimeout(connectWS, 2000);
    };

    ws.onerror = function(err) {
      wsStatus.textContent = 'WebSocket error';
      wsStatus.className   = 'ws-bad';
      console.error('WS Error:', err);
    };

    ws.onmessage = function(ev) {
      try {
        const data = JSON.parse(ev.data);
        handleMessage(data);
      } catch (err) {
        console.error('Bad JSON from server', err);
      }
    };
  }

  setInterval(function() {
    if (!lastPvtTime) return;
    const now = Date.now();
    const dt  = Math.round((now - lastPvtTime.getTime()) / 1000);
    if (dt <= 1) {
      pvtAge.textContent = 'Last PVT: just now';
    } else {
      pvtAge.textContent = 'Last PVT: ' + dt + ' s ago';
    }
  }, 1000);

  initCharts();
  initMap();
  connectWS();
  initGnssStatus();
})();
</script>
</body>
</html>`;

// ------------- Protobuf loading -------------
let ObservablesMsg = null;
let MonitorPvtMsg  = null;

async function loadProtobufs() {
  try {
    const root = await protobuf.load(["gnss_synchro.proto", "monitor_pvt.proto"]);
    ObservablesMsg = root.lookupType("gnss_sdr.Observables");
    MonitorPvtMsg  = root.lookupType("gnss_sdr.MonitorPvt");
    console.log("✅ Loaded protobuf types gnss_sdr.Observables and gnss_sdr.MonitorPvt");
  } catch (err) {
    console.error("❌ Error loading .proto files:", err.message);
    console.error("Ensure 'gnss_synchro.proto' and 'monitor_pvt.proto' are in the same directory.");
    process.exit(1);
  }
}

// ------------- GNSS-SDR process control -------------
function startGnssSdr(which) {
  if (gnssProcess) {
    return { ok: false, error: "GNSS-SDR already running", running: true, config: gnssCurrentConfig };
  }

  let confPath;
  if (which === "conf2") {
    confPath = GNSS_CONF2;
  } else {
    confPath = GNSS_CONF1;
    which = "conf1";
  }

  try {
    gnssProcess = spawn(GNSS_CMD, ["-c", confPath], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    gnssCurrentConfig = which;

    console.log(`🚀 Started GNSS-SDR (${which}): ${GNSS_CMD} -c ${confPath}`);

    gnssProcess.stdout.on("data", (data) => {
      console.log("[gnss-sdr stdout]", data.toString().trim());
    });
    gnssProcess.stderr.on("data", (data) => {
      console.error("[gnss-sdr stderr]", data.toString().trim());
    });
    gnssProcess.on("exit", (code, signal) => {
      console.log(`🔚 GNSS-SDR exited (code=${code}, signal=${signal})`);
      gnssProcess = null;
      gnssCurrentConfig = null;
    });

    return { ok: true, running: true, config: which, message: "GNSS-SDR started" };
  } catch (e) {
    console.error("❌ Failed to start gnss-sdr:", e.message);
    gnssProcess = null;
    gnssCurrentConfig = null;
    return { ok: false, running: false, error: e.message };
  }
}

function stopGnssSdr() {
  if (!gnssProcess) {
    return { ok: false, running: false, error: "GNSS-SDR is not running" };
  }
  try {
    gnssProcess.kill("SIGTERM");
    console.log("🛑 Sent SIGTERM to GNSS-SDR");
    // gnssProcess and config will be cleared on 'exit'
    return { ok: true, running: false, config: null, message: "GNSS-SDR stopping" };
  } catch (e) {
    console.error("❌ Failed to stop gnss-sdr:", e.message);
    return { ok: false, running: !!gnssProcess, config: gnssCurrentConfig, error: e.message };
  }
}

function getGnssStatus() {
  return {
    ok: true,
    running: !!gnssProcess,
    config: gnssCurrentConfig
  };
}

// ------------- HTTP + WebSocket server -------------
const server = http.createServer((req, res) => {
  // Basic routing
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML_PAGE);
    return;
  }

  if (req.method === "GET" && req.url === "/api/gnss/status") {
    const status = getGnssStatus();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status));
    return;
  }

  // Simple API for GNSS-SDR control
  if (req.url === "/api/gnss/start/conf1" && req.method === "POST") {
    const result = startGnssSdr("conf1");
    res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.url === "/api/gnss/start/conf2" && req.method === "POST") {
    const result = startGnssSdr("conf2");
    res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.url === "/api/gnss/stop" && req.method === "POST") {
    const result = stopGnssSdr();
    res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocket.Server({ server, path: "/ws" });

// ------------- broadcast helper -------------
function broadcast(obj) {
  const data = JSON.stringify(obj);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(data);
      } catch (e) {
        console.error("WS send error:", e.message);
      }
    }
  });
}

// ------------- UDP handlers -------------
function handleObsUdp(buf) {
  if (!ObservablesMsg || wss.clients.size === 0) return;

  let obs;
  try {
    obs = ObservablesMsg.decode(buf);
  } catch (e) {
    console.error("OBS decode error:", e.message);
    return;
  }

  const now = new Date().toISOString();

  const samples = (obs.observable || [])
    .filter((s) => s.fs !== 0)
    .map((s) => ({
      type: "observables",
      timestamp: now,
      system: s.system,
      signal: s.signal,
      channel_id: s.channelId,
      prn: s.prn,
      cn0_db_hz: s.cn0DbHz,
      doppler_hz: s.carrierDopplerHz,
      // These fields will be undefined unless GNSS-SDR is extended
      // to send elevation_deg / azimuth_deg in gnss_synchro.proto
      el_deg: s.elevationDeg,
      az_deg: s.azimuthDeg
    }));

  if (samples.length) broadcast(samples);
}

function handlePvtUdp(buf) {
  if (!MonitorPvtMsg || wss.clients.size === 0) return;

  let pvt;
  try {
    pvt = MonitorPvtMsg.decode(buf);
  } catch (e) {
    console.error("PVT decode error:", e.message);
    return;
  }

  const now = new Date().toISOString();

  const msg = {
    type: "pvt",
    timestamp: now,
    week: pvt.week,
    tow_ms: pvt.towAtCurrentSymbolMs,
    rx_time: pvt.rxTime,
    lat: pvt.latitude,
    lon: pvt.longitude,
    height: pvt.height,
    pos_x: pvt.posX,
    pos_y: pvt.posY,
    pos_z: pvt.posZ,
    vel_x: pvt.velX,
    vel_y: pvt.velY,
    vel_z: pvt.velZ,
    vel_e: pvt.velE,
    vel_n: pvt.velN,
    vel_u: pvt.velU,
    valid_sats: pvt.validSats,
    solution_status: pvt.solutionStatus,
    solution_type: pvt.solutionType,
    gdop: pvt.gdop,
    pdop: pvt.pdop,
    hdop: pvt.hdop,
    vdop: pvt.vdop
  };

  broadcast(msg);
}

// ------------- UDP sockets -------------
const udpObs = dgram.createSocket("udp4");
udpObs
  .on("listening", () => {
    const a = udpObs.address();
    console.log(`📡 Observables UDP listening on ${a.address}:${a.port}`);
  })
  .on("message", handleObsUdp)
  .on("error", (e) => console.error("❌ Observables UDP Error:", e.message));

const udpPvt = dgram.createSocket("udp4");
udpPvt
  .on("listening", () => {
    const a = udpPvt.address();
    console.log(`📡 PVT UDP listening on ${a.address}:${a.port}`);
  })
  .on("message", handlePvtUdp)
  .on("error", (e) => console.error("❌ PVT UDP Error:", e.message));

// ------------- start everything -------------
async function startServer() {
  await loadProtobufs();

  try {
    udpObs.bind(UDP_PORT_OBS);
    udpPvt.bind(UDP_PORT_PVT);
    server.listen(HTTP_PORT, () => {
      console.log(`🌐 Web server running at http://localhost:${HTTP_PORT}`);
      console.log("Waiting for UDP data from GNSS-SDR...");
      console.log("Use the web UI to start/stop gnss-sdr (two configs).");
    });
  } catch (e) {
    console.error("❌ Failed to bind sockets:", e.message);
    process.exit(1);
  }
}

startServer();

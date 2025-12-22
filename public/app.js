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
const posCanvas   = document.getElementById('pos-canvas');
const velCanvas   = document.getElementById('vel-canvas');
const decimationSelect = document.getElementById('decimation-select');

// Statistics page elements
const statsPosCount = document.getElementById('stats-pos-count');
const statsVelCount = document.getElementById('stats-vel-count');
const statLatMean   = document.getElementById('stat-lat-mean');
const statLonMean   = document.getElementById('stat-lon-mean');
const statAltMean   = document.getElementById('stat-alt-mean');
const statVelEMean  = document.getElementById('stat-vel-e-mean');
const statVelNMean  = document.getElementById('stat-vel-n-mean');
const statVelUMean  = document.getElementById('stat-vel-u-mean');

const histLatCanvas   = document.getElementById('hist-lat-canvas');
const histLonCanvas   = document.getElementById('hist-lon-canvas');
const histAltCanvas   = document.getElementById('hist-alt-canvas');
const histVelECanvas  = document.getElementById('hist-vel-e-canvas');
const histVelNCanvas  = document.getElementById('hist-vel-n-canvas');
const histVelUCanvas  = document.getElementById('hist-vel-u-canvas');
const statsResetBtn   = document.getElementById('stats-reset-btn');

let decimationFactor = 1;
let decimCounter = 0;


const maxPointsSlider       = document.getElementById('max-points-slider');
const maxPointsLabelInline1 = document.getElementById('max-points-label-inline');
const maxPointsLabelInline2 = document.getElementById('max-points-label-inline-2');

// --- Page navigation (Summary / Historics / Observables) ---
const tabs = Array.from(document.querySelectorAll('.tab[data-page]'));
const pages = new Map(Array.from(document.querySelectorAll('.page')).map(p => [p.id, p]));

function showPage(pageId) {
  for (const [id, el] of pages.entries()) {
    el.classList.toggle('is-active', id === pageId);
  }
  for (const t of tabs) {
    const active = (t.getAttribute('data-page') === pageId);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
  }

  // Leaflet needs a resize invalidate when shown
  if (pageId === 'page-summary' && map) {
    setTimeout(() => map.invalidateSize(), 0);
  }

  // Chart.js benefits from resize on show
  if (pageId === 'page-historics') {
    try { if (altChart) altChart.resize(); } catch (e) {}
    try { if (cn0Chart) cn0Chart.resize(); } catch (e) {}
    try { if (dopChart) dopChart.resize(); } catch (e) {}
    for (const ds of plotData.pos.datasets.values()) {
      while (ds.data.length > maxPoints) ds.data.shift();
    }
    for (const ds of plotData.vel.datasets.values()) {
      while (ds.data.length > maxPoints) ds.data.shift();
    }

    needsAltUpdate = needsCn0Update = needsDopUpdate = needsPosUpdate = needsVelUpdate = true;
    
scheduleChartRender();
if (posChart) {
  posChart.data.datasets.forEach(ds => ds.data = ds.data.slice(-RENDER_POINTS));
}
if (velChart) {
  velChart.data.datasets.forEach(ds => ds.data = ds.data.slice(-RENDER_POINTS));
}

  }

  if (pageId === 'page-stats') {
    try { if (histLatChart) histLatChart.resize(); } catch (e) {}
    try { if (histLonChart) histLonChart.resize(); } catch (e) {}
    try { if (histAltChart) histAltChart.resize(); } catch (e) {}
    try { if (histVelEChart) histVelEChart.resize(); } catch (e) {}
    try { if (histVelNChart) histVelNChart.resize(); } catch (e) {}
    try { if (histVelUChart) histVelUChart.resize(); } catch (e) {}
    updateStats();
  }
}

function pageFromHash() {
  const h = (location.hash || '').replace('#', '').toLowerCase();
  if (h === 'historics' || h === 'history') return 'page-historics';
  if (h === 'stats' || h === 'statistics') return 'page-stats';
  if (h === 'observables' || h === 'channels') return 'page-observables';
  return 'page-summary';
}

function initNav() {
  const initial = pageFromHash();
  showPage(initial);

  for (const t of tabs) {
    t.addEventListener('click', () => {
      const pid = t.getAttribute('data-page');
      if (pid === 'page-summary') location.hash = '#summary';
      else if (pid === 'page-historics') location.hash = '#historics';
      else if (pid === 'page-stats') location.hash = '#stats';
      else if (pid === 'page-observables') location.hash = '#observables';
      showPage(pid);
    });
  }

  window.addEventListener('hashchange', () => {
    showPage(pageFromHash());
  });
}

// GNSS-SDR buttons
const btnGnssStart  = document.getElementById('btn-gnss-start');
const btnGnssStart2 = document.getElementById('btn-gnss-start-2');
const btnGnssStart3 = document.getElementById('btn-gnss-start-3');
const btnGnssStop   = document.getElementById('btn-gnss-stop');
const gnssStatus    = document.getElementById('gnss-status');

// Initial max points, user-adjustable via slider
let maxPoints = 3000;
const RENDER_POINTS = 600;
if (maxPointsSlider) maxPointsSlider.value = maxPoints;
if (maxPointsLabelInline1) maxPointsLabelInline1.textContent = String(maxPoints);
if (maxPointsLabelInline2) maxPointsLabelInline2.textContent = String(maxPoints);

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
  pos: { datasets: new Map() },
  vel: { datasets: new Map() },

  alt: { labels: [], data: [] },
  cn0: { datasets: new Map() },
  dop: { datasets: new Map() }
};

let altChart, cn0Chart, dopChart, posChart, velChart;
let histLatChart, histLonChart, histAltChart;
let histVelEChart, histVelNChart, histVelUChart;
let needsAltUpdate = false;
let needsCn0Update = false;
let needsDopUpdate = false;
let needsPosUpdate = false;
let needsVelUpdate = false;
let renderScheduled = false;
let lastRenderMs = 0;
const RENDER_INTERVAL_MS = 500;
const STATS_BINS = 21;
const STATS_UPDATE_MS = 1000;
let lastStatsUpdate = 0;

// ---- GNSS-SDR control helpers ----
function setGnssUi(running, msg) {
  if (btnGnssStart)  btnGnssStart.disabled  = running;
  if (btnGnssStart2) btnGnssStart2.disabled = running;
  if (btnGnssStart3) btnGnssStart3.disabled = running;
  if (btnGnssStop)   btnGnssStop.disabled   = !running;
  if (gnssStatus)    gnssStatus.textContent = "Status: " + (msg || (running ? "running" : "stopped"));
}

async function fetchGnssStatus() {
  try {
    const res = await fetch("/api/gnss/status");
    if (!res.ok) {
      setGnssUi(false, "status unknown");
      return;
    }
    const data = await res.json();
    if (data && data.ok) {
      setGnssUi(!!data.running, data.message || (data.running ? "running" : "stopped"));
    } else {
      setGnssUi(false, "status unknown");
    }
  } catch (e) {
    console.error("GNSS status API error", e);
    setGnssUi(false, "status unknown");
  }
}

async function callGnssApi(path) {
  try {
    const res = await fetch(path, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      setGnssUi(data.running, data.message || "");
    } else {
      setGnssUi(false, data.error || "error");
    }
  } catch (e) {
    console.error("GNSS API error", e);
    setGnssUi(false, "API error");
  }
}

if (btnGnssStart) {
  btnGnssStart.addEventListener("click", () => {
    callGnssApi("/api/gnss/start");
  });
}
if (btnGnssStart2) {
  btnGnssStart2.addEventListener("click", () => {
    callGnssApi("/api/gnss/start-alt");
  });
}
if (btnGnssStart3) {
  btnGnssStart3.addEventListener("click", () => {
    callGnssApi("/api/gnss/start-leo");
  });
}
if (btnGnssStop) {
  btnGnssStop.addEventListener("click", () => {
    callGnssApi("/api/gnss/stop");
  });
}

// ---- Chart helpers ----
function scheduleChartRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  
const nowMs = performance.now();
if (nowMs - lastRenderMs < RENDER_INTERVAL_MS) {
  renderScheduled = false;
  return;
}
lastRenderMs = nowMs;
requestAnimationFrame(() => {
    
if (altChart && needsAltUpdate) {
  altChart.data.labels = plotData.alt.labels.slice(-RENDER_POINTS);
  altChart.data.datasets[0].data = plotData.alt.data.slice(-RENDER_POINTS);
  altChart.update('none');
}

    
if (cn0Chart && needsCn0Update) {
  cn0Chart.data.datasets.forEach(ds => {
    ds.data = ds.data.slice(-RENDER_POINTS);
  });
  cn0Chart.update('none');
}

    
if (dopChart && needsDopUpdate) {
  dopChart.data.datasets.forEach(ds => {
    ds.data = ds.data.slice(-RENDER_POINTS);
  });
  dopChart.update('none');
}

    if (posChart && needsPosUpdate) {

      posChart.data.datasets.forEach(ds => {

        ds.data = ds.data.slice(-RENDER_POINTS);

      });

      posChart.update('none');

    }


    if (velChart && needsVelUpdate) {

      velChart.data.datasets.forEach(ds => {

        ds.data = ds.data.slice(-RENDER_POINTS);

      });

      velChart.update('none');

    }


    needsAltUpdate = needsCn0Update = needsDopUpdate = needsPosUpdate = needsVelUpdate = false;
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

  for (const ds of plotData.pos.datasets.values()) {


    while (ds.data.length > maxPoints) ds.data.shift();


  }


  for (const ds of plotData.vel.datasets.values()) {


    while (ds.data.length > maxPoints) ds.data.shift();


  }



  needsAltUpdate = needsCn0Update = needsDopUpdate = needsPosUpdate = needsVelUpdate = true;
  
scheduleChartRender();
if (posChart) {
  posChart.data.datasets.forEach(ds => ds.data = ds.data.slice(-RENDER_POINTS));
}
if (velChart) {
  velChart.data.datasets.forEach(ds => ds.data = ds.data.slice(-RENDER_POINTS));
}

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

function getChartConfig(title, yLabel, yMin, yMax, isSingleSeries, datasetsMap) {
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
      }] : Array.from((datasetsMap || plotData.cn0.datasets).values()),
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'time',
          time: { tooltipFormat: 'yyyy-MM-dd HH:mm:ss', displayFormats: { second: 'HH:mm:ss' } },
          adapters: { date: { zone: 'utc' } },
          title: { display: true, text: 'UTC Time' }
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

function getHistogramConfig(title, color, xLabel) {
  return {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: title,
        data: [],
        backgroundColor: color
      }]
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: (xLabel || 'Deviation from mean') },
          ticks: { maxTicksLimit: 7 }
        },
        y: {
          title: { display: true, text: 'Count' },
          beginAtZero: true
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false }
      }
    }
  };
}

function getSeriesValues(plotObj, key) {
  const ds = plotObj.datasets.get(key);
  if (!ds || !Array.isArray(ds.data)) return [];
  const values = [];
  for (const point of ds.data) {
    if (point && typeof point.y === 'number' && !isNaN(point.y)) {
      values.push(point.y);
    }
  }
  return values;
}

function computeMean(values) {
  if (!values.length) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function computeStd(values, mean) {
  if (!values.length || mean == null) return null;
  let sumSq = 0;
  for (const v of values) {
    const d = v - mean;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / values.length);
}

function buildDeviationHistogramFromDevs(devs, bins, minRange, decimals) {
  if (!devs.length) {
    return { labels: [], counts: [] };
  }

  let maxAbs = 0;
  for (const d of devs) {
    const a = Math.abs(d);
    if (a > maxAbs) maxAbs = a;
  }
  const range = Math.max(maxAbs, minRange);
  const binWidth = (2 * range) / bins;
  const counts = new Array(bins).fill(0);

  for (const d of devs) {
    let idx = Math.floor((d + range) / binWidth);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    counts[idx] += 1;
  }

  const labels = new Array(bins);
  for (let i = 0; i < bins; i++) {
    const center = -range + binWidth * (i + 0.5);
    labels[i] = center.toFixed(decimals);
  }

  return { labels, counts };
}

function buildDeviationHistogram(values, bins, minRange, decimals) {
  if (!values.length) {
    return { labels: [], counts: [], mean: null, std: null };
  }

  const mean = computeMean(values);
  const std = computeStd(values, mean);
  const devs = values.map((v) => v - mean);
  const hist = buildDeviationHistogramFromDevs(devs, bins, minRange, decimals);
  return { labels: hist.labels, counts: hist.counts, mean, std };
}

function initCharts() {
  altChart = new Chart(altCanvas, getChartConfig('Altitude', 'Height (m)', null, null, true));
  cn0Chart = new Chart(cn0Canvas, getChartConfig('C/N₀ per PRN', 'C/N₀ (dB-Hz)', 20, 55, false, plotData.cn0.datasets));
  
dopChart = new Chart(dopCanvas, getChartConfig('Doppler per PRN', 'Doppler (Hz)', null, null, false, plotData.dop.datasets));
posChart = new Chart(posCanvas, getChartConfig('Position LLA', 'Lat/Lon (deg), Alt (m)', null, null, false, plotData.pos.datasets));
velChart = new Chart(velCanvas, getChartConfig('Velocity ENU', 'Velocity (m/s)', null, null, false, plotData.vel.datasets));


  cn0Chart.data.datasets = Array.from(plotData.cn0.datasets.values());
  dopChart.data.datasets = Array.from(plotData.dop.datasets.values());
  posChart.data.datasets = Array.from(plotData.pos.datasets.values());
  velChart.data.datasets = Array.from(plotData.vel.datasets.values());

  if (histLatCanvas) {
    histLatChart = new Chart(histLatCanvas, getHistogramConfig('Lat deviation', CHART_COLORS[0], 'Deviation from mean (m)'));
  }
  if (histLonCanvas) {
    histLonChart = new Chart(histLonCanvas, getHistogramConfig('Lon deviation', CHART_COLORS[1], 'Deviation from mean (m)'));
  }
  if (histAltCanvas) {
    histAltChart = new Chart(histAltCanvas, getHistogramConfig('Alt deviation', CHART_COLORS[2], 'Deviation from mean (m)'));
  }
  if (histVelECanvas) {
    histVelEChart = new Chart(histVelECanvas, getHistogramConfig('Vel E deviation', CHART_COLORS[3], 'Deviation from mean (m/s)'));
  }
  if (histVelNCanvas) {
    histVelNChart = new Chart(histVelNCanvas, getHistogramConfig('Vel N deviation', CHART_COLORS[4], 'Deviation from mean (m/s)'));
  }
  if (histVelUCanvas) {
    histVelUChart = new Chart(histVelUCanvas, getHistogramConfig('Vel U deviation', CHART_COLORS[5], 'Deviation from mean (m/s)'));
  }
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
  const t   = (msg.timestamp ? new Date(msg.timestamp).getTime() : now);

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
if (posChart) {
  posChart.data.datasets.forEach(ds => ds.data = ds.data.slice(-RENDER_POINTS));
}
if (velChart) {
  velChart.data.datasets.forEach(ds => ds.data = ds.data.slice(-RENDER_POINTS));
}

  }
  updateNamedSeriesPlot(plotData.pos, posChart, 'lat', t, msg.lat, 'Lat');
  updateNamedSeriesPlot(plotData.pos, posChart, 'lon', t, msg.lon, 'Lon');
  updateNamedSeriesPlot(plotData.pos, posChart, 'alt', t, msg.height, 'Alt');

  updateNamedSeriesPlot(plotData.vel, velChart, 'vel_e', t, msg.vel_e, 'Vel E');
  updateNamedSeriesPlot(plotData.vel, velChart, 'vel_n', t, msg.vel_n, 'Vel N');
  updateNamedSeriesPlot(plotData.vel, velChart, 'vel_u', t, msg.vel_u, 'Vel U');
}

// -------- Channel handling ----------
function updateChannel(sample) {
  const id   = sample.channel_id;
  const now  = Date.now();
  const t    = (sample.timestamp ? new Date(sample.timestamp).getTime() : now);
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

  const tt = new Date(sample.timestamp || Date.now());
  tr.querySelector('.time').textContent = tt.toLocaleTimeString();

  updateMultiSeriesPlot(plotData.cn0, cn0Chart, prnKey, t, sample.cn0_db_hz, 'C/N0', id, { minPositive: true });
  updateMultiSeriesPlot(plotData.dop, dopChart, prnKey, t, sample.doppler_hz, 'Doppler', id);
}

function updateMultiSeriesPlot(plotObj, chart, key, t, y, labelPrefix, chId, opts) {
  if (typeof y !== 'number' || isNaN(y)) return;
  if (opts && opts.minPositive && y <= 0) return;

  let dataset = plotObj.datasets.get(key);
  if (!dataset) {
    const colorIndex = plotObj.datasets.size % CHART_COLORS.length;
    dataset = {
      label: labelPrefix + ' ' + key + (chId != null ? (' (Ch ' + chId + ')') : ''),
      data: [],
      borderColor: CHART_COLORS[colorIndex],
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false,
      tension: 0.1,
      parsing: false
    };
    plotObj.datasets.set(key, dataset);
    if (chart) {
      chart.data.datasets = Array.from(plotObj.datasets.values());
    }
  }

  dataset.data.push({ x: t, y: y });
  if (dataset.data.length > maxPoints) dataset.data.shift();

  if (chart === cn0Chart) {
    needsCn0Update = true;
  } else if (chart === dopChart) {
    needsDopUpdate = true;
  }
  
scheduleChartRender();
if (posChart) {
  posChart.data.datasets.forEach(ds => ds.data = ds.data.slice(-RENDER_POINTS));
}
if (velChart) {
  velChart.data.datasets.forEach(ds => ds.data = ds.data.slice(-RENDER_POINTS));
}

}

function updateNamedSeriesPlot(plotObj, chart, key, t, y, label) {
  if (typeof y !== "number" || isNaN(y)) return;

  let dataset = plotObj.datasets.get(key);
  if (!dataset) {
    const colorIndex = plotObj.datasets.size % CHART_COLORS.length;
    dataset = {
      label: label,
      data: [],
      borderColor: CHART_COLORS[colorIndex],
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false,
      tension: 0.1,
      parsing: false
    };
    plotObj.datasets.set(key, dataset);
    if (chart) {
      chart.data.datasets = Array.from(plotObj.datasets.values());
    }
  }

  dataset.data.push({ x: t, y: y });
  if (dataset.data.length > maxPoints) dataset.data.shift();

  if (chart === posChart) {
    needsPosUpdate = true;
  } else if (chart === velChart) {
    needsVelUpdate = true;
  }
  
  scheduleChartRender();
  if (posChart) {
    posChart.data.datasets.forEach(ds => ds.data = ds.data.slice(-RENDER_POINTS));
  }
  if (velChart) {
    velChart.data.datasets.forEach(ds => ds.data = ds.data.slice(-RENDER_POINTS));
  }
}

function formatMeanStd(mean, std, meanDecimals, stdDecimals) {
  if (!Number.isFinite(mean)) return '-';
  if (!Number.isFinite(std)) return mean.toFixed(meanDecimals) + ' / -';
  return mean.toFixed(meanDecimals) + ' / ' + std.toFixed(stdDecimals);
}

function applyHistogram(chart, stats) {
  if (!chart) return;
  chart.data.labels = stats.labels;
  chart.data.datasets[0].data = stats.counts;
  chart.update('none');
}

function updateStats(force) {
  if (!force && Date.now() - lastStatsUpdate < STATS_UPDATE_MS) return;
  lastStatsUpdate = Date.now();

  const latValues = getSeriesValues(plotData.pos, 'lat');
  const lonValues = getSeriesValues(plotData.pos, 'lon');
  const altValues = getSeriesValues(plotData.pos, 'alt');

  const velEValues = getSeriesValues(plotData.vel, 'vel_e');
  const velNValues = getSeriesValues(plotData.vel, 'vel_n');
  const velUValues = getSeriesValues(plotData.vel, 'vel_u');

  const posCount = Math.max(latValues.length, lonValues.length, altValues.length);
  const velCount = Math.max(velEValues.length, velNValues.length, velUValues.length);

  if (statsPosCount) statsPosCount.textContent = 'Samples: ' + posCount;
  if (statsVelCount) statsVelCount.textContent = 'Samples: ' + velCount;

  const latMean = computeMean(latValues);
  const lonMean = computeMean(lonValues);

  const latMeanDeg = latMean == null ? 0 : latMean;
  const lonScale = 111320 * Math.cos(latMeanDeg * Math.PI / 180);
  const latDevMeters = latMean == null ? [] : latValues.map((v) => (v - latMean) * 111320);
  const lonDevMeters = lonMean == null ? [] : lonValues.map((v) => (v - lonMean) * lonScale);

  const latStats = buildDeviationHistogramFromDevs(latDevMeters, STATS_BINS, 0.1, 2);
  const lonStats = buildDeviationHistogramFromDevs(lonDevMeters, STATS_BINS, 0.1, 2);
  const latStdM = latDevMeters.length ? computeStd(latDevMeters, 0) : null;
  const lonStdM = lonDevMeters.length ? computeStd(lonDevMeters, 0) : null;
  const altStats = buildDeviationHistogram(altValues, STATS_BINS, 0.5, 2);

  const velEStats = buildDeviationHistogram(velEValues, STATS_BINS, 0.05, 2);
  const velNStats = buildDeviationHistogram(velNValues, STATS_BINS, 0.05, 2);
  const velUStats = buildDeviationHistogram(velUValues, STATS_BINS, 0.05, 2);

  if (statLatMean) statLatMean.textContent = formatMeanStd(latMean, latStdM, 6, 2);
  if (statLonMean) statLonMean.textContent = formatMeanStd(lonMean, lonStdM, 6, 2);
  if (statAltMean) statAltMean.textContent = formatMeanStd(altStats.mean, altStats.std, 2, 2);
  if (statVelEMean) statVelEMean.textContent = formatMeanStd(velEStats.mean, velEStats.std, 2, 2);
  if (statVelNMean) statVelNMean.textContent = formatMeanStd(velNStats.mean, velNStats.std, 2, 2);
  if (statVelUMean) statVelUMean.textContent = formatMeanStd(velUStats.mean, velUStats.std, 2, 2);

  applyHistogram(histLatChart, latStats);
  applyHistogram(histLonChart, lonStats);
  applyHistogram(histAltChart, altStats);
  applyHistogram(histVelEChart, velEStats);
  applyHistogram(histVelNChart, velNStats);
  applyHistogram(histVelUChart, velUStats);
}

function resetStatsData() {
  plotData.pos.datasets.clear();
  plotData.vel.datasets.clear();

  if (posChart) {
    posChart.data.datasets = [];
    posChart.update('none');
  }
  if (velChart) {
    velChart.data.datasets = [];
    velChart.update('none');
  }

  updateStats(true);
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

setInterval(function() {
  updateStats();
}, STATS_UPDATE_MS);

// Init on load
initCharts();
initMap();
initNav();
connectWS();
fetchGnssStatus();

if (decimationSelect) {
  decimationSelect.addEventListener('change', () => {
    decimationFactor = parseInt(decimationSelect.value, 10) || 1;
  });
}

if (statsResetBtn) {
  statsResetBtn.addEventListener('click', () => {
    resetStatsData();
  });
}

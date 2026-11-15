'use strict';

(function () {
  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const MAX_POINTS = 3000;        // history kept per series (also the statistics window)
  const RENDER_POINTS = 600;      // most recent points actually drawn per series
  const RENDER_INTERVAL_MS = 500; // at most one chart redraw per interval
  const STATS_BINS = 21;
  const STATS_UPDATE_MS = 1000;
  const STATUS_POLL_MS = 3000;
  const MAX_TRACK_POINTS = 200;
  const MAP_UPDATE_MIN_MS = 500;

  const CHART_COLORS = [
    'rgb(34, 197, 94)',  'rgb(56, 189, 248)', 'rgb(234, 179, 8)',
    'rgb(249, 115, 22)', 'rgb(168, 85, 247)', 'rgb(244, 114, 182)',
    'rgb(45, 212, 191)', 'rgb(74, 222, 128)', 'rgb(96, 165, 250)',
    'rgb(251, 113, 133)'
  ];

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  const wsStatus     = $('ws-status');
  const pvtAge       = $('pvt-age');
  const pvtLat       = $('pvt-lat');
  const pvtLon       = $('pvt-lon');
  const pvtH         = $('pvt-height');
  const pvtVE        = $('pvt-vel-e');
  const pvtVN        = $('pvt-vel-n');
  const pvtVU        = $('pvt-vel-u');
  const pvtDops      = $('pvt-dops');
  const pvtSats      = $('pvt-sats');
  const pvtWeekTow   = $('pvt-weektow');
  const pvtTimeRx    = $('pvt-time-rx');
  const pvtDot       = document.querySelector('.status-dot');
  const pvtSolStatus = $('pvt-sol-status');
  const footerLog    = $('footer-log');
  const tbody        = $('channels-body');

  const gnssButtons  = $('gnss-config-buttons');
  const btnGnssStop  = $('btn-gnss-stop');
  const gnssStatus   = $('gnss-status');

  const statsPosCount = $('stats-pos-count');
  const statsVelCount = $('stats-vel-count');
  const statsResetBtn = $('stats-reset-btn');

  // ---------------------------------------------------------------------------
  // Time-series store
  //
  // store[group] maps a series key to { points, dataset }.  `points` is the full
  // history buffer (up to MAX_POINTS); `dataset` is the Chart.js dataset, which
  // only ever receives a *copy* of the last RENDER_POINTS points.  Keeping the
  // two apart is what lets the statistics use the whole history.
  // ---------------------------------------------------------------------------
  const store = { alt: new Map(), cn0: new Map(), dop: new Map(), pos: new Map(), vel: new Map() };
  const charts = {};       // group -> Chart
  const dirty = new Set(); // groups with data not yet drawn

  let activePage = 'page-summary';
  let renderTimer = null;
  let lastRenderMs = 0;

  function addPoint(group, key, label, x, y) {
    if (typeof y !== 'number' || !Number.isFinite(y)) return;
    const series = store[group];
    let s = series.get(key);
    if (!s) {
      s = {
        points: [],
        dataset: {
          label: label,
          data: [],
          borderColor: CHART_COLORS[series.size % CHART_COLORS.length],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          tension: 0.1,
          parsing: false
        }
      };
      series.set(key, s);
      if (charts[group]) charts[group].data.datasets.push(s.dataset);
    }
    s.points.push({ x: x, y: y });
    if (s.points.length > MAX_POINTS) s.points.shift();
    dirty.add(group);
    scheduleRender();
  }

  // Throttle with a trailing edge: a request made during the quiet interval is
  // deferred, never dropped, so the last sample always ends up on screen.
  function scheduleRender() {
    if (renderTimer !== null) return;
    const wait = Math.max(0, RENDER_INTERVAL_MS - (performance.now() - lastRenderMs));
    renderTimer = setTimeout(function () {
      renderTimer = null;
      requestAnimationFrame(renderCharts);
    }, wait);
  }

  function renderCharts() {
    lastRenderMs = performance.now();
    if (activePage !== 'page-historics') return; // stays dirty until the page is shown
    for (const group of dirty) {
      const chart = charts[group];
      if (!chart) continue;
      for (const s of store[group].values()) {
        s.dataset.data = s.points.slice(-RENDER_POINTS);
      }
      chart.update('none');
    }
    dirty.clear();
  }

  // ---------------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------------
  function fmt(v, digits, unit) {
    if (v == null || isNaN(v)) return '–';
    return Number(v).toFixed(digits) + (unit || '');
  }

  function fmtUtcTime(ms) {
    const d = new Date(ms);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(11, 19);
  }

  function fmtUtcDateTime(ms) {
    const d = new Date(ms);
    return isNaN(d.getTime()) ? '' : d.toISOString().replace('T', ' ').replace('Z', ' UTC');
  }

  function gpsToUtcDate(week, towMs) {
    if (week == null || towMs == null) return null;
    const GPS_EPOCH_MS = Date.UTC(1980, 0, 6, 0, 0, 0);
    const SECONDS_PER_WEEK = 604800;
    const GPS_UTC_OFFSET_S = 18; // leap seconds since 2017-01-01
    return new Date(GPS_EPOCH_MS + week * SECONDS_PER_WEEK * 1000 + towMs - GPS_UTC_OFFSET_S * 1000);
  }

  function cn0Class(cn0) {
    if (cn0 >= 45) return 'cn0-good';
    if (cn0 >= 35) return 'cn0-mid';
    if (cn0 >= 25) return 'cn0-bad';
    return 'cn0-terrible';
  }

  // ---------------------------------------------------------------------------
  // Charts
  // ---------------------------------------------------------------------------
  function lineChartConfig(yLabel, yMin, yMax, showLegend) {
    return {
      type: 'line',
      data: { datasets: [] },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            // Epoch milliseconds on a linear axis, labelled explicitly in UTC.
            type: 'linear',
            title: { display: true, text: 'UTC time' },
            ticks: { maxTicksLimit: 8, callback: function (v) { return fmtUtcTime(v); } }
          },
          y: {
            title: { display: true, text: yLabel },
            suggestedMin: yMin,
            suggestedMax: yMax
          }
        },
        plugins: {
          legend: { display: showLegend, position: 'top', labels: { boxWidth: 10 } },
          tooltip: {
            mode: 'nearest',
            axis: 'x',
            intersect: false,
            callbacks: {
              title: function (items) { return items.length ? fmtUtcDateTime(items[0].parsed.x) : ''; }
            }
          }
        }
      }
    };
  }

  function histogramConfig(title, color, xLabel) {
    return {
      type: 'bar',
      data: { labels: [], datasets: [{ label: title, data: [], backgroundColor: color }] },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { title: { display: true, text: xLabel }, ticks: { maxTicksLimit: 7 } },
          y: { title: { display: true, text: 'Count' }, beginAtZero: true }
        },
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }
      }
    };
  }

  const hist = {};

  function initCharts() {
    if (typeof Chart === 'undefined') {
      console.warn('Chart.js is not available; plots are disabled.');
      return;
    }
    const lines = [
      ['alt', 'alt-canvas', 'Height (m)', null, null, false],
      ['cn0', 'cn0-canvas', 'C/N₀ (dB-Hz)', 20, 55, true],
      ['dop', 'dop-canvas', 'Doppler (Hz)', null, null, true],
      ['pos', 'pos-canvas', 'Lat/Lon (deg), Alt (m)', null, null, true],
      ['vel', 'vel-canvas', 'Velocity (m/s)', null, null, true]
    ];
    for (const [group, canvasId, yLabel, yMin, yMax, legend] of lines) {
      const canvas = $(canvasId);
      if (canvas) charts[group] = new Chart(canvas, lineChartConfig(yLabel, yMin, yMax, legend));
    }

    const hists = [
      ['lat', 'hist-lat-canvas', 'Lat deviation', 0, 'Deviation from mean (m)'],
      ['lon', 'hist-lon-canvas', 'Lon deviation', 1, 'Deviation from mean (m)'],
      ['alt', 'hist-alt-canvas', 'Alt deviation', 2, 'Deviation from mean (m)'],
      ['velE', 'hist-vel-e-canvas', 'Vel E deviation', 3, 'Deviation from mean (m/s)'],
      ['velN', 'hist-vel-n-canvas', 'Vel N deviation', 4, 'Deviation from mean (m/s)'],
      ['velU', 'hist-vel-u-canvas', 'Vel U deviation', 5, 'Deviation from mean (m/s)']
    ];
    for (const [key, canvasId, title, color, xLabel] of hists) {
      const canvas = $(canvasId);
      if (canvas) hist[key] = new Chart(canvas, histogramConfig(title, CHART_COLORS[color], xLabel));
    }
  }

  // ---------------------------------------------------------------------------
  // Map
  // ---------------------------------------------------------------------------
  let map = null;
  let mapMarker = null;
  let mapTrack = null;
  const mapTrackCoords = [];
  let lastMapUpdateMs = 0;

  function initMap() {
    if (!$('map') || typeof L === 'undefined') {
      console.warn('Leaflet is not available; the map is disabled.');
      return;
    }
    map = L.map('map');
    map.setView([40.0, 0.0], 4);
    // Map tiles are the only thing fetched from the Internet.
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    mapMarker = L.marker([40.0, 0.0]).addTo(map);
    mapTrack = L.polyline([], { weight: 3, color: '#f97316', opacity: 0.9 }).addTo(map);
  }

  function updateMap(lat, lon) {
    if (!map || typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) return;
    const nowMs = Date.now();
    if (nowMs - lastMapUpdateMs <= MAP_UPDATE_MIN_MS) return;
    lastMapUpdateMs = nowMs;

    const latlng = [lat, lon];
    mapMarker.setLatLng(latlng);
    mapTrackCoords.push(latlng);
    if (mapTrackCoords.length > MAX_TRACK_POINTS) mapTrackCoords.shift();
    mapTrack.setLatLngs(mapTrackCoords);
    if (!map.getBounds().contains(latlng)) map.panTo(latlng);
  }

  // ---------------------------------------------------------------------------
  // PVT
  // ---------------------------------------------------------------------------
  let lastPvtTime = null;

  function updatePvt(msg) {
    const now = Date.now();
    const t = msg.timestamp ? new Date(msg.timestamp).getTime() : now;
    lastPvtTime = new Date(t);

    pvtLat.textContent = 'Lat: ' + fmt(msg.lat, 6, ' °');
    pvtLon.textContent = 'Lon: ' + fmt(msg.lon, 6, ' °');
    pvtH.textContent   = 'Alt: ' + fmt(msg.height, 2, ' m');

    pvtVE.textContent = 'E: ' + fmt(msg.vel_e, 2);
    pvtVN.textContent = 'N: ' + fmt(msg.vel_n, 2);
    pvtVU.textContent = 'U: ' + fmt(msg.vel_u, 2);

    pvtDops.textContent =
      'GDOP ' + fmt(msg.gdop, 1) + '  |  PDOP ' + fmt(msg.pdop, 1) +
      '  |  HDOP ' + fmt(msg.hdop, 1) + '  |  VDOP ' + fmt(msg.vdop, 1);
    pvtSats.textContent = 'Sats: ' + (msg.valid_sats != null ? msg.valid_sats : '–');

    pvtWeekTow.textContent =
      'Week ' + (msg.week != null ? msg.week : '–') +
      '  |  TOW ' + (msg.tow_ms != null ? fmt(msg.tow_ms / 1000.0, 3, ' s') : '–');

    const utc = gpsToUtcDate(msg.week, msg.tow_ms);
    pvtTimeRx.textContent = 'UTC Time: ' + (utc && !isNaN(utc.getTime()) ? fmtUtcDateTime(utc.getTime()) : '–');

    const status = msg.solution_status != null ? msg.solution_status : 0;
    const sats = typeof msg.valid_sats === 'number' ? msg.valid_sats : 0;
    const hasSol = status !== 0 && sats >= 4;
    pvtDot.id = hasSol ? 'pvt-dot-ok' : 'pvt-dot-bad';
    pvtSolStatus.textContent = hasSol
      ? 'Solution status ' + status + ' (sats: ' + sats + ', type=' + (msg.solution_type != null ? msg.solution_type : '–') + ')'
      : 'No valid solution (status=' + status + ', sats=' + sats + ')';

    pvtAge.textContent = 'Last PVT: just now';

    updateMap(msg.lat, msg.lon);

    addPoint('alt', 'alt', 'Altitude', t, msg.height);
    addPoint('pos', 'lat', 'Lat', t, msg.lat);
    addPoint('pos', 'lon', 'Lon', t, msg.lon);
    addPoint('pos', 'alt', 'Alt', t, msg.height);
    addPoint('vel', 'vel_e', 'Vel E', t, msg.vel_e);
    addPoint('vel', 'vel_n', 'Vel N', t, msg.vel_n);
    addPoint('vel', 'vel_u', 'Vel U', t, msg.vel_u);
  }

  // ---------------------------------------------------------------------------
  // Tracking channels
  // ---------------------------------------------------------------------------
  const channelRows = new Map();

  function updateChannel(sample) {
    const id = sample.channel_id;
    const t = sample.timestamp ? new Date(sample.timestamp).getTime() : Date.now();
    const prnKey = (sample.system || 'UNK') + String(sample.prn != null ? sample.prn : id);

    let tr = channelRows.get(id);
    if (!tr) {
      tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="num ch"></td><td class="num prn"></td><td class="sys"></td><td class="sig"></td>' +
        '<td class="num cn0"></td><td class="num dop"></td><td class="time"></td>';
      channelRows.set(id, tr);
      tbody.appendChild(tr);
    }

    tr.querySelector('.ch').textContent  = id;
    tr.querySelector('.prn').textContent = sample.prn != null ? sample.prn : '–';
    tr.querySelector('.sys').textContent = sample.system || '';
    tr.querySelector('.sig').textContent = sample.signal || '';

    const cn0Cell = tr.querySelector('.cn0');
    const hasCn0 = typeof sample.cn0_db_hz === 'number' && sample.cn0_db_hz > 0;
    cn0Cell.textContent = hasCn0 ? sample.cn0_db_hz.toFixed(1) : '–';
    cn0Cell.className = 'num cn0' + (hasCn0 ? ' ' + cn0Class(sample.cn0_db_hz) : '');

    tr.querySelector('.dop').textContent =
      typeof sample.doppler_hz === 'number' ? sample.doppler_hz.toFixed(1) : '–';
    tr.querySelector('.time').textContent = new Date(t).toLocaleTimeString();

    if (hasCn0) addPoint('cn0', prnKey, 'C/N0 ' + prnKey + ' (Ch ' + id + ')', t, sample.cn0_db_hz);
    addPoint('dop', prnKey, 'Doppler ' + prnKey + ' (Ch ' + id + ')', t, sample.doppler_hz);
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------
  function seriesValues(group, key) {
    const s = store[group].get(key);
    return s ? s.points.map(function (p) { return p.y; }) : [];
  }

  function mean(values) {
    if (!values.length) return null;
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
  }

  function std(values, m) {
    if (!values.length || m == null) return null;
    let sumSq = 0;
    for (const v of values) sumSq += (v - m) * (v - m);
    return Math.sqrt(sumSq / values.length);
  }

  function histogramOfDeviations(devs, bins, minRange, decimals) {
    if (!devs.length) return { labels: [], counts: [] };
    let maxAbs = 0;
    for (const d of devs) maxAbs = Math.max(maxAbs, Math.abs(d));
    const range = Math.max(maxAbs, minRange);
    const binWidth = (2 * range) / bins;
    const counts = new Array(bins).fill(0);
    for (const d of devs) {
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((d + range) / binWidth)));
      counts[idx] += 1;
    }
    const labels = [];
    for (let i = 0; i < bins; i++) labels.push((-range + binWidth * (i + 0.5)).toFixed(decimals));
    return { labels: labels, counts: counts };
  }

  function statsOf(values, bins, minRange, decimals) {
    const m = mean(values);
    const devs = m == null ? [] : values.map(function (v) { return v - m; });
    const h = histogramOfDeviations(devs, bins, minRange, decimals);
    return { labels: h.labels, counts: h.counts, mean: m, std: std(values, m) };
  }

  function fmtMeanStd(m, s, meanDecimals, stdDecimals) {
    if (!Number.isFinite(m)) return '-';
    return m.toFixed(meanDecimals) + ' / ' + (Number.isFinite(s) ? s.toFixed(stdDecimals) : '-');
  }

  function applyHistogram(chart, stats) {
    if (!chart) return;
    chart.data.labels = stats.labels;
    chart.data.datasets[0].data = stats.counts;
    chart.update('none');
  }

  let lastStatsUpdate = 0;

  function updateStats(force) {
    if (activePage !== 'page-stats' && !force) return;
    if (!force && Date.now() - lastStatsUpdate < STATS_UPDATE_MS) return;
    lastStatsUpdate = Date.now();

    const lat = seriesValues('pos', 'lat');
    const lon = seriesValues('pos', 'lon');
    const alt = seriesValues('pos', 'alt');
    const velE = seriesValues('vel', 'vel_e');
    const velN = seriesValues('vel', 'vel_n');
    const velU = seriesValues('vel', 'vel_u');

    if (statsPosCount) statsPosCount.textContent = 'Samples: ' + Math.max(lat.length, lon.length, alt.length);
    if (statsVelCount) statsVelCount.textContent = 'Samples: ' + Math.max(velE.length, velN.length, velU.length);

    // Latitude/longitude spread is reported in metres (local tangent plane).
    const latMean = mean(lat);
    const lonMean = mean(lon);
    const M_PER_DEG = 111320;
    const lonScale = M_PER_DEG * Math.cos((latMean == null ? 0 : latMean) * Math.PI / 180);
    const latDevM = latMean == null ? [] : lat.map(function (v) { return (v - latMean) * M_PER_DEG; });
    const lonDevM = lonMean == null ? [] : lon.map(function (v) { return (v - lonMean) * lonScale; });

    const altStats = statsOf(alt, STATS_BINS, 0.5, 2);
    const velEStats = statsOf(velE, STATS_BINS, 0.05, 2);
    const velNStats = statsOf(velN, STATS_BINS, 0.05, 2);
    const velUStats = statsOf(velU, STATS_BINS, 0.05, 2);

    const set = function (id, text) { const el = $(id); if (el) el.textContent = text; };
    set('stat-lat-mean', fmtMeanStd(latMean, latDevM.length ? std(latDevM, 0) : null, 6, 2));
    set('stat-lon-mean', fmtMeanStd(lonMean, lonDevM.length ? std(lonDevM, 0) : null, 6, 2));
    set('stat-alt-mean', fmtMeanStd(altStats.mean, altStats.std, 2, 2));
    set('stat-vel-e-mean', fmtMeanStd(velEStats.mean, velEStats.std, 2, 2));
    set('stat-vel-n-mean', fmtMeanStd(velNStats.mean, velNStats.std, 2, 2));
    set('stat-vel-u-mean', fmtMeanStd(velUStats.mean, velUStats.std, 2, 2));

    applyHistogram(hist.lat, histogramOfDeviations(latDevM, STATS_BINS, 0.1, 2));
    applyHistogram(hist.lon, histogramOfDeviations(lonDevM, STATS_BINS, 0.1, 2));
    applyHistogram(hist.alt, altStats);
    applyHistogram(hist.velE, velEStats);
    applyHistogram(hist.velN, velNStats);
    applyHistogram(hist.velU, velUStats);
  }

  function resetStats() {
    for (const group of ['pos', 'vel']) {
      store[group].clear();
      if (charts[group]) {
        charts[group].data.datasets.length = 0;
        charts[group].update('none');
      }
    }
    updateStats(true);
  }

  // ---------------------------------------------------------------------------
  // Page navigation
  // ---------------------------------------------------------------------------
  const tabs = Array.from(document.querySelectorAll('.tab[data-page]'));
  const pages = new Map(Array.from(document.querySelectorAll('.page')).map(function (p) { return [p.id, p]; }));
  const HASH_TO_PAGE = {
    summary: 'page-summary',
    historics: 'page-historics', history: 'page-historics',
    stats: 'page-stats', statistics: 'page-stats',
    observables: 'page-observables', channels: 'page-observables'
  };
  const PAGE_TO_HASH = {
    'page-summary': '#summary', 'page-historics': '#historics',
    'page-stats': '#stats', 'page-observables': '#observables'
  };

  function showPage(pageId) {
    activePage = pageId;
    for (const [id, el] of pages.entries()) el.classList.toggle('is-active', id === pageId);
    for (const t of tabs) t.setAttribute('aria-selected', t.getAttribute('data-page') === pageId ? 'true' : 'false');

    if (pageId === 'page-summary' && map) {
      setTimeout(function () { map.invalidateSize(); }, 0);
    }
    if (pageId === 'page-historics') {
      for (const group of Object.keys(charts)) {
        charts[group].resize();
        dirty.add(group);
      }
      scheduleRender();
    }
    if (pageId === 'page-stats') {
      for (const key of Object.keys(hist)) hist[key].resize();
      updateStats(true);
    }
  }

  function pageFromHash() {
    const h = (location.hash || '').replace('#', '').toLowerCase();
    return HASH_TO_PAGE[h] || 'page-summary';
  }

  function initNav() {
    showPage(pageFromHash());
    for (const t of tabs) {
      t.addEventListener('click', function () {
        const pid = t.getAttribute('data-page');
        if (PAGE_TO_HASH[pid]) location.hash = PAGE_TO_HASH[pid];
        showPage(pid);
      });
    }
    window.addEventListener('hashchange', function () { showPage(pageFromHash()); });
  }

  // ---------------------------------------------------------------------------
  // Receiver control
  // ---------------------------------------------------------------------------
  let startButtons = [];

  function setGnssUi(running, msg) {
    for (const b of startButtons) b.disabled = running;
    if (btnGnssStop) btnGnssStop.disabled = !running;
    if (gnssStatus) gnssStatus.textContent = 'Status: ' + (msg || (running ? 'running' : 'stopped'));
  }

  async function fetchGnssStatus() {
    try {
      const res = await fetch('/api/gnss/status');
      const data = res.ok ? await res.json() : null;
      if (data) setGnssUi(!!data.running || !!data.stopping, data.message);
      else setGnssUi(false, 'status unknown');
    } catch (e) {
      setGnssUi(false, 'status unknown');
    }
  }

  async function callGnssApi(path, body) {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      const data = await res.json().catch(function () { return {}; });
      if (res.ok && data.ok) setGnssUi(!!data.running, data.message || '');
      else setGnssUi(!!data.running, data.error || 'error');
    } catch (e) {
      console.error('GNSS API error', e);
      setGnssUi(false, 'API error');
    }
  }

  async function loadConfigs() {
    if (!gnssButtons) return;
    let configs = [];
    try {
      const res = await fetch('/api/gnss/configs');
      const data = await res.json();
      configs = (data && data.configs) || [];
    } catch (e) {
      console.error('Cannot load configurations', e);
    }

    gnssButtons.textContent = '';
    startButtons = configs.map(function (c) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Start: ' + c.label;
      b.title = c.id;
      b.addEventListener('click', function () { callGnssApi('/api/gnss/start', { config: c.id }); });
      gnssButtons.appendChild(b);
      return b;
    });
    if (!configs.length) {
      const note = document.createElement('small');
      note.textContent = 'No GNSS-SDR configuration files found on the server.';
      gnssButtons.appendChild(note);
    }
  }

  if (btnGnssStop) {
    btnGnssStop.addEventListener('click', function () { callGnssApi('/api/gnss/stop'); });
  }
  if (statsResetBtn) {
    statsResetBtn.addEventListener('click', resetStats);
  }

  // ---------------------------------------------------------------------------
  // WebSocket
  // ---------------------------------------------------------------------------
  function handleMessage(msg) {
    if (Array.isArray(msg)) {
      msg.forEach(handleMessage);
    } else if (msg && msg.type === 'pvt') {
      updatePvt(msg);
      footerLog.textContent = 'Last PVT: ' + JSON.stringify(msg).slice(0, 260) + '...';
    } else if (msg && msg.type === 'observables') {
      updateChannel(msg);
    }
  }

  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const ws = new WebSocket(proto + location.host + '/ws');

    ws.onopen = function () {
      wsStatus.textContent = 'WebSocket: connected';
      wsStatus.className = 'ws-ok';
    };
    ws.onclose = function () {
      wsStatus.textContent = 'WebSocket: disconnected (retrying…)';
      wsStatus.className = 'ws-bad';
      setTimeout(connectWS, 2000);
    };
    ws.onerror = function (err) {
      wsStatus.textContent = 'WebSocket error';
      wsStatus.className = 'ws-bad';
      console.error('WS Error:', err);
    };
    ws.onmessage = function (ev) {
      try {
        handleMessage(JSON.parse(ev.data));
      } catch (err) {
        console.error('Bad message from server', err);
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Timers and start-up
  // ---------------------------------------------------------------------------
  setInterval(function () {
    if (!lastPvtTime) return;
    const dt = Math.round((Date.now() - lastPvtTime.getTime()) / 1000);
    pvtAge.textContent = dt <= 1 ? 'Last PVT: just now' : 'Last PVT: ' + dt + ' s ago';
  }, 1000);

  setInterval(function () { updateStats(false); }, STATS_UPDATE_MS);
  setInterval(fetchGnssStatus, STATUS_POLL_MS);

  initCharts();
  initMap();
  initNav();
  connectWS();
  loadConfigs().then(fetchGnssStatus);
})();

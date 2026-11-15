// server/state.js
// Latest receiver state with a time-to-live: data older than the TTL is
// reported as absent instead of being shown as if it were current.

function createState({ ttlMs = 5000, now = Date.now } = {}) {
  const latest = {
    pvt: null,
    pvtReceivedAt: null,
    obsByChannel: new Map(), // last sample per channel_id
    obsReceivedAt: null
  };

  function setLatestPvt(msg) {
    latest.pvt = msg;
    latest.pvtReceivedAt = now();
  }

  function updateLatestObservables(samples) {
    if (!Array.isArray(samples)) return;
    const t = now();
    for (const s of samples) {
      if (s && typeof s.channel_id === "number") {
        latest.obsByChannel.set(s.channel_id, { ...s, _received_at: t });
      }
    }
    latest.obsReceivedAt = t;
  }

  /** Milliseconds since the last PVT datagram, or null if none was received. */
  function getPvtAgeMs() {
    return latest.pvtReceivedAt === null ? null : now() - latest.pvtReceivedAt;
  }

  /** Latest PVT, or null when it is older than the TTL. */
  function getLatestPvt() {
    const age = getPvtAgeMs();
    if (latest.pvt === null || age === null || age > ttlMs) return null;
    return latest.pvt;
  }

  /** Channels that reported within the TTL, strongest C/N0 first. */
  function getLatestObservables({ limit = 64 } = {}) {
    const t = now();
    const active = [];
    for (const [id, s] of latest.obsByChannel) {
      if (t - s._received_at < ttlMs) active.push(s);
      else latest.obsByChannel.delete(id);
    }
    active.sort((a, b) => (b.cn0_db_hz ?? 0) - (a.cn0_db_hz ?? 0));
    return limit ? active.slice(0, limit) : active;
  }

  function getLatestObservablesMeta() {
    const t = now();
    const pvtAge = getPvtAgeMs();
    return {
      count: latest.obsByChannel.size,
      pvt_age_ms: pvtAge,
      obs_age_ms: latest.obsReceivedAt === null ? null : t - latest.obsReceivedAt,
      is_live: pvtAge !== null && pvtAge < ttlMs
    };
  }

  return {
    setLatestPvt,
    updateLatestObservables,
    getLatestPvt,
    getPvtAgeMs,
    getLatestObservables,
    getLatestObservablesMeta
  };
}

module.exports = { createState };

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadProtobufTypes, decodeObservables, decodePvt } = require("../server/udp_handlers");

const NOW = new Date("2026-01-01T00:00:00.000Z");

test("observables: tracking channels are decoded with plain numbers", async () => {
  const types = await loadProtobufTypes();
  const buf = types.Observables.encode(
    types.Observables.create({
      observable: [
        { system: "G", signal: "1C", prn: 7, channelId: 3, fs: 2000000, cn0DbHz: 44.5, carrierDopplerHz: -1234.5 }
      ]
    })
  ).finish();

  const out = decodeObservables(types, buf, NOW);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    type: "observables",
    timestamp: "2026-01-01T00:00:00.000Z",
    system: "G",
    signal: "1C",
    channel_id: 3,
    prn: 7,
    cn0_db_hz: 44.5,
    doppler_hz: -1234.5
  });
});

// Regression: `fs` is int64. protobufjs decodes it as a Long object, and
// `long !== 0` is always true, so idle channels used to leak through.
test("observables: idle channels (fs == 0) are dropped", async () => {
  const types = await loadProtobufTypes();
  const buf = types.Observables.encode(
    types.Observables.create({
      observable: [
        { system: "G", signal: "1C", prn: 1, channelId: 0, fs: 4000000, cn0DbHz: 40 },
        { channelId: 1, fs: 0 },
        { channelId: 2 }
      ]
    })
  ).finish();

  const out = decodeObservables(types, buf, NOW);
  assert.deepEqual(
    out.map((s) => s.channel_id),
    [0]
  );
});

test("observables: an empty datagram yields no samples", async () => {
  const types = await loadProtobufTypes();
  assert.deepEqual(decodeObservables(types, Buffer.alloc(0), NOW), []);
});

test("pvt: fields are mapped, course and horizontal speed are forwarded", async () => {
  const types = await loadProtobufTypes();
  const buf = types.MonitorPvt.encode(
    types.MonitorPvt.create({
      week: 2400,
      towAtCurrentSymbolMs: 123456,
      latitude: 41.275,
      longitude: 1.9876,
      height: 80.5,
      velE: 3,
      velN: 4,
      velU: 0.25,
      cog: 36.87,
      validSats: 7,
      solutionStatus: 5,
      gdop: 2.5
    })
  ).finish();

  const msg = decodePvt(types, buf, NOW);
  assert.equal(msg.type, "pvt");
  assert.equal(msg.week, 2400);
  assert.equal(msg.tow_ms, 123456);
  assert.equal(msg.lat, 41.275);
  assert.equal(msg.lon, 1.9876);
  assert.equal(msg.height, 80.5);
  assert.equal(msg.vel_u, 0.25);
  assert.equal(msg.cog, 36.87);
  assert.equal(msg.speed_mps, 5); // hypot(3, 4)
  assert.equal(msg.valid_sats, 7);
  assert.equal(msg.solution_status, 5);
  assert.equal(msg.gdop, 2.5);
});

test("pvt: malformed data throws instead of producing garbage", async () => {
  const types = await loadProtobufTypes();
  assert.throws(() => decodePvt(types, Buffer.from([0xff, 0xff, 0xff]), NOW));
});

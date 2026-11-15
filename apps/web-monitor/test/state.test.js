const test = require("node:test");
const assert = require("node:assert/strict");
const { createState } = require("../server/state");

function clock(start = 1000000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => {
    t += ms;
  };
  return now;
}

test("no data: pvt is null and ages are null (not a huge number)", () => {
  const state = createState({ ttlMs: 5000, now: clock() });
  assert.equal(state.getLatestPvt(), null);
  assert.equal(state.getPvtAgeMs(), null);
  const meta = state.getLatestObservablesMeta();
  assert.equal(meta.pvt_age_ms, null);
  assert.equal(meta.obs_age_ms, null);
  assert.equal(meta.is_live, false);
});

test("pvt expires after the TTL but its age keeps counting", () => {
  const now = clock();
  const state = createState({ ttlMs: 5000, now });
  state.setLatestPvt({ type: "pvt", lat: 1 });

  now.advance(4000);
  assert.deepEqual(state.getLatestPvt(), { type: "pvt", lat: 1 });
  assert.equal(state.getPvtAgeMs(), 4000);
  assert.equal(state.getLatestObservablesMeta().is_live, true);

  now.advance(2000);
  assert.equal(state.getLatestPvt(), null);
  assert.equal(state.getPvtAgeMs(), 6000);
  assert.equal(state.getLatestObservablesMeta().is_live, false);
});

test("observables: sorted by C/N0, limited, stale channels removed", () => {
  const now = clock();
  const state = createState({ ttlMs: 5000, now });
  state.updateLatestObservables([
    { channel_id: 0, cn0_db_hz: 30 },
    { channel_id: 1, cn0_db_hz: 45 }
  ]);
  now.advance(3000);
  state.updateLatestObservables([{ channel_id: 2, cn0_db_hz: 38 }]);

  assert.deepEqual(
    state.getLatestObservables().map((s) => s.channel_id),
    [1, 2, 0]
  );
  assert.deepEqual(
    state.getLatestObservables({ limit: 1 }).map((s) => s.channel_id),
    [1]
  );

  now.advance(3000); // channels 0 and 1 are now 6 s old
  assert.deepEqual(
    state.getLatestObservables().map((s) => s.channel_id),
    [2]
  );
  assert.equal(state.getLatestObservablesMeta().count, 1);
});

test("observables: malformed input is ignored", () => {
  const state = createState({ now: clock() });
  state.updateLatestObservables(null);
  state.updateLatestObservables([null, { cn0_db_hz: 40 }, { channel_id: "x" }]);
  assert.deepEqual(state.getLatestObservables(), []);
});

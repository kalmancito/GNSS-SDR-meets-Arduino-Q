const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { listConfigs, findConfig, isValidId } = require("../server/configs");

function makeTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gnss-conf-"));
  fs.writeFileSync(path.join(dir, "gps-l1ca-file.conf"), "; @title GPS L1 C/A from file\n[GNSS-SDR]\n");
  fs.writeFileSync(path.join(dir, "gps-l1ca-live.conf"), "[GNSS-SDR]\n");
  fs.writeFileSync(path.join(dir, "notes.txt"), "not a config");
  fs.writeFileSync(path.join(dir, "bad name.conf"), "[GNSS-SDR]\n");
  fs.mkdirSync(path.join(dir, "File_input"));
  fs.writeFileSync(path.join(dir, "File_input", "cubesat_GPS.conf"), "[GNSS-SDR]\n");
  fs.mkdirSync(path.join(dir, "File_input", "deep"));
  fs.writeFileSync(path.join(dir, "File_input", "deep", "too_deep.conf"), "[GNSS-SDR]\n");
  return dir;
}

test("lists .conf files with ids, labels and a depth limit", () => {
  const dir = makeTree();
  const all = listConfigs(dir);
  assert.deepEqual(
    all.map((c) => c.id),
    ["File_input/cubesat_GPS", "gps-l1ca-file", "gps-l1ca-live"]
  );
  assert.equal(all.find((c) => c.id === "gps-l1ca-file").label, "GPS L1 C/A from file");
  assert.equal(all.find((c) => c.id === "gps-l1ca-live").label, "gps-l1ca-live");

  assert.deepEqual(
    listConfigs(dir, 1).map((c) => c.id),
    ["gps-l1ca-file", "gps-l1ca-live"]
  );
});

test("a missing directory is an empty list, not an error", () => {
  assert.deepEqual(listConfigs(path.join(os.tmpdir(), "does-not-exist-gnss")), []);
});

test("ids cannot escape the configuration directory", () => {
  const dir = makeTree();
  for (const id of ["../etc/passwd", "..", "/etc/passwd", "a/../b", "", "x;rm -rf", "a b", null, 42]) {
    assert.equal(isValidId(id), false, `id ${JSON.stringify(id)} must be rejected`);
    assert.equal(findConfig(dir, id), null);
  }
  assert.equal(findConfig(dir, "gps-l1ca-file").path, path.join(dir, "gps-l1ca-file.conf"));
  assert.equal(findConfig(dir, "unknown"), null);
});

// server/configs.js
// Discovers the GNSS-SDR configuration files ("profiles") that can be started.
const fs = require("fs");
const path = require("path");

// Profile ids are relative paths without the ".conf" suffix, restricted to a
// conservative character set so they are safe in file names and unit env files.
const ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isValidId(id) {
  if (typeof id !== "string" || id.length === 0 || id.length > 200) return false;
  return id.split("/").every((seg) => ID_SEGMENT.test(seg) && seg !== "." && seg !== "..");
}

// Optional human readable name, declared in the file as:  ; @title My receiver
function readTitle(file) {
  try {
    const head = fs.readFileSync(file, "utf8").slice(0, 2048);
    const m = head.match(/^\s*;\s*@title\s+(.+?)\s*$/m);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

/**
 * List the profiles found under `dir`.
 * @param {string} dir       base directory
 * @param {number} maxDepth  1 = only files directly in `dir`
 * @returns {{id: string, label: string, path: string}[]}
 */
function listConfigs(dir, maxDepth = 2) {
  const out = [];

  function walk(current, rel, depth) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (e) {
      return; // missing or unreadable directory: no profiles
    }
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      const relPath = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (depth < maxDepth) walk(full, relPath, depth + 1);
      } else if (ent.isFile() && ent.name.endsWith(".conf")) {
        const id = relPath.slice(0, -".conf".length);
        if (isValidId(id)) {
          out.push({ id, label: readTitle(full) || id, path: full });
        }
      }
    }
  }

  walk(dir, "", 1);
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function findConfig(dir, id, maxDepth = 2) {
  if (!isValidId(id)) return null;
  return listConfigs(dir, maxDepth).find((c) => c.id === id) || null;
}

module.exports = { listConfigs, findConfig, isValidId };

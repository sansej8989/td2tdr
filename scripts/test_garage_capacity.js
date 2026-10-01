#!/usr/bin/env node
// Self-check for the garage-capacity logic in webroot/app.js.
// The helpers live inside the app.js IIFE, so this script slices their real
// source text out of the shipped file and runs THAT — it cannot drift from what
// the module uses. Plain asserts, no framework, no dependencies.
//
//   node scripts/test_garage_capacity.js
//
// Fixtures are the two real Garage.dat exports from the audit:
//   File A: occupied(state==1)=3914, locked=3908, held=49, true capacity 3917
//   File B: occupied=3917, locked=3909, held=46, true capacity 3919
process.env.TZ = "UTC";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "webroot", "app.js");
const src = fs.readFileSync(APP, "utf8");

function slice(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `could not slice ${JSON.stringify(from)} out of app.js`);
  return src.slice(a, b);
}

const source = slice(
  "function resolveGarageCapacity(occupied, stored)",
  "  async function getGarageSnapshot(storedCapacity)"
);

const api = new Function(
  source + "\nreturn { resolveGarageCapacity, sanitizeGarageCapacity, readStoredGarageCapacity };"
)();

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log("PASS  " + name);
  } catch (e) {
    failures++;
    console.log("FAIL  " + name + "\n        " + e.message);
  }
}

const FILE_A = { occupied: 3914, locked: 3908, held: 49, trueCapacity: 3917 };
const FILE_B = { occupied: 3917, locked: 3909, held: 46, trueCapacity: 3919 };

// The full pipeline the module runs, mirroring getGarageSnapshot().
const snapshot = (occupied, locked, stored) => {
  const capacity = api.resolveGarageCapacity(occupied, stored);
  return { garageCapacity: capacity, garageTotal: capacity, garageLocked: locked,
           garageFree: Math.max(0, capacity - locked) };
};

// ---------------------------------------------------------------------------
check("File A, no stored capacity: heals to the old occupied+1 fallback", () => {
  // occupied+1 = 3915 is still WRONG (true is 3917) — this documents the
  // pre-correction state that a fresh install keeps until the user taps
  // "Всього". free = 3915-3908 = 7.
  const s = snapshot(FILE_A.occupied, FILE_A.locked, undefined);
  assert.strictEqual(s.garageCapacity, 3915);
  assert.strictEqual(s.garageTotal, 3915);
  assert.strictEqual(s.garageFree, 7);
});

// ---------------------------------------------------------------------------
check("File A, user manually sets the true 3917: free becomes 9", () => {
  const set = api.sanitizeGarageCapacity(3917, FILE_A.occupied);
  assert.strictEqual(set, 3917);
  const s = snapshot(FILE_A.occupied, FILE_A.locked, set);
  assert.strictEqual(s.garageTotal, 3917);
  assert.strictEqual(s.garageFree, 9, `expected free 9, got ${s.garageFree}`);
  assert.strictEqual(s.garageLocked, FILE_A.locked, "locked must stay untouched");
});

// ---------------------------------------------------------------------------
check("File B with stored 3917: capacity does NOT change (documented limitation)", () => {
  // max(3917, occupied 3917) = 3917. True capacity is really 3919, but
  // occupied never exceeded the stored value, so self-heal cannot see the
  // two newly bought, still-empty slots.
  const s = snapshot(FILE_B.occupied, FILE_B.locked, 3917);
  assert.strictEqual(s.garageCapacity, 3917, `expected no change, got ${s.garageCapacity}`);
  assert.notStrictEqual(s.garageCapacity, FILE_B.trueCapacity,
    "test fixture is wrong: capacity should still be undetectable here");
  assert.strictEqual(s.garageFree, Math.max(0, 3917 - FILE_B.locked));
});

// ---------------------------------------------------------------------------
check("occupied exceeding stored capacity heals upward", () => {
  // stored 3915 (the stale fallback from File A), occupied grew to 3920.
  const s = snapshot(3920, 3908, 3915);
  assert.strictEqual(s.garageCapacity, 3920);
  assert.strictEqual(s.garageFree, 3920 - 3908);
});

// ---------------------------------------------------------------------------
check("manual set below current occupied is clamped up to occupied", () => {
  const occupied = 3914;
  assert.strictEqual(api.sanitizeGarageCapacity(1000, occupied), 3914);
  assert.strictEqual(api.sanitizeGarageCapacity(3913, occupied), 3914);
  assert.strictEqual(api.sanitizeGarageCapacity(3914, occupied), 3914, "equal to occupied is allowed");
  assert.strictEqual(api.sanitizeGarageCapacity(3915, occupied), 3915, "above occupied is kept");
  // invalid input is rejected outright
  assert.strictEqual(api.sanitizeGarageCapacity("", occupied), null);
  assert.strictEqual(api.sanitizeGarageCapacity("abc", occupied), null);
  assert.strictEqual(api.sanitizeGarageCapacity(0, occupied), null);
  assert.strictEqual(api.sanitizeGarageCapacity(-5, occupied), null);
});

// ---------------------------------------------------------------------------
check("capacity never decreases across repeated syncs", () => {
  let stored = null;
  const trace = [];
  // File A (fresh) -> manual 3917 -> File B (occupied 3917) -> a shrinking day.
  const steps = [
    { occupied: FILE_A.occupied, stored: stored, manual: null },
    { occupied: FILE_A.occupied, stored: null, manual: 3917 },
    { occupied: FILE_B.occupied, stored: null },
    { occupied: 3900, stored: null },
  ];
  for (const step of steps) {
    const input = step.manual != null ? api.sanitizeGarageCapacity(step.manual, step.occupied) : stored;
    stored = api.resolveGarageCapacity(step.occupied, input);
    trace.push(stored);
  }
  assert.deepStrictEqual(trace, [3915, 3917, 3917, 3917]);
  for (let i = 1; i < trace.length; i++) {
    assert.ok(trace[i] >= trace[i - 1], `capacity decreased: ${trace.join(" -> ")}`);
  }
});

// ---------------------------------------------------------------------------
check("readStoredGarageCapacity takes the most recent value from history", () => {
  // history rows are date-sorted; the newest non-null value wins.
  const h = [
    { date: "2026-09-28", garageCapacity: 3915 },
    { date: "2026-09-29", garageCapacity: 3917 },
    { date: "2026-09-30" },                       // no capacity yet
  ];
  assert.strictEqual(api.readStoredGarageCapacity(h), 3917);
  assert.strictEqual(api.readStoredGarageCapacity([{ date: "x", garageTotal: 5 }]), null);
  assert.strictEqual(api.readStoredGarageCapacity([]), null);
  assert.strictEqual(api.readStoredGarageCapacity([{ date: "x", garageCapacity: 0 }]), null);
});

// ---------------------------------------------------------------------------
check("free stays correct across the whole 3900..3920 sweep", () => {
  for (let occupied = 3900; occupied <= 3920; occupied++) {
    for (const stored of [undefined, 3915, 3917, 3925]) {
      const s = snapshot(occupied, occupied - 6, stored);
      assert.ok(s.garageCapacity >= occupied,
        `capacity ${s.garageCapacity} < occupied ${occupied} (stored=${stored})`);
      assert.strictEqual(s.garageFree, s.garageCapacity - (occupied - 6));
      assert.strictEqual(s.garageFree, s.garageTotal - (occupied - 6),
        "free must always equal total - locked");
    }
  }
});

console.log("");
if (failures) {
  console.log(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("all checks passed");
#!/usr/bin/env node
// Self-check for the forecast-accuracy backtest in webroot/app.js.
// The functions live inside the app.js IIFE, so this script slices their real
// source text out of the shipped file and runs THAT - it cannot drift from what
// the UI uses. Plain asserts, no framework, no dependencies.
//
//   node scripts/test_forecast_accuracy.js
//
// Scoring is delta-based: |projected change - actual change| / max(|actual
// change|, 1), clamped at 1 per point, averaged (MAPE), then 100 - MAPE.
//
// TZ is pinned to UTC because projectMetric mixes `new Date(date)` (UTC) with
// `new Date(date + "T00:00:00")` (local); outside UTC that shifts spanDays by a
// few hours and the hand-computed expected values below would not hold.
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

const source =
  slice("function computeActiveDailyGain(history, key, lookbackDays = 7", "function forecastPrestigeDays") +
  slice("function projectMetric(hist, key, days", "function renderForecastBlockHtml");

const api = new Function(
  source + "\nreturn { projectMetric, forecastAccuracyPct, ACCURACY_MIN_SAMPLES, ACCURACY_DELTA_FLOOR };"
)();

const day = (i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i));
  return d.toISOString().slice(0, 10);
};
// History with ONLY cash populated, so the hand-computed expectations below are
// not diluted by the other metrics.
const cashOnly = (values) => values.map((cash, i) => ({ date: day(i), cash }));

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

// ===========================================================================
// Fixture: 7 cash points, +10/day, horizon 3 -> exactly 3 samples.
//   cut i: rate = posSum_i / i = (10*i)/i = 10 -> projected delta = round(10*3) = 30
//   actual delta = v[i+3] - v[i]
//   v = [100,110,120,130,140,150,160]  -> deltas 30, 30, 30
// ===========================================================================
const perfect = cashOnly([100, 110, 120, 130, 140, 150, 160]);

// wrong final actual -> only the i=3 sample is affected, the other two keep 30
const miss45 = cashOnly([100, 110, 120, 130, 140, 150, 175]); // delta 45 -> |30-45|/45 = 0.3333
const miss15 = cashOnly([100, 110, 120, 130, 140, 150, 145]); // delta 15 -> |30-15|/15 = 1
const miss60 = cashOnly([100, 110, 120, 130, 140, 150, 190]); // delta 60 -> |30-60|/60 = 0.5

check("perfect forecast scores the 99 ceiling", () => {
  // MAPE = 0 -> 100, clamped to the documented 0..99 ceiling
  assert.strictEqual(api.forecastAccuracyPct(perfect, 3), 99);
});

check("a 1.5x over-forecast scores 89 (err 0.3333 on one of three samples)", () => {
  // MAPE = (0 + 0 + 0.3333)/3 = 0.1111 -> round(88.889) = 89
  assert.strictEqual(api.forecastAccuracyPct(miss45, 3), 89);
});

check("a 2x over-forecast scores 83 (err 0.5 on one of three samples)", () => {
  // MAPE = 0.5/3 = 0.1667 -> round(83.33) = 83
  assert.strictEqual(api.forecastAccuracyPct(miss60, 3), 83);
});

check("a half-sized actual delta scores 67 (err 1.0 on one of three samples)", () => {
  // |30-15|/15 = 1.0 exactly, the per-point cap -> MAPE = 1/3 -> round(66.67) = 67
  assert.strictEqual(api.forecastAccuracyPct(miss15, 3), 67);
});

// ===========================================================================
// A forecast that keeps projecting growth after growth stopped: two cuts land
// on a flat period, so the per-point clamp engages twice.
//   v = [100, 200, 300, 400, 400, 400, 400], N=3
//   rate is 100 at every cut -> projected delta 300
//   i=1: actual delta = 400-200 = 200 -> |300-200|/200 = 0.5
//   i=2: actual delta = 400-300 = 100 -> |300-100|/100 = 2 -> clamp 1
//   i=3: actual delta = 400-400 =   0 -> |300-0|/max(0,1) = 300 -> clamp 1
//   MAPE = (0.5 + 1 + 1)/3 = 0.8333 -> round(16.67) = 17
// ===========================================================================
const staleGrowth = cashOnly([100, 200, 300, 400, 400, 400, 400]);

check("a forecast that never notices growth stopped scores 17", () => {
  assert.strictEqual(api.forecastAccuracyPct(staleGrowth, 3), 17);
});

check("the delta floor is 1 (flat period must not divide by zero)", () => {
  assert.strictEqual(api.ACCURACY_DELTA_FLOOR, 1);
  assert.ok(api.forecastAccuracyPct(staleGrowth, 3) !== null);
});

// ===========================================================================
// The regression this change fixes. Same DELTA shape, two very different
// starting balances: +1000/day for 3 days, then flat, 12 points, N=3.
// Cuts i=1..8 (i+3 < 12), rate from posSum/spanDays over the slice:
//   i<=3 : posSum = 1000*i, spanDays = i -> rate 1000 -> projected delta 3000
//   i>3  : posSum = 3000, spanDays = i    -> rate 3000/i
// actual delta = 1000*min(i+3,3) - 1000*min(i,3):
//   i=1: 2000 -> |3000-2000|/2000 = 0.5
//   i=2: 1000 -> |3000-1000|/1000 = 2 -> clamp 1
//   i=3..8: 0 -> |projected-0|/max(0,1) = projected -> clamp 1
// MAPE = (0.5 + 1*7)/8 = 0.9375 -> round(6.25) = 6
// Under level-based scoring the 100,000,000 starting balance would have
// absorbed the whole error and reported ~99%. Scoring the delta must ignore the
// starting balance entirely, so both fixtures MUST return the identical score.
// ===========================================================================
const deltaShape = (start) => {
  const v = [];
  for (let i = 0; i < 12; i++) v.push(start + 1000 * Math.min(i, 3));
  return cashOnly(v);
};
const hugeBalance = deltaShape(100_000_000);
const tinyBalance = deltaShape(100);

check("starting balance no longer affects the score (level-based bug fixed)", () => {
  const big = api.forecastAccuracyPct(hugeBalance, 3);
  const small = api.forecastAccuracyPct(tinyBalance, 3);
  assert.strictEqual(big, small, `huge balance ${big} != tiny balance ${small}`);
  // i=1,2 err 1 (2x over-forecast) ; i=3 err 0.5 ; i=4 err 1 ; i=5..8 err 1 (flat)
  // MAPE = 7.5/8 = 0.9375 -> round(6.25) = 6
  assert.strictEqual(big, 6, `expected 6 for a materially wrong delta on a huge balance, got ${big}`);
});

// ===========================================================================
// The metric must react to forecast quality: four histories that differ only in
// the final recorded value must give four different scores.
// ===========================================================================
check("score moves with actual forecast error", () => {
  const scores = [perfect, miss45, miss60, miss15].map((h) => api.forecastAccuracyPct(h, 3));
  assert.deepStrictEqual(scores, [99, 89, 83, 67]);
  assert.strictEqual(new Set(scores).size, 4, `expected 4 distinct scores, got ${scores}`);
});

// ===========================================================================
// Too few samples -> null (no misleading number). 5 points, horizon 3: only
// i=1 qualifies (1+3 < 5), i.e. 1 sample, below the minimum of 3.
// ===========================================================================
check("too few samples returns null instead of a number", () => {
  assert.strictEqual(api.ACCURACY_MIN_SAMPLES, 3);
  assert.strictEqual(api.forecastAccuracyPct(cashOnly([100, 110, 120, 130, 140]), 3), null);
  assert.strictEqual(api.forecastAccuracyPct([], 3), null);
  assert.strictEqual(api.forecastAccuracyPct(perfect, 90), null);
});

// ===========================================================================
// Full-scale sanity: 42 days of steady growth at horizon 30. The old volume
// formula reported a flat 90% for anything from 14 days on.
// ===========================================================================
const long42 = cashOnly(Array.from({ length: 42 }, (_, i) => 1000 + 10 * i));

check("42 steady days at horizon 30 score 99; the old formula said 90", () => {
  assert.strictEqual(api.forecastAccuracyPct(long42, 30), 99);
  const oldFormula = Math.min(99, Math.round(20 + 70 * Math.min(42, 14) / 14));
  assert.strictEqual(oldFormula, 90);
  assert.notStrictEqual(api.forecastAccuracyPct(long42, 30), oldFormula);
});

// ===========================================================================
// projectMetric still behaves for the forecast cards: the default asOfTs path
// must be untouched, and expectedDelta must really be the projected change.
// ===========================================================================
check("expectedDelta is exactly the change the forecast is built from", () => {
  const m = api.projectMetric(long42, "cash", 30);
  assert.ok(m, "expected a projection");
  assert.strictEqual(m.perDay, 10);
  assert.strictEqual(m.expectedDelta, 300);           // 10/day * 30 days
  assert.strictEqual(m.projected, m.current + m.expectedDelta);
  assert.strictEqual(m.current, 1000 + 10 * 41);
});

// ===========================================================================
// No look-ahead. The 14-day rate window is anchored at asOfTs. Same slice,
// two anchors:
//   days 0-9   cash 100,110,...,190  (+10/day)
//   days 10-19 cash 200 flat
//   asOfTs = day(19): window days 5-19 -> five +10 steps over 14 days
//                    -> rate 50/14 = 3.571 -> perDay 3.6, projected 211
//   asOfTs = day(29): window days 15-19 -> no positive steps -> perDay 0
// ===========================================================================
check("backtest window is anchored at the cut, not at now", () => {
  const boom = [];
  for (let i = 0; i < 10; i++) boom.push({ date: day(i), cash: 100 + 10 * i });
  for (let i = 10; i < 20; i++) boom.push({ date: day(i), cash: 200 });

  const atCut = api.projectMetric(boom, "cash", 3, new Date(day(19) + "T00:00:00").getTime());
  const atNow = api.projectMetric(boom, "cash", 3, new Date(day(29) + "T00:00:00").getTime());

  assert.ok(atCut && atNow, "expected both projections");
  assert.strictEqual(atCut.perDay, 3.6, `cut-anchored rate should be 3.6, got ${atCut.perDay}`);
  assert.strictEqual(atCut.projected, 211, `cut-anchored projection should be 211, got ${atCut.projected}`);
  assert.strictEqual(atNow.perDay, 0, `later anchor should see a flat window, got ${atNow.perDay}`);
  assert.notStrictEqual(atNow.perDay, atCut.perDay, "asOfTs had no effect - window is not anchored");
});

// ===========================================================================
// Prestige uses a different rate path (computeActiveDailyGain); make sure the
// shared helper still behaves and that metric is scored too.
// ===========================================================================
check("prestige is scored through its own rate path", () => {
  const hist = Array.from({ length: 20 }, (_, i) => ({ date: day(i), prestige: 100 + 5 * i }));
  assert.strictEqual(api.forecastAccuracyPct(hist, 3), 99);
});

console.log("");
if (failures) {
  console.log(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("all checks passed");
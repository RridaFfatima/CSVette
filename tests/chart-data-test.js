/* Chart-data engine tests — expectations computed from raw data. */
import { readFileSync } from "fs";
import { Papa } from "./vendor/papaparse.mjs";
import { normalizeDataset } from "../js/csv-parser.js";
import { profileDataset } from "../js/data-profile.js";
import {
  numericValues, binCountFor, computeHistogram, computeBoxStats,
  computeCategoryCounts, computeAggregates, computeScatter, computeLine,
  pearson, computeCorrelations, chartConfigError,
} from "../js/chart-data.js";

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
  ok ? pass++ : fail++;
}
function close(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

const messyText = readFileSync(new URL("../sample-data/messy_customers.csv", import.meta.url), "utf8");
const { dataset } = normalizeDataset(await Papa.parse(messyText, { header: true, skipEmptyLines: "greedy" }), "m.csv", messyText.length);
const profile = profileDataset(dataset);
const rows = dataset.rows;

/* Raw ground truth, recomputed here independently.
   NOTE: Number("") === 0, so a naive Number() check silently counts empty
   cells — missing tokens must be excluded before parsing (exactly what the
   engine's isMissing guard does; these tests mirror it explicitly). */
const MISSING = ["", "null", "n/a", "na", "?", "-", "—"];
const isMiss = (v) => MISSING.includes(String(v ?? "").trim().toLowerCase());
const rawNum = (id) => rows.map(r => r[id]).filter(v => !isMiss(v)).map(Number).filter(Number.isFinite);
const ageNums = rawNum("age");
const loyaltyNums = rawNum("loyalty_score");
check("ground truth: usable age values", ageNums.length, 26);
check("ground truth: usable loyalty values", loyaltyNums.length, 29);

/* numericValues */
const ageRes = numericValues(rows, "age");
check("numericValues age count", ageRes.values.length, 26);
check("numericValues age skipped", ageRes.skipped, 4);

/* Histogram */
const hist = computeHistogram(rows, "age");
check("hist usable", hist.usable, true);
check("hist bin count within 5–30", hist.binCount >= 5 && hist.binCount <= 30, true);
check("hist counts sum to usable n", hist.bins.reduce((s, b) => s + b.count, 0), 26);
check("hist first bin starts at min", close(hist.bins[0].x0, Math.min(...ageNums)), true);
check("hist last bin ends at max", close(hist.bins[hist.bins.length - 1].x1, Math.max(...ageNums)), true);
const histEmpty = computeHistogram(rows, "full_name");
check("hist on text column unusable", histEmpty.usable, false);

/* Box */
const box = computeBoxStats(rows, "loyalty_score");
const sortedL = [...loyaltyNums].sort((a, b) => a - b);
check("box n", box.n, 29);
check("box min", close(box.min, sortedL[0]), true);
check("box max", close(box.max, sortedL[sortedL.length - 1]), true);
check("box median matches brute force", close(box.median, sortedL.length % 2 ? sortedL[(sortedL.length - 1) / 2] : (sortedL[sortedL.length / 2 - 1] + sortedL[sortedL.length / 2]) / 2), true);
check("box whiskers within fences", box.whiskerLow >= box.q1 - 1.5 * box.iqr && box.whiskerHigh <= box.q3 + 1.5 * box.iqr, true);
check("box outliers all outside fences", box.outliers.every(o => o.value < box.q1 - 1.5 * box.iqr || o.value > box.q3 + 1.5 * box.iqr), true);
const boxTiny = computeBoxStats([{ __rowNum: 1, v: "1" }, { __rowNum: 2, v: "2" }, { __rowNum: 3, v: "3" }], "v");
check("box with <4 values unusable", boxTiny.usable, false);

/* Category counts */
const cat = computeCategoryCounts(rows, "country");
const rawCountries = rows.map(r => String(r.country ?? "").trim()).filter(v => !isMiss(v));
check("cat total non-missing", cat.categories.reduce((s, c) => s + c.count, 0) + (cat.omittedCount ?? 0), rawCountries.length);
check("cat sorted desc", cat.categories.every((c, i) => i === 0 || cat.categories[i - 1].count >= c.count), true);
const catBig = computeCategoryCounts(rows, "country", { topN: 2 });
check("cat topN respected", catBig.categories.length, 2);
check("cat topN omission recorded", catBig.totalCategories > 2 && catBig.omitted > 0, true);

/* Aggregates */
const aggMean = computeAggregates(rows, "source", "loyalty_score", "mean");
const bySource = new Map();
for (const r of rows) {
  const g = String(r.source ?? "").trim();
  if (isMiss(g)) continue;
  if (isMiss(r.loyalty_score)) continue; // empty loyalty must NOT become Number("") = 0
  const v = Number(r.loyalty_score);
  if (!Number.isFinite(v)) continue;
  if (!bySource.has(g)) bySource.set(g, []);
  bySource.get(g).push(v);
}
let aggOk = true;
for (const c of aggMean.categories) {
  const nums = bySource.get(c.value);
  const m = nums.reduce((s, n) => s + n, 0) / nums.length;
  if (!close(c.stat, m, 1e-9)) aggOk = false;
}
check("agg mean verified per group", aggOk && aggMean.categories.length === bySource.size, true);
const aggCount = computeAggregates(rows, "source", null, "count");
check("agg count sums to non-missing groups", aggCount.categories.reduce((s, c) => s + c.stat, 0), [...bySource.keys()].reduce((s, k) => s + bySource.get(k).length, 0) + rows.filter(r => isMiss(r.loyalty_score) && !isMiss(r.source)).length);
const aggBad = computeAggregates(rows, "source", "full_name", "mean");
check("agg with no usable values → unusable or empty", aggBad.usable === false || aggBad.categories.length === 0, true);

/* Scatter */
const sc = computeScatter(rows, "age", "loyalty_score");
const bothUsable = rows.filter(r => {
  const a = Number(r.age), l = Number(r.loyalty_score);
  return !isMiss(r.age) && !isMiss(r.loyalty_score) && Number.isFinite(a) && Number.isFinite(l);
});
check("scatter points = rows usable in both", sc.points.length, bothUsable.length);
check("scatter skipped = rest", sc.skipped, rows.length - bothUsable.length);

/* Line */
const ln = computeLine(rows, "signup_date", "loyalty_score", "mean");
check("line usable", ln.usable, true);
check("line points sorted by time", ln.points.every((p, i) => i === 0 || ln.points[i - 1].t <= p.t), true);
const rawDates = new Set(rows.map(r => String(r.signup_date ?? "").trim()).filter(v => v !== "" && v.toLowerCase() !== "null").map(v => v));
check("line distinct date groups ≤ raw distinct dates", ln.points.length <= rawDates.size, true);

/* Pearson — analytic cases */
check("pearson perfect +", pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
check("pearson perfect −", pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1);
check("pearson constant → null", pearson([5, 5, 5, 5], [1, 2, 3, 4]), null);
check("pearson n<3 → null", pearson([1, 2], [2, 4]), null);
check("pearson symmetric-ish sanity", Math.abs(pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])) < 1, true);

/* Correlations — incl. the row-pairing regression case */
const corr = computeCorrelations(rows, profile);
check("corr has 2 numeric cols", corr.columns.length, 2);
check("corr diagonal 1", corr.matrix[0][0].r === 1 && corr.matrix[1][1].r === 1, true);
check("corr matrix symmetric", close(corr.matrix[0][1].r, corr.matrix[1][0].r), true);
check("corr n ≤ 26 (missing pairs excluded)", corr.matrix[0][1].n <= 26, true);
// Synthetic: row1 has A but not B — index-pairing would silently misalign.
const synthRows = [
  { __rowNum: 1, a: "1", b: "" },      // b missing → excluded from pair count
  { __rowNum: 2, a: "2", b: "4" },
  { __rowNum: 3, a: "3", b: "6" },
  { __rowNum: 4, a: "4", b: "8" },
];
const synthProfile = { byColumn: { a: { columnId: "a", name: "A", type: "integer" }, b: { columnId: "b", name: "B", type: "integer" } } };
const synthCorr = computeCorrelations(synthRows, synthProfile);
check("corr pairs by row number (excludes missing pair)", synthCorr.matrix[0][1].n, 3);
check("corr coefficient correct despite gaps", synthCorr.matrix[0][1].r, 1);

/* Config validation */
const cfg = (t, xId, yId, agg) => ({ type: t, xId, yId, agg });
check("reject histogram on string col", chartConfigError(cfg("histogram", "full_name"), profile) !== null, true);
check("reject box on date col", chartConfigError(cfg("box", "signup_date"), profile) !== null, true);
check("reject scatter with same col twice", chartConfigError(cfg("scatter", "age", "age"), profile) !== null, true);
check("reject scatter with text axis", chartConfigError(cfg("scatter", "age", "full_name"), profile) !== null, true);
check("reject line on non-date axis", chartConfigError(cfg("line", "age", "loyalty_score"), profile) !== null, true);
check("reject agg-bar with text value", chartConfigError(cfg("agg-bar", "country", "full_name", "mean"), profile) !== null, true);
check("reject unknown agg", chartConfigError(cfg("agg-bar", "country", "loyalty_score", "variance"), profile) !== null, true);
check("accept valid histogram", chartConfigError(cfg("histogram", "age"), profile), null);
check("accept valid scatter", chartConfigError(cfg("scatter", "age", "loyalty_score"), profile), null);
check("accept valid line", chartConfigError(cfg("line", "signup_date", "loyalty_score", "mean"), profile), null);
check("accept valid agg-bar", chartConfigError(cfg("agg-bar", "country", "loyalty_score", "median"), profile), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

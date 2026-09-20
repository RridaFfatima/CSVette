/* ============================================================
   CSVette — insights-test.js
   Milestone 8 §31/§34: deterministic insight behavior against
   fixtures with KNOWN properties, plus ground-truth checks from
   the raw messy_customers data (so a shared calculation bug
   cannot hide behind a self-consistent test).
   ============================================================ */
import { readFileSync } from "fs";
import { Papa } from "./vendor/papaparse.mjs";
import { normalizeDataset } from "../js/csv-parser.js";
import { profileDataset } from "../js/data-profile.js";
import { analyzeQuality } from "../js/data-quality.js";
import { removeDuplicates, fillMissing } from "../js/cleaning.js";
import { generateInsights, THRESHOLDS } from "../js/insights.js";

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
  ok ? pass++ : fail++;
}
function checkTrue(label, actual) { check(label, !!actual, true); }
function checkFalse(label, actual) { check(label, !!actual, false); }

let rowNum = 0;
const mkDataset = (name, columns, rows) => ({
  name, sizeBytes: 100,
  columns: columns.map((c) => ({ id: c, name: c })),
  rows: rows.map((r) => ({ __rowNum: ++rowNum, ...r })),
  rowCount: rows.length,
});
const analyze = (ds) => {
  const profile = profileDataset(ds);
  return { profile, quality: analyzeQuality(ds, profile) };
};

/* ---------- fixtures with known properties ---------- */

// 20 rows: gender is 75% "F" (concentration), score has known outliers via IQR
const CONC_ROWS = [];
for (let i = 1; i <= 15; i++) CONC_ROWS.push({ gender: "F", score: String(i) });
for (let i = 1; i <= 5; i++) CONC_ROWS.push({ gender: "M", score: String(i) });
// 3 extra extreme scores → outliers with known values
const OUT_ROWS = [];
for (let i = 1; i <= 20; i++) OUT_ROWS.push({ score: String(i * 10) });
OUT_ROWS[0].score = "100000"; OUT_ROWS[1].score = "200000"; OUT_ROWS[2].score = "-99999";

const dsMissing = mkDataset("missing.csv", ["name", "email"], [
  { name: "a", email: "x@y.z" }, { name: "b", email: "" }, { name: "c", email: "N/A" },
  { name: "d", email: "" }, { name: "e", email: "?" }, { name: "f", email: "q@r.s" },
  { name: "g", email: "" }, { name: "h", email: "" }, { name: "i", email: "" },
  { name: "j", email: "" }, // b,c,d,e,g,h,i,j = 8 of 10 = 80% missing → warning (> 25%)
]);
const dsClean = mkDataset("clean.csv", ["id", "gpa"], [
  { id: "1", gpa: "3.0" }, { id: "2", gpa: "3.1" }, { id: "3", gpa: "2.9" },
  { id: "4", gpa: "3.2" }, { id: "5", gpa: "3.0" }, { id: "6", gpa: "3.1" },
]);
const dsDupes = mkDataset("dupes.csv", ["a", "b"], [
  { a: "1", b: "x" }, { a: "1", b: "x" }, { a: "1", b: "x" }, { a: "2", b: "y" },
]);
const dsTiny = mkDataset("tiny.csv", ["x", "y"], [
  { x: "1", y: "2" }, { x: "2", y: "4" }, { x: "3", y: "5" },
]);

/* ---------- missingness (§6) ---------- */
console.log("— missingness —");
{
  const { profile, quality } = analyze(dsMissing);
  const list = generateInsights(dsMissing, profile, quality);
  const m = list.find((i) => i.type === "missingness");
  checkTrue("80% missing column produces insight", !!m);
  checkTrue("text states 80% of rows", m?.description.includes("80% of rows"));
  checkTrue("text includes counts (8 of 10)", m?.description.includes("(8 of 10)"));
  check("share > 25% → warning severity", m?.severity, "warning");
  check("route points at missing view", m?.route, "missing");

  // 1 of 30 (3.3%) stays BELOW both thresholds → no insight (noise rule)
  const messyText = readFileSync(new URL("../sample-data/messy_customers.csv", import.meta.url), "utf8");
  const messy = normalizeDataset(await Papa.parse(messyText, { header: true, skipEmptyLines: "greedy" }), "m.csv", messyText.length).dataset;
  const a2 = analyze(messy);
  const ageProf = a2.profile.byColumn.age;
  check("fixture sanity: age missing share < 10%", ageProf.missing / ageProf.total < THRESHOLDS.MISSING_SHARE, true);
  checkFalse("low missingness stays silent", a2 && generateInsights(messy, a2.profile, a2.quality)
    .some((i) => i.type === "missingness" && i.metadata.columnId === "age"));
}

/* ---------- category concentration (§7) ---------- */
console.log("— concentration —");
{
  const ds = mkDataset("conc.csv", ["gender", "score"], CONC_ROWS);
  const { profile, quality } = analyze(ds);
  const list = generateInsights(ds, profile, quality);
  const c = list.find((i) => i.type === "concentration");
  checkTrue("75% dominant category produces insight", !!c);
  checkTrue("names the dominant value", c?.description.includes('"F"'));
  checkTrue("states 75%", c?.description.includes("75%"));
  check("route → table", c?.route, "table");
}

/* ---------- correlation (§9, ground truth from raw data §34) ---------- */
console.log("— correlation —");
{
  const messyText = readFileSync(new URL("../sample-data/messy_customers.csv", import.meta.url), "utf8");
  const messy = normalizeDataset(await Papa.parse(messyText, { header: true, skipEmptyLines: "greedy" }), "m.csv", messyText.length).dataset;
  const { profile, quality } = analyze(messy);
  const list = generateInsights(messy, profile, quality);
  const corr = list.find((i) => i.type === "correlation");
  checkTrue("age×loyalty association found", !!corr);
  // §34 ground truth: computed independently in M5 as r = 0.8929 over 25 pairs
  checkTrue("rounded to 2 decimals (no fake precision)", corr?.description.includes("r = 0.89"));
  checkTrue("includes n = 25", corr?.description.includes("n = 25"));
  checkTrue("uses observational language", corr?.description.includes("association"));
  checkFalse("no causal verbs", /causes|leads to|drives|predicts|proves|results in/i.test(corr?.description ?? ""));
  checkTrue("carries the caution note", corr?.description.includes("not causation"));
  check("route → correlations", corr?.route, "correlations");

  // tiny sample: n = 3 < CORRELATION_MIN_N → no correlation insight (§19)
  const aTiny = analyze(dsTiny);
  checkFalse("tiny sample: no strong claims", generateInsights(dsTiny, aTiny.profile, aTiny.quality)
    .some((i) => i.type === "correlation"));
}

/* ---------- outliers (§11, ground truth) ---------- */
console.log("— outliers —");
{
  const ds = mkDataset("out.csv", ["score"], OUT_ROWS);
  const { profile, quality } = analyze(ds);
  const list = generateInsights(ds, profile, quality);
  const o = list.find((i) => i.type === "outliers");
  checkTrue("extreme scores produce outlier insight", !!o);
  checkTrue("count is exactly 3 (ground truth)", o?.description.includes("3 potential outliers"));
  checkTrue("phrased as potential, not errors", o?.description.includes("potential outlier"));
  checkTrue("honest caveat present", o?.description.includes("not necessarily errors"));
  check("route → outliers", o?.route, "outliers");
}

/* ---------- duplicates ---------- */
console.log("— duplicates —");
{
  const { profile, quality } = analyze(dsDupes);
  const list = generateInsights(dsDupes, profile, quality);
  const d = list.find((i) => i.type === "duplicates");
  checkTrue("2 duplicate rows → insight", !!d);
  checkTrue("count stated", d?.description.startsWith("2 rows are exact duplicates"));
}

/* ---------- clean dataset: all-clear, no exaggeration (§20, §33) ---------- */
console.log("— clean dataset —");
{
  const { profile, quality } = analyze(dsClean);
  const list = generateInsights(dsClean, profile, quality);
  checkTrue("quality all-clear present", list.some((i) => i.type === "quality" && i.description.includes("No major quality findings")));
  checkFalse("no missingness noise", list.some((i) => i.type === "missingness"));
  checkFalse("no outlier noise", list.some((i) => i.type === "outliers"));
  checkFalse("no fabricated concentration", list.some((i) => i.type === "concentration"));
}

/* ---------- language & precision invariants (§3, §18) ---------- */
console.log("— language & precision —");
{
  const messyText = readFileSync(new URL("../sample-data/messy_customers.csv", import.meta.url), "utf8");
  const messy = normalizeDataset(await Papa.parse(messyText, { header: true, skipEmptyLines: "greedy" }), "m.csv", messyText.length).dataset;
  const { profile, quality } = analyze(messy);
  const list = generateInsights(messy, profile, quality);
  for (const i of list) {
    checkFalse(`no causal verbs in [${i.type}]`, /causes|leads to|drives|predicts|proves|results in/i.test(i.description));
    checkFalse(`no raw precision in [${i.type}]`, /\d\.\d{3,}/.test(i.description));
    checkTrue(`[${i.type}] has source label`, typeof i.source === "string" && i.source.length > 3);
    checkTrue(`[${i.type}] has route`, typeof i.route === "string");
  }
  check("insight count capped at 6", list.length <= THRESHOLDS.MAX_INSIGHTS, true);
}

/* ---------- recalculation after cleaning / reset (§21) ---------- */
console.log("— recalculation —");
{
  const messyText = readFileSync(new URL("../sample-data/messy_customers.csv", import.meta.url), "utf8");
  const messy = normalizeDataset(await Papa.parse(messyText, { header: true, skipEmptyLines: "greedy" }), "m.csv", messyText.length).dataset;
  const before = analyze(messy);
  const insightsBefore = generateInsights(messy, before.profile, before.quality);
  checkTrue("before cleaning: duplicate insight present", insightsBefore.some((i) => i.type === "quality" || i.type === "duplicates"));

  // clean: dedupe + fill every missing cell
  const deduped = removeDuplicates(messy);
  const ds1 = deduped.dataset ?? deduped;
  let ds2 = ds1;
  for (const col of ds1.columns) {
    const prof = profileDataset(ds2).byColumn[col.id];
    if (prof.missing > 0) {
      const filled = fillMissing(ds2, col.id, "mode", "");
      ds2 = filled.dataset ?? filled;
    }
  }
  const after = analyze(ds2);
  const insightsAfter = generateInsights(ds2, after.profile, after.quality);
  check("rows changed 30 → 29", ds2.rowCount, 29);
  checkFalse("old missingness insights gone", insightsAfter.some((i) => i.type === "missingness"));
  checkFalse("duplicate insight gone after dedupe", insightsAfter.some((i) => i.type === "duplicates"));

  // reset: same inputs as the original → identical insight output
  const reset = analyze(messy);
  const insightsReset = generateInsights(messy, reset.profile, reset.quality);
  check("reset reproduces original insight count", insightsReset.length, insightsBefore.length);
  check("reset reproduces first insight", JSON.stringify(insightsReset[0]), JSON.stringify(insightsBefore[0]));
}

/* ---------- structural shape (§25) ---------- */
console.log("— object shape —");
{
  const { profile, quality } = analyze(dsMissing);
  const list = generateInsights(dsMissing, profile, quality);
  for (const i of list) {
    for (const key of ["type", "severity", "title", "description", "source", "route", "metadata"]) {
      checkTrue(`insight has ${key}`, key in i);
    }
    checkTrue("severity from engine vocabulary", ["info", "warning", "critical"].includes(i.severity));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

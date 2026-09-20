/* ============================================================
   CSVette — report-test.js
   Milestone 7 §33/§34: the HTML report — sections, findings,
   before/after correctness, and XSS-safety of dataset text.
   ============================================================ */
import { readFileSync } from "fs";
import { Papa } from "./vendor/papaparse.mjs";
import { normalizeDataset } from "../js/csv-parser.js";
import { profileDataset } from "../js/data-profile.js";
import { analyzeQuality, computeHealth } from "../js/data-quality.js";
import { removeDuplicates, fillMissing, renameColumn } from "../js/cleaning.js";
import { buildQualityReportHtml, escapeHtml } from "../js/report.js";

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
  ok ? pass++ : fail++;
}
function checkTrue(label, actual) {
  check(label, !!actual, true);
}

let rowNum = 0;
const mkDataset = (name, columns, rows) => ({
  name, sizeBytes: 100,
  columns: columns.map((c) => ({ id: c, name: c })),
  rows: rows.map((r) => ({ __rowNum: ++rowNum, ...r })),
  rowCount: rows.length,
});

function fullAnalysis(dataset) {
  const profile = profileDataset(dataset);
  const quality = analyzeQuality(dataset, profile);
  const health = computeHealth(profile, quality.findings);
  return { profile, quality, health };
}

/* ---------- escapeHtml unit checks (§23) ---------- */
console.log("— escapeHtml —");
check("amp", escapeHtml("a&b"), "a&amp;b");
check("lt", escapeHtml("<script>"), "&lt;script&gt;");
check("quote", escapeHtml('" onmouseover="alert(1)'), "&quot; onmouseover=&quot;alert(1)");
check("apos", escapeHtml("it's"), "it&#39;s");
check("null-safe", escapeHtml(undefined), "");

/* ---------- messy fixture: findings present ---------- */
const messyText = readFileSync(new URL("../sample-data/messy_customers.csv", import.meta.url), "utf8");
const messy = normalizeDataset(await Papa.parse(messyText, { header: true, skipEmptyLines: "greedy" }), "messy_customers.csv", messyText.length).dataset;
{
  const { profile, quality, health } = fullAnalysis(messy);
  const html = buildQualityReportHtml({
    fileName: "messy_customers.csv", original: messy, working: messy,
    profile, quality, health, history: [], generatedAt: new Date("2026-01-15T10:30:00"),
  });

  console.log("— messy report: structure & findings —");
  checkTrue("title escapes into <title>", html.includes(`<title>Data Quality Report — ${escapeHtml("messy_customers.csv")}</title>`));
  checkTrue("score line present", html.includes(`<span class="score">${health.score}</span>`));
  checkTrue("band chip present", html.includes(`chip-${health.band}`));
  for (const dim of Object.keys(health.dimensions)) checkTrue(`dimension row: ${dim}`, html.includes(dim));
  checkTrue("missing section", html.includes("Missing values"));
  checkTrue("duplicates section", html.includes("Duplicate rows"));
  checkTrue("outliers section", html.includes("Potential outliers"));
  checkTrue("outliers phrased as potential", html.includes("not necessarily errors"));
  checkTrue("consistency section", html.includes("Consistency"));
  checkTrue("type issues section", html.includes("Type issues"));
  checkTrue("identifier issues section", html.includes("Identifier issues"));
  checkTrue("country variants listed", html.includes("Pakistan"));
  checkTrue("column profile has age row", html.includes("<th scope=\"row\">age</th>"));
  checkTrue("no-cleaning message", html.includes("No cleaning operations were performed."));
  checkTrue("no before/after when no ops", !html.includes("Before / after cleaning"));
  checkTrue("footer states browser-only", html.includes("no data left this device"));
  checkTrue("no external resources", !/src=|href="http/.test(html.replace(/<meta[^>]*>/g, "")));
}

/* ---------- after cleaning: metrics change, history & before/after appear ---------- */
{
  const deduped = removeDuplicates(messy);
  const ds1 = deduped.dataset ?? deduped;
  const ageId = ds1.columns.find((c) => c.name === "age").id;
  const filled = fillMissing(ds1, ageId, "median", "");
  const ds2 = filled.dataset ?? filled;
  const renamed = renameColumn(ds2, "cust_name", "customer_name");
  const ds3 = (renamed.dataset ?? renamed);
  // cust_name doesn't exist — use a real column rename: country → nation
  const ren2 = renameColumn(ds2, "country", "nation");
  const ds4 = ren2.dataset ?? ren2;
  const { profile, quality, health } = fullAnalysis(ds4);
  const history = [
    { label: "Removed 1 duplicate row", detail: "29 of 30 rows kept", affected: 1, time: new Date("2026-01-15T10:00:00") },
    { label: `Filled 2 missing values in age using median`, detail: "2 cells changed", affected: 2, time: new Date("2026-01-15T10:05:00") },
    { label: "Renamed country → nation", detail: "", affected: 0, time: new Date("2026-01-15T10:06:00") },
  ];
  const html = buildQualityReportHtml({
    fileName: "messy_customers.csv", original: messy, working: ds4,
    profile, quality, health, history, generatedAt: new Date("2026-01-15T10:30:00"),
  });

  console.log("— cleaned report: before/after & history —");
  checkTrue("before/after section present", html.includes("Before / after cleaning"));
  checkTrue("before/after: original rows = 30", /<td class="num">30<\/td>/.test(html));
  checkTrue("before/after: working rows = 29", /<td class="num">29<\/td>/.test(html));
  checkTrue("history listed with order", html.includes("<span class=\"step\">1.</span> Removed 1 duplicate row"));
  checkTrue("history op 2 present", html.includes("Filled 2 missing values in age using median"));
  checkTrue("rename recorded", html.includes("Renamed country → nation"));
  checkTrue("cleaned context line", html.includes("working dataset</strong> (3 cleaning operations"));
  checkTrue("report uses NEW column name", html.includes("<th scope=\"row\">nation</th>"));
  checkTrue("old column name absent from profile", !html.includes("<th scope=\"row\">country</th>"));
  checkTrue("age missing now 0 in profile", !/<th scope="row">age<\/th><td>[^<]*<\/td><td class="num">[1-9]/.test(html));
}

/* ---------- reset state: report represents restored original ---------- */
{
  const { profile, quality, health } = fullAnalysis(messy);
  const html = buildQualityReportHtml({
    fileName: "messy_customers.csv", original: messy, working: messy,
    profile, quality, health, history: [], generatedAt: new Date(),
  });
  console.log("— reset report —");
  checkTrue("matches-original context", html.includes("matches the original uploaded file"));
  checkTrue("no ops reported", html.includes("No cleaning operations were performed."));
}

/* ---------- clean dataset: all-clear sections (§33) ---------- */
{
  const clean = mkDataset("students.csv", ["id", "gpa"],
    [{ id: "1", gpa: "3.9" }, { id: "2", gpa: "3.4" }, { id: "3", gpa: "2.8" }]);
  const { profile, quality, health } = fullAnalysis(clean);
  const html = buildQualityReportHtml({
    fileName: "students.csv", original: clean, working: clean,
    profile, quality, health, history: [], generatedAt: new Date(),
  });
  console.log("— clean dataset report —");
  checkTrue("score computed", html.includes(`<span class="score">${health.score}</span>`));
  const clearChips = (html.match(/chip-good">All clear/g) ?? []).length;
  checkTrue("all-clear sections present (≥5)", clearChips >= 5);
  checkTrue("no fabricated missing rows", !html.includes(`<th scope="row">gpa</th><td class="num">1</td>`));
}

/* ---------- XSS: hostile dataset values, names & columns (§34) ---------- */
{
  const evil = "<script>alert(1)</script>";
  // Every hostile payload is a COLUMN NAME — the profile table always shows
  // those, so each payload is guaranteed to surface in the summary report.
  const nameImg = "<img src=x onerror=alert(2)>";
  const nameAttr = 'x" onmouseover="alert(1)';
  const nameSvg = "'><svg onload=alert(3)>";
  const nameFormula = "=cmd|' /C calc'!A0";
  const nameUni = "± 東京 🚀";
  const ds = mkDataset(`${evil}.csv`, [evil, nameImg, nameAttr, nameSvg, nameFormula, nameUni], [
    { [evil]: "a", [nameImg]: "v1", [nameAttr]: "v1", [nameSvg]: "v1", [nameFormula]: "v1", [nameUni]: "v1" },
    { [evil]: "b", [nameImg]: "v2", [nameAttr]: "v2", [nameSvg]: "v2", [nameFormula]: "v2", [nameUni]: "v2" },
    { [evil]: "c", [nameImg]: "v3", [nameAttr]: "v3", [nameSvg]: "v3", [nameFormula]: "v3", [nameUni]: "v3" },
  ]);
  const { profile, quality, health } = fullAnalysis(ds);
  const html = buildQualityReportHtml({
    fileName: `${evil}.csv`, original: ds, working: ds,
    profile, quality, health, history: [], generatedAt: new Date(),
  });

  console.log("— XSS safety —");
  checkTrue("no raw <script> from data", !html.includes("<script>alert(1)</script>"));
  checkTrue("script tag only as escaped text", html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  checkTrue("img payload escaped", html.includes("&lt;img src=x onerror=alert(2)&gt;"));
  checkTrue("svg payload escaped", html.includes("&lt;svg onload=alert(3)&gt;"));
  checkTrue("attr-breaking payload escaped", html.includes("x&quot; onmouseover=&quot;alert(1)"));
  checkTrue("title escaped", !html.includes(`<title>Data Quality Report — ${evil}.csv</title>`));
  checkTrue("no event-handler attribute from data", !html.includes('onmouseover="alert(1)"/>'));
  checkTrue("unicode column name preserved as text", html.includes("東京"));
  checkTrue("formula-looking name preserved verbatim (policy)", html.includes("=cmd|&#39; /C calc&#39;!A0"));
  // The document must contain no real script elements at all:
  checkTrue("no executable script elements", !/<script[\s>]/i.test(html));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

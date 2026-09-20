/* ============================================================
   CSVette — export-test.js
   Milestone 7 §32: CSV export — original/working/filtered
   variants, RFC 4180 escaping, filenames. Report tests live in
   report-test.js.
   ============================================================ */
import { readFileSync } from "fs";
import { Papa } from "./vendor/papaparse.mjs";
import { normalizeDataset } from "../js/csv-parser.js";
import { profileDataset } from "../js/data-profile.js";
import { replaceValue, renameColumn, removeDuplicates, deleteColumn } from "../js/cleaning.js";
import { explorer, resetExplorer } from "../js/data-filter.js";
import { csvField, serializeCsv, safeFilename, buildDatasetCsv, buildFilteredCsv } from "../js/csv-export.js";

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
  ok ? pass++ : fail++;
}
function checkTrue(label, actual) { check(label, !!actual, true); }

let rowNum = 0;
const mkDataset = (columns, rows) => ({
  name: "test.csv",
  sizeBytes: 100,
  columns: columns.map((name) => ({ id: name, name })),
  rows: rows.map((r) => ({ __rowNum: ++rowNum, ...r })),
  rowCount: rows.length,
});

console.log("— csvField: RFC 4180 escaping —");
check("plain value untouched", csvField("hello"), "hello");
check("comma → quoted", csvField("Smith, John"), '"Smith, John"');
check("embedded quote → doubled", csvField('say "hi"'), '"say ""hi"""');
check("newline → quoted", csvField("line1\nline2"), '"line1\nline2"');
check("CRLF → quoted", csvField("a\r\nb"), '"a\r\nb"');
check("empty → empty", csvField(""), "");
check("null/undefined → empty", csvField(undefined), "");
check("unicode preserved", csvField("Zürich — 東京"), "Zürich — 東京");
check("leading space → quoted (preserved)", csvField("  padded"), '"  padded"');
check("numeric-looking stays string", csvField("007"), "007");
check("number works too", csvField(42), "42");

console.log("— serializeCsv —");
{
  const cols = [{ id: "a", name: "A" }, { id: "b", name: "B, the second" }];
  const rows = [{ a: "x", b: 'he said "ok"' }, { a: "1,5", b: "" }];
  const out = serializeCsv(cols, rows);
  check("BOM present", out.charCodeAt(0), 0xfeff);
  check("header quoted when needed", out.split("\r\n")[0].slice(1), 'A,"B, the second"');
  check("row 1 quote-escaped", out.split("\r\n")[1], 'x,"he said ""ok"""');
  check("row 2 comma-quoted, empty trailing", out.split("\r\n")[2], '"1,5",');
  check("ends with CRLF", out.endsWith("\r\n") && !out.endsWith("\r\n\r\n"), true);
}

console.log("— filenames —");
check("basic original", safeFilename("sales.csv", "original", "csv"), "sales_original.csv");
check("report name", safeFilename("messy_customers.csv", "data_quality_report", "html"), "messy_customers_data_quality_report.html");
check("path separators stripped", safeFilename("..\\..\\evil.csv", "working", "csv"), "..-..-evil_working.csv");
check("invalid chars → dash", safeFilename('re:port*?.csv', "working", "csv"), "re-port--_working.csv");
check("trailing dots/spaces removed", safeFilename("name. .csv", "working", "csv"), "name_working.csv");
check("empty base → dataset", safeFilename("", "working", "csv"), "dataset_working.csv");
check("long name capped at 80", safeFilename("x".repeat(200) + ".csv", "working", "csv").length <= 80 + "_working.csv".length, true);
check("unicode name preserved", safeFilename("résumés 2026.csv", "working", "csv"), "résumés 2026_working.csv");

console.log("— original export (messy_customers fixture) —");
{
  const messyText = readFileSync(new URL("../sample-data/messy_customers.csv", import.meta.url), "utf8");
  const { dataset } = normalizeDataset(await Papa.parse(messyText, { header: true, skipEmptyLines: "greedy" }), "messy_customers.csv", messyText.length);
  const exp = buildDatasetCsv(dataset);
  const dataLines = exp.text.slice(1).trimEnd().split("\r\n"); // drop BOM
  check("original: header line matches column names", dataLines[0], dataset.columns.map((c) => c.name).join(","));
  check("original: row count", exp.rowCount, 30);
  check("original: serialized rows = dataset rows", dataLines.length - 1, 30);
  // A known messy value survives byte-for-byte: the "Pak" variant + missing tokens
  check("original: variant value preserved", dataLines.some((l) => l.includes("Pak")), true);
  check("original: no cleaning applied (variants still present)", dataLines.some((l) => /,u\.k\.,|,USA,/.test(l)), true);

  console.log("— working export after cleaning —");
  const renamed = renameColumn(dataset, "country", "nation");
  const replaced = replaceValue(renamed.dataset ?? renamed, "country", "Pak", "Pakistan");
  // handle either {dataset} or dataset-shaped returns defensively:
  const step1 = renamed.error ? renamed : renamed;
  const ds1 = step1.dataset ?? step1;
  const step2 = replaceValue(ds1, "country", "Pak", "Pakistan");
  const ds2 = step2.dataset ?? step2;
  const deduped = removeDuplicates(ds2);
  const ds3 = deduped.dataset ?? deduped;
  const dropped = deleteColumn(ds3, "city");
  const ds4 = dropped.dataset ?? dropped;
  const wexp = buildDatasetCsv(ds4);
  const wLines = wexp.text.slice(1).trimEnd().split("\r\n");
  check("working: renamed column in header", wLines[0].includes("nation"), true);
  check("working: old column name gone", wLines[0].includes("country"), false);
  check("working: deleted column absent", wLines[0].includes("city"), false);
  check("working: dup rows removed", wexp.rowCount, 29);
  check("working: Pak replaced", wLines.some((l) => l.includes("Pakistan")), true);
  check("working: Pak value gone", wLines.some((l) => /,Pak,/.test(l)), false);
}

console.log("— filtered export (reuses the Data Table pipeline) —");
{
  resetExplorer();
  const messyText = readFileSync(new URL("../sample-data/messy_customers.csv", import.meta.url), "utf8");
  const { dataset } = normalizeDataset(await Papa.parse(messyText, { header: true, skipEmptyLines: "greedy" }), "messy_customers.csv", messyText.length);
  const profile = profileDataset(dataset);
  const countryId = dataset.columns.find((c) => c.name === "country").id;

  // No filters → all 30 rows, and the UI text must say so honestly
  const all = buildFilteredCsv(dataset, profile);
  check("filtered: no filter → all rows", all.rowCount, 30);

  explorer.search = "pakistan";
  const search = buildFilteredCsv(dataset, profile);
  // ground truth: country contains "pakistan" ×6 (case-insensitive) in the fixture
  check("filtered: search matches table view (6 rows)", search.rowCount, 6);

  explorer.search = "";
  explorer.filters.push({ columnId: countryId, op: "equals", value: "pakistan", value2: "" });
  const one = buildFilteredCsv(dataset, profile);
  check("filtered: equals filter → 6 rows", one.rowCount, 6);
  check("filtered: only matching rows", one.text.includes("Pakistan") && !one.text.includes("Berlin"), true);

  // pagination must NOT limit output: page 5 with 50/page still holds all matches
  explorer.pageIndex = 4;
  const paged = buildFilteredCsv(dataset, profile);
  check("filtered: pagination ignored", paged.rowCount, 6);
  explorer.pageIndex = 0;
  explorer.filters = [];
  resetExplorer();
}

/* ============================================================
   M9 QA regressions - defects found during the QA milestone.
   Each block reproduces a defect, proves the fix, and guards it.
   ============================================================ */

console.log("- M9 QA regressions -");

/* QA-1 (P3): td.col-focus had no CSS rule, so deep-linked columns
   highlighted only their header. The fix is CSS-only, so the
   regression test asserts the rule exists in the stylesheet. */
{
  const css = readFileSync(new URL("../css/style.css", import.meta.url), "utf8");
  checkTrue("QA-1: td.col-focus style rule exists", css.includes("td.col-focus"));
}

/* QA-2 (P3): the workspace theme toggle button had no accessible
   name (icon-only). Fix adds aria-label + title. */
{
  const shell = readFileSync(new URL("../js/views/shell.js", import.meta.url), "utf8");
  checkTrue("QA-2: theme toggle has aria-label", shell.includes('themeBtn.setAttribute("aria-label"'));
}

/* QA-3 (P2): safeFilename must neutralize angle brackets from file
   names like evil<script>x.csv - invalid on Windows filesystems. */
check("QA-3: angle brackets sanitized", safeFilename("evil<script>x.csv", "data_quality_report", "html"), "evil-script-x_data_quality_report.html");
check("QA-3b: mixed unsafe chars sanitized", safeFilename('a<b>c:d"e.csv', "working", "csv"), "a-b-c-d-e_working.csv");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

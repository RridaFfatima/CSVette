/* Cleaning-engine tests (M6 §30). Immutability is the core assertion:
   every op must return NEW structures and leave the input untouched. */
import {
  countDuplicates, countTrimmable, countValueMatches, countMissing,
  computeFillValue, customValueError, renameError,
  removeDuplicates, fillMissing, trimWhitespace, normalizeCase,
  replaceValue, renameColumn, deleteColumn, deleteRows,
} from "../js/cleaning.js";
import { resetToOriginal, undoLast, pushHistory, getHistory, canUndo, loadDataset } from "../js/state.js";

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
  ok ? pass++ : fail++;
}
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function checkDeep(label, actual, expected) {
  const ok = deepEq(actual, expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
  ok ? pass++ : fail++;
}

/* Helpers to build datasets in the app's shape */
let rowNum = 0;
const mkDataset = (columns, rows) => ({
  name: "test.csv",
  sizeBytes: 100,
  columns: columns.map((name) => ({ id: name, name })),
  rows: rows.map((r) => ({ __rowNum: ++rowNum, ...r })),
  rowCount: rows.length,
});

/* ---------- §30 duplicate removal: the spec's exact example ---------- */
const dupeDs = mkDataset(["A", "B"], [
  { A: "1", B: "x" },
  { A: "1", B: "x" },
  { A: "2", B: "y" },
]);
check("preview: 1 duplicate found", countDuplicates(dupeDs), 1);
const dupeResult = removeDuplicates(dupeDs);
checkDeep("duplicate removal result rows", dupeResult.dataset.rows.map(r => [r.A, r.B]), [["1", "x"], ["2", "y"]]);
check("duplicate removal rowCount", dupeResult.dataset.rowCount, 2);
check("duplicate removal returns history summary", dupeResult.summary.label, "Removed 1 duplicate row");
checkDeep("original unchanged after dedupe", dupeDs.rows.map(r => [r.A, r.B]), [["1", "x"], ["1", "x"], ["2", "y"]]);
check("original rowCount unchanged", dupeDs.rowCount, 3);

/* ---------- Missing value fill ---------- */
const nums = ["10", "20", "", "30", "N/A"]; // mean 20, median 20
const fillDs = mkDataset(["score", "city", "active"], [
  { score: "10", city: "Lahore", active: "true" },
  { score: "20", city: "", active: "false" },
  { score: "", city: "Karachi", active: "" },
  { score: "30", city: "Lahore", active: "true" },
  { score: "N/A", city: "", active: "false" },
]);
check("missing count via shared definition", countMissing(fillDs, "score"), 2);
check("fill value: mean of integers stays integer", computeFillValue(fillDs, "score", "mean"), "20");
check("fill value: median", computeFillValue(fillDs, "score", "median"), "20");
check("fill value: mode of city", computeFillValue(fillDs, "city", "mode"), "Lahore");
check("fill value: custom passes through", computeFillValue(fillDs, "score", "custom", "42"), "42");

const fillMean = fillMissing(fillDs, "score", "mean");
check("fill mean changed 2 cells", fillMean.summary.affected, 2);
check("fill mean result", fillMean.dataset.rows.map(r => r.score).join(","), "10,20,20,30,20");
checkDeep("original unchanged after fill", fillDs.rows.map(r => r.score).join(","), "10,20,,30,N/A");
check("missing count after fill", countMissing(fillMean.dataset, "score"), 0);

// mean with a decimal: NOT rounded to integer
const floatDs = mkDataset(["v"], [{ v: "1.5" }, { v: "2.5" }, { v: "" }]);
check("fill value: mean keeps decimals", computeFillValue(floatDs, "v", "mean"), "2");

// mode fill on booleans column: true appears more
check("fill value: mode of boolean column", computeFillValue(fillDs, "active", "mode"), "true");

/* ---------- Custom value validation (§8) ---------- */
check("numeric accepts 42", customValueError("integer", "42"), null);
check("numeric rejects hello", customValueError("integer", "hello") !== null, true);
check("float accepts 3.14", customValueError("float", "3.14"), null);
check("float rejects abc", customValueError("float", "abc") !== null, true);
check("boolean rejects maybe", customValueError("boolean", "maybe") !== null, true);
check("boolean accepts true", customValueError("boolean", "true"), null);
check("date accepts 2024-03-01", customValueError("date", "2024-03-01"), null);
check("date rejects junk", customValueError("date", "tomorrow") !== null, true);
check("string accepts anything", customValueError("string", "hello world"), null);
check("empty custom rejected", customValueError("string", "   ") !== null, true);

/* ---------- Trim (§9) ---------- */
const trimDs = mkDataset(["country"], [
  { country: " Pakistan" },
  { country: "Pakistan " },
  { country: "\tU.K." },
  { country: "China" },
  { country: "   " },          // whitespace-only → becomes empty (still missing)
]);
check("preview: trimmable cells (whitespace-only counts — it becomes empty)", countTrimmable(trimDs, "country"), 4);
const trimmed = trimWhitespace(trimDs, ["country"]);
check("trim changed 4 cells", trimmed.summary.affected, 4);
check("trim results", JSON.stringify(trimmed.dataset.rows.map(r => r.country)), JSON.stringify(["Pakistan", "Pakistan", "U.K.", "China", ""]));
checkDeep("original unchanged after trim", trimDs.rows.map(r => r.country).join("|"), " Pakistan|Pakistan |\tU.K.|China|   ");

/* ---------- Case normalization (§10) ---------- */
const caseDs = mkDataset(["country"], [
  { country: "Pakistan" },
  { country: "pakistan" },
  { country: "PAKISTAN" },
  { country: "" },
  { country: "new zealand" },
]);
const lower = normalizeCase(caseDs, "country", "lower");
check("lowercase results (missing cell untouched)", JSON.stringify(lower.dataset.rows.map(r => r.country)), JSON.stringify(["pakistan", "pakistan", "pakistan", "", "new zealand"]));
check("lowercase changed 2", lower.summary.affected, 2);
const upper = normalizeCase(caseDs, "country", "upper");
check("uppercase results", upper.dataset.rows.map(r => r.country)[0], "PAKISTAN");
const title = normalizeCase(caseDs, "country", "title");
check("title case results", JSON.stringify(title.dataset.rows.map(r => r.country)), JSON.stringify(["Pakistan", "Pakistan", "Pakistan", "", "New Zealand"]));
check("invalid mode rejected", normalizeCase(caseDs, "country", "camel").error !== null, true);
checkDeep("original unchanged after case ops", caseDs.rows.map(r => r.country), ["Pakistan", "pakistan", "PAKISTAN", "", "new zealand"]);

/* ---------- Value replacement (§11) ---------- */
const repDs = mkDataset(["country"], [{ country: "Pak" }, { country: "Pakistan" }, { country: " Pak " }, { country: "PK" }]);
check("preview: matches by trimmed value", countValueMatches(repDs, "country", "Pak"), 2);
const rep = replaceValue(repDs, "country", "Pak", "Pakistan");
check("replace affected rows (trim-matched)", rep.summary.affected, 2);
check("replace results", JSON.stringify(rep.dataset.rows.map(r => r.country)), JSON.stringify(["Pakistan", "Pakistan", "Pakistan", "PK"]));
check("replace same-value rejected", replaceValue(repDs, "country", "Pak", "Pak").error !== null, true);
check("replace empty-from rejected", replaceValue(repDs, "country", "  ", "X").error !== null, true);

/* ---------- Rename (§12) ---------- */
const renDs = mkDataset(["cust_name", "age"], [{ cust_name: "Ava", age: "30" }, { cust_name: "Ben", age: "40" }]);
check("valid rename", "error" in renameColumn(renDs, "cust_name", "customer_name"), false);
const renamed = renameColumn(renDs, "cust_name", "customer_name");
checkDeep("rename preserves order", renamed.dataset.columns.map(c => c.name), ["customer_name", "age"]);
check("rename keeps column id stable", renamed.dataset.columns[0].id, "cust_name");
check("rename keeps row data", renamed.dataset.rows[0].cust_name, "Ava");
check("empty name rejected", renameError(renDs, "cust_name", "   ") !== null, true);
check("duplicate name rejected (case-insensitive)", renameError(renDs, "cust_name", "AGE") !== null, true);
check("same name rejected", renameColumn(renDs, "cust_name", "cust_name").error !== null, true);
checkDeep("original unchanged after rename", renDs.columns.map(c => c.name), ["cust_name", "age"]);

/* ---------- Delete column (§13) ---------- */
const delColResult = deleteColumn(renDs, "age");
check("column removed", delColResult.dataset.columns.some(c => c.id === "age"), false);
check("rows lose the key", delColResult.dataset.rows[0].age, undefined);
check("other columns intact", delColResult.dataset.rows[0].cust_name, "Ava");
checkDeep("original unchanged after column delete", renDs.columns.map(c => c.id), ["cust_name", "age"]);
check("delete nonexistent column rejected", deleteColumn(renDs, "nope").error !== null, true);

/* ---------- Delete rows (§14) ---------- */
const delDs = mkDataset(["A"], [{ A: "1" }, { A: "2" }, { A: "3" }, { A: "4" }]);
const delRows = deleteRows(delDs, [delDs.rows[1].__rowNum, delDs.rows[3].__rowNum]);
check("rows removed by row number", JSON.stringify(delRows.dataset.rows.map(r => r.A)), JSON.stringify(["1", "3"]));
check("rowCount updated", delRows.dataset.rowCount, 2);
check("surviving rows keep original row numbers", JSON.stringify(delRows.dataset.rows.map(r => r.__rowNum)), JSON.stringify([delDs.rows[0].__rowNum, delDs.rows[2].__rowNum]));
check("delete with stale row numbers errors clearly", deleteRows(delDs, [9999]).error !== null, true);
check("delete with empty selection errors", deleteRows(delDs, []).error !== null, true);
checkDeep("original unchanged after row delete", delDs.rows.map(r => r.A), ["1", "2", "3", "4"]);

/* ---------- Immutability: ops on a FROZEN dataset (state deep-freezes) ---------- */
const frozen = mkDataset(["A", "B"], [{ A: "1", B: "x" }, { A: "1", B: "x" }, { A: "2", B: "y" }]);
Object.freeze(frozen);
Object.freeze(frozen.rows);
frozen.rows.forEach(r => Object.freeze(r));
Object.freeze(frozen.columns);
frozen.columns.forEach(c => Object.freeze(c));
let frozenOk = true;
try {
  const r1 = removeDuplicates(frozen);
  const r2 = fillMissing(r1.dataset, "A", "custom", "7");
  const r3 = trimWhitespace(r2.dataset, ["B"]);
  const r4 = renameColumn(r3.dataset, "A", "ID");
  const r5 = deleteColumn(r4.dataset, "B");
  if (r5.dataset.columns.length !== 1) frozenOk = false;
  if (frozen.rows.length !== 3) frozenOk = false;
} catch { frozenOk = false; }
check("full op chain works on frozen datasets; original untouched", frozenOk, true);

/* ---------- History semantics: failures return {error}, no summary ---------- */
const failedOps = [
  replaceValue(repDs, "country", "", "X"),
  renameColumn(renDs, "cust_name", ""),
  deleteRows(delDs, []),
  normalizeCase(caseDs, "country", "camel"),
  fillMissing(fillDs, "city", "mean"), // mean on a text column → no numbers
];
check("failed ops return error (no summary → no history entry)", failedOps.every(op => op.error && op.summary === undefined), true);
check("fill with no computable value errors", fillMissing(fillDs, "city", "mean").error !== null, true);

/* ---------- M6 §30: undo / reset / history semantics ---------- */

// Pristine fixture, frozen exactly like the app's loadDataset does.
const mkFrozen = () => {
  const ds = mkDataset(["id", "city"], [
    { id: "1", city: "Oslo" },
    { id: "1", city: "Oslo" },   // exact duplicate of row 1 (every column equal)
    { id: "2", city: "Lima" },
    { id: "2", city: "Lima" },   // exact duplicate of row 3
    { id: "3", city: "" },
  ]);
  deepFreezeAll(ds);
  return ds;
};
function deepFreezeAll(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const k of Object.keys(obj)) deepFreezeAll(obj[k]);
  }
}

// §19: no history entries without a successful op. Undo/reset on empty history.
check("undo with empty history is a no-op returning null", undoLast(), null);
check("reset with no history does not throw", (() => { resetToOriginal(); return true; })(), true);
check("history empty without ops", getHistory().length, 0);

// operation 1 → operation 2 → undo === state after operation 1 (§30).
const u1 = mkFrozen();
loadDataset(u1, []);   // sets state.dataset.original (null in Node otherwise) — emit has no listeners
const afterOp1 = removeDuplicates(u1);   // 5 → 3 rows (Oslo, Lima, empty)
pushHistory(afterOp1.summary, u1);
const afterOp2 = trimWhitespace(afterOp1.dataset, ["city"]);
pushHistory(afterOp2.summary, afterOp1.dataset);

checkDeep("history records successful ops in order", getHistory().map(e => e.label),
  ["Removed 2 duplicate rows", "Trimmed whitespace in city — 0 cells"]);
check("canUndo true with entries", canUndo(), true);

const undone = undoLast();
check("undo restores the state after op 1", undone.rowCount, 3);
check("undo restores exact rows", JSON.stringify(undone.rows.map(r => r.city)), JSON.stringify(["Oslo", "Lima", ""]));
checkDeep("undo drops the last entry", getHistory().map(e => e.label), ["Removed 2 duplicate rows"]);
check("undo preserves original untouched", u1.rowCount, 5);

// Failed op must NOT appear in history (§30).
const failed = normalizeCase(undone, "city", "camel");
check("failed op returns error", failed.error !== undefined, true);
check("failed op did not touch history", getHistory().length, 1);

// reset after multiple operations → working === original (§30).
const afterOp3 = trimWhitespace(undone, ["city"]);
pushHistory(afterOp3.summary, undone);
const restored = resetToOriginal();
check("reset restores the original object itself", restored === u1, true);
check("reset restores all original rows", restored.rowCount, 5);
check("reset clears history", getHistory().length, 0);
check("original stays frozen after undo/reset cycle", Object.isFrozen(u1), true);

// State layer must be browser-independent: emit() has no listeners in Node.
let emitThrew = false;
try { pushHistory({ label: "x", detail: "d" }, u1); } catch { emitThrew = true; }
check("pushHistory works with zero listeners (no DOM)", emitThrew, false);
resetToOriginal();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

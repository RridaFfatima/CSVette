import { readFileSync } from "fs";
import { Papa } from "./vendor/papaparse.mjs";
import { normalizeDataset } from "../js/csv-parser.js";
import { profileDataset } from "../js/data-profile.js";
import {
  rowPredicate, makeFilter, describeFilter, filterError, summarizeFilters,
  filterFamilyFor, cellMatchesQuery, rowMatches,
} from "../js/data-filter.js";

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  → got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
  ok ? pass++ : fail++;
}
const messyText = readFileSync(new URL("../sample-data/messy_customers.csv", import.meta.url), "utf8");
const { dataset } = normalizeDataset(await Papa.parse(messyText, { header: true, skipEmptyLines: "greedy" }), "messy_customers.csv", messyText.length);
const profile = profileDataset(dataset);
const rows = dataset.rows;

console.log("— families —");
check("age → number", filterFamilyFor(profile.byColumn.age.type), "number");
check("loyalty_score → number", filterFamilyFor(profile.byColumn.loyalty_score.type), "number");
check("country → other", filterFamilyFor(profile.byColumn.country.type), "other");
check("signup_date → date", filterFamilyFor(profile.byColumn.signup_date.type), "date");
check("newsletter → boolean", filterFamilyFor(profile.byColumn.newsletter.type), "boolean");
check("customer_id → other", filterFamilyFor(profile.byColumn.customer_id.type), "other");

console.log("— operators (counts verified against raw data) —");
check("loyalty_score > 70 → 1", rows.filter(rowPredicate(null, [makeFilter("loyalty_score", "gt", "70")])).length, 1);
check("country = Pakistan → 6", rows.filter(rowPredicate(null, [makeFilter("country", "equals", "Pakistan")])).length, 6);
check("country contains 'pak' → 8 (6 Pakistan + 2 'Pak')", rows.filter(rowPredicate(null, [makeFilter("country", "contains", "pak")])).length, 8);
check("age is empty → 2", rows.filter(rowPredicate(null, [makeFilter("age", "is-empty")])).length, 2);
check("age between 20–40 → 20", rows.filter(rowPredicate(null, [makeFilter("age", "between", "20", "40")])).length, 20);
check("signup_date between Q1 2023 → 26 (all dates are Jan–Apr)", rows.filter(rowPredicate(null, [makeFilter("signup_date", "date-between", "2023-01-01", "2023-03-31")])).length, 26);
check("signup_date after 2023-06-01 → 0 (correct: latest is April)", rows.filter(rowPredicate(null, [makeFilter("signup_date", "after", "2023-06-01")])).length, 0);
check("name starts with 'A' → 4", rows.filter(rowPredicate(null, [makeFilter("full_name", "starts", "A")])).length, 4);
check("name is-not-empty → 30", rows.filter(rowPredicate(null, [makeFilter("full_name", "is-not-empty")])).length, 30);
check("newsletter is-true → 16", rows.filter(rowPredicate(null, [makeFilter("newsletter", "is-true")])).length, 16);
check("newsletter is-false → 14", rows.filter(rowPredicate(null, [makeFilter("newsletter", "is-false")])).length, 14);
check("newsletter is-empty → 0 (column complete)", rows.filter(rowPredicate(null, [makeFilter("newsletter", "is-empty")])).length, 0);

console.log("— combined AND filters —");
const pak = makeFilter("country", "contains", "pak");
const ageRange = makeFilter("age", "between", "20", "40");
const loyal = makeFilter("loyalty_score", "gte", "6");
check("country contains pak AND age 20–40 → 6", rows.filter(rowPredicate(null, [pak, ageRange])).length, 6);
check("+ loyalty_score ≥ 6 (3 filters) → 3", rows.filter(rowPredicate(null, [pak, ageRange, loyal])).length, 3);

console.log("— search —");
check("search '19' → 2 (age=19 row + id 00019; numeric columns match by value)", rows.filter(rowPredicate(19, [])).length, 2);
check("search 'ava' → 2", rows.filter(rowPredicate("ava", [])).length, 2);
check("search '000' → 30 (id column)", rows.filter(rowPredicate("000", [])).length, 30);
check("search '' keeps everything", rows.filter(rowPredicate("", [])).length, 30);
check("search '19' AND country=Pakistan → 0 (row 18 is U.K.)", rows.filter(rowPredicate("19", [makeFilter("country", "equals", "Pakistan")])).length, 0);
check("search 'an' AND country=Pakistan → 6 ('Pakistan' contains 'an')", rows.filter(rowPredicate("an", [makeFilter("country", "equals", "Pakistan")])).length, 6);

console.log("— rowMatches parity —");
check("rowMatches agrees with rowPredicate",
  rows.filter(r => rowMatches(r, 19, [pak])).length,
  rows.filter(rowPredicate(19, [pak])).length);

console.log("— cell matching semantics —");
check("numeric query matches exact value", cellMatchesQuery(19, 19), true);
check("numeric query ignores substring of other numbers", cellMatchesQuery(91.2, 19), false);
check("string query is a case-insensitive substring", cellMatchesQuery("U.K.", "u.k."), true);
check("string query does not span punctuation", cellMatchesQuery("U.K.", "uk"), false);

console.log("— validation —");
check("between needs both values", filterError(makeFilter("age", "between", "20", ""), "integer") !== null, true);
check("between must be ordered", filterError(makeFilter("age", "between", "40", "20"), "integer") !== null, true);
check("numeric op rejects text", filterError(makeFilter("age", "gt", "abc"), "integer") !== null, true);
check("date op rejects junk", filterError(makeFilter("signup_date", "after", "not-a-date"), "date") !== null, true);
check("valid date passes", filterError(makeFilter("signup_date", "after", "2023-01-15"), "date"), null);
check("valid number passes", filterError(makeFilter("age", "gt", "20"), "integer"), null);

console.log("— description & summary —");
check("describe gte", describeFilter(makeFilter("loyalty_score", "gte", "70"), "loyalty_score"), "loyalty_score ≥ 70");
check("describe contains", describeFilter(makeFilter("country", "contains", "pak"), "country"), 'country contains "pak"');
check("describe between", describeFilter(makeFilter("age", "between", "20", "40"), "age"), "20 ≤ age ≤ 40");
check("describe is-empty", describeFilter(makeFilter("age", "is-empty"), "age"), "age is empty");
check("summarize counts filters", summarizeFilters([makeFilter("loyalty_score", "gt", "70"), pak]), 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

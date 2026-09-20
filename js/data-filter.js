/* ============================================================
   CSVette — data-filter.js
   The pure heart of the Data Explorer: given a search query and
   a list of filters, decide which rows are visible. No DOM —
   table.js asks this module for a predicate and applies it.

   Filtering is a *view*: the original and working datasets are
   never touched. `row.__rowNum` is the original row number and
   is always preserved so deep links keep working.
   ============================================================ */

import { isMissing, parseDate, matchesType } from "./data-profile.js";
import { parseNumber } from "./statistics.js";

/* ---------- Types ---------- */

/**
 * @typedef {Object} Filter
 * @property {string} id          unique id (crypto.randomUUID or fallback)
 * @property {string} columnId    column this filter applies to
 * @property {string} op          operator key (see OPERATORS)
 * @property {string} value       raw user input ("" for is-empty/is-not-empty)
 */

/** Operators per column type. `label` is shown in the picker, `valueLabel` builds the chip text. */
export const OPERATORS = {
  text: {
    ops: ["contains", "equals", "starts", "is-empty", "is-not-empty"],
    labels: {
      contains: "contains", equals: "equals", starts: "starts with",
      "is-empty": "is empty", "is-not-empty": "is not empty",
    },
  },
  number: {
    ops: ["equals", "gt", "lt", "gte", "lte", "between", "is-empty", "is-not-empty"],
    labels: {
      equals: "equals", gt: "greater than", lt: "less than",
      gte: "≥", lte: "≤", between: "between",
      "is-empty": "is empty", "is-not-empty": "is not empty",
    },
  },
  boolean: {
    ops: ["is-true", "is-false", "is-empty", "is-not-empty"],
    labels: { "is-true": "is true", "is-false": "is false", "is-empty": "is empty", "is-not-empty": "is not empty" },
  },
  date: {
    ops: ["before", "after", "date-between", "is-empty", "is-not-empty"],
    labels: {
      before: "before", after: "after", "date-between": "between",
      "is-empty": "is empty", "is-not-empty": "is not empty",
    },
  },
  other: {
    ops: ["contains", "equals", "starts", "is-empty", "is-not-empty"],
    labels: {
      contains: "contains", equals: "equals", starts: "starts with",
      "is-empty": "is empty", "is-not-empty": "is not empty",
    },
  },
};

/** Map an inferred column type → filter operator family. */
export function filterFamilyFor(type) {
  if (type === "integer" || type === "float") return "number";
  if (type === "boolean") return "boolean";
  if (type === "date") return "date";
  return "other"; // string / categorical / identifier — plain text matching
}

/* ---------- Value helpers ---------- */

function asNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const TRUE_VALUES = new Set(["true", "yes", "y"]);
const FALSE_VALUES = new Set(["false", "no", "n"]);

function asBool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (TRUE_VALUES.has(s)) return true;
  if (FALSE_VALUES.has(s)) return false;
  return null;
}

/* ---------- Filter evaluation ---------- */

/**
 * Does one value pass one filter?
 * Missing values: "is-empty" matches; every other operator fails a missing
 * value (so `age > 20` never accidentally matches an empty cell).
 */
function valuePasses(raw, filter) {
  const missing = isMissing(raw);
  const v = String(raw ?? "").trim();

  switch (filter.op) {
    case "is-empty": return missing;
    case "is-not-empty": return !missing;
    default: break;
  }
  if (missing) return false;

  switch (filter.op) {
    case "contains": return v.toLowerCase().includes(filter.value.toLowerCase());
    case "equals": return v.toLowerCase() === filter.value.toLowerCase();
    case "starts": return v.toLowerCase().startsWith(filter.value.toLowerCase());

    case "gt": case "lt": case "gte": case "lte": case "between": {
      const n = asNumber(v);
      if (n === null) return false;
      const a = asNumber(filter.value);
      if (a === null) return false;
      if (filter.op === "gt") return n > a;
      if (filter.op === "lt") return n < a;
      if (filter.op === "gte") return n >= a;
      if (filter.op === "lte") return n <= a;
      const b = asNumber(filter.value2);
      return b !== null && n >= a && n <= b;
    }

    case "is-true": return asBool(v) === true;
    case "is-false": return asBool(v) === false;

    case "before": case "after": case "date-between": {
      const d = parseDate(v);
      if (d === null) return false;
      const a = parseDate(filter.value);
      if (a === null) return false;
      if (filter.op === "before") return d < a;
      if (filter.op === "after") return d > a;
      const b = parseDate(filter.value2);
      return b !== null && d >= a && d <= b;
    }

    default: return true;
  }
}

/** One row passes one filter? */
export function rowMatchesFilter(row, filter) {
  if (!filter || !filter.columnId || !filter.op) return true;
  return valuePasses(row[filter.columnId] ?? "", filter);
}

/** How many rows of `rows` match one filter? (Used by filter-form hints.) */
export function countMatching(rows, filter) {
  let n = 0;
  for (const row of rows) if (rowMatchesFilter(row, filter)) n++;
  return n;
}

/* ---------- Search evaluation ---------- */

/**
 * One cell matches the search query?
 * Numbers: matches if any digit-substring of the cell equals the numeric
 * query ("19" matches "199.99" once, "1199" never matches it).
 * Everything else: plain case-insensitive substring on the trimmed value.
 * Booleans keep the substring rule ("tr" matches "true" — harmless).
 */
export function cellMatchesQuery(raw, query) {
  const v = String(raw ?? "").trim();
  if (v === "") return false;
  if (typeof query === "number") {
    return v.includes(String(query)) && asNumber(v) === query;
  }
  return v.toLowerCase().includes(query.toLowerCase());
}

/** Searchable columns of a row: every key except the internal row number. */
function searchableColumns(row) {
  return Object.keys(row).filter((k) => k !== "__rowNum");
}

/**
 * One row matches the search query across the given columns?
 * An empty/null query matches everything (search never removes rows on
 * its own). `columnIds` may be omitted — the row's own columns are used.
 */
export function rowMatchesQuery(row, query, columnIds) {
  if (query === null || query === "") return true;
  const cols = Array.isArray(columnIds) && columnIds.length > 0 ? columnIds : searchableColumns(row);
  for (const columnId of cols) {
    if (cellMatchesQuery(row[columnId] ?? "", query)) return true;
  }
  return false;
}

/* ---------- The combined predicate ---------- */

/**
 * Build the visible-row predicate: every filter must pass AND the row must
 * match the search. `filters` is an array (order irrelevant, AND semantics);
 * `query` is a string or number (null/"" = no search). `columnIds` narrows
 * the searched columns (the view passes the working dataset's columns).
 */
export function rowPredicate(query, filters, columnIds) {
  const active = Array.isArray(filters) ? filters : [];
  return (row) =>
    rowMatchesQuery(row, query, columnIds)
    && active.every((f) => rowMatchesFilter(row, f));
}

/** Convenience: filter+search one row in one call. */
export function rowMatches(row, query, filters, columnIds) {
  const active = Array.isArray(filters) ? filters : [];
  return rowMatchesQuery(row, query, columnIds)
    && active.every((f) => rowMatchesFilter(row, f));
}

/* ---------- Filter helpers used by the UI ---------- */

let filterSeq = 0;

/** Create a filter object with a stable id. */
export function makeFilter(columnId, op, value = "", value2 = "") {
  filterSeq += 1;
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `f${Date.now()}-${filterSeq}`,
    columnId,
    op,
    value,
    value2,
  };
}

/** Human chip text for one filter: `age ≥ 70` / `country contains "pak"`. */
export function describeFilter(filter, columnName) {
  const { op } = filter;
  const hasValue = filter.value !== "" || filter.value2 !== "";
  const val = hasValue
    ? (op === "between" || op === "date-between")
      ? `${filter.value} – ${filter.value2}`
      : filter.value
    : "";
  const num = (s) => (asNumber(s) !== null ? s : `"${s}"`);

  switch (op) {
    case "is-empty": return `${columnName} is empty`;
    case "is-not-empty": return `${columnName} is not empty`;
    case "is-true": return `${columnName} is true`;
    case "is-false": return `${columnName} is false`;
    case "contains": return `${columnName} contains ${num(val)}`;
    case "equals": return `${columnName} = ${num(val)}`;
    case "starts": return `${columnName} starts with ${num(val)}`;
    case "gt": return `${columnName} > ${num(val)}`;
    case "lt": return `${columnName} < ${num(val)}`;
    case "gte": return `${columnName} ≥ ${num(val)}`;
    case "lte": return `${columnName} ≤ ${num(val)}`;
    case "between": return `${num(filter.value)} ≤ ${columnName} ≤ ${num(filter.value2)}`;
    case "before": return `${columnName} before ${filter.value}`;
    case "after": return `${columnName} after ${filter.value}`;
    case "date-between": return `${filter.value} ≤ ${columnName} ≤ ${filter.value2}`;
    default: return `${columnName} ${op} ${val}`;
  }
}

/** Validate one filter; returns an error message or null. */
export function filterError(filter, columnType) {
  const family = filterFamilyFor(columnType);
  const hasValue = filter.value !== "" || filter.value2 !== "";
  const needsValue = !["is-empty", "is-not-empty", "is-true", "is-false"].includes(filter.op);
  if (needsValue && !hasValue) return "Enter a value for this filter.";
  if (!needsValue) return null;

  if (family === "number") {
    if (asNumber(filter.value) === null) return `"${filter.value}" is not a number.`;
    if ((filter.op === "between") && asNumber(filter.value2) === null) {
      return `"${filter.value2}" is not a number.`;
    }
    if (filter.op === "between" && asNumber(filter.value) > asNumber(filter.value2)) {
      return "The first value must be ≤ the second.";
    }
  }
  if (family === "date") {
    if (parseDate(filter.value) === null) return `"${filter.value}" is not a recognized date.`;
    if (filter.op === "date-between") {
      if (parseDate(filter.value2) === null) return `"${filter.value2}" is not a recognized date.`;
      if (parseDate(filter.value) > parseDate(filter.value2)) {
        return "The first date must be on or before the second.";
      }
    }
  }
  return null;
}

/** Live match count for the form: how many rows would this filter keep? */
export function filterPreviewCount(rows, draft) {
  return countMatching(rows, draft);
}

/* ---------- Summaries ---------- */

/** "3 filters active" — count only well-formed filters. */
export function summarizeFilters(filters) {
  return Array.isArray(filters) ? filters.length : 0;
}

/** Reset the whole filter state (table stays sorted as-is). */
export function clearAllFilters(filters) {
  return [];
}

/** Which columnIds have at least one active filter? (for header markers) */
export function filteredColumnIds(filters) {
  return new Set((filters ?? []).map((f) => f.columnId));
}

/* Re-export for views that need type-consistency with the engine. */
export { matchesType };

/* ============================================================
   Explorer state + the combined view pipeline

   `explorer` is the ONE mutable view-state object for the Data
   Table (search text, active filters, page, sort). It lives here
   so the whole pipeline — search → filters → sort → page — is
   importable, inspectable, and testable without the DOM.
   ============================================================ */

export const EXPLORER_PAGE_SIZE = 50;

export const explorer = {
  search: "",                                   // raw query text ("" = off)
  filters: [],                                  // active Filter objects (AND)
  pageIndex: 0,                                 // current page in the *filtered* view
  sort: { columnId: null, dir: null },          // dir: "asc" | "desc" | null
};

/** Reset explorer state (new dataset, or "start over"). */
export function resetExplorer() {
  explorer.search = "";
  explorer.filters = [];
  explorer.pageIndex = 0;
  explorer.sort = { columnId: null, dir: null };
}

/** Nearest valid page for `visibleCount` rows (used after filtering). */
export function clampPage(visibleCount) {
  const pages = Math.max(1, Math.ceil(visibleCount / EXPLORER_PAGE_SIZE));
  return Math.min(explorer.pageIndex, pages - 1);
}

/** Normalized family for the UI layer ("other" behaves like text). */
export function effectiveFamily(family) {
  return family === "other" ? "text" : family;
}

/**
 * The combined Data Table view: search AND filters AND sort applied to the
 * working dataset. Returns the visible rows in display order plus the set of
 * their original row numbers (used to detect deep-linked rows hidden by a
 * filter). Never mutates the dataset — filtering is a view.
 */
export function computeView(working, profile) {
  const columnIds = working.columns.map((c) => c.id);

  // A stale sort (from a previously loaded dataset) must not survive.
  if (explorer.sort.columnId && !columnIds.includes(explorer.sort.columnId)) {
    explorer.sort = { columnId: null, dir: null };
  }

  const q = explorer.search.trim();
  const query = q === "" ? null : (/^[+-]?\d+(\.\d+)?$/.test(q) ? Number(q) : q);
  const predicate = rowPredicate(query, explorer.filters, columnIds);
  const rows = working.rows.filter(predicate);

  return { rows: sortRows(rows, explorer.sort, profile), visibleRowNums: new Set(rows.map((r) => r.__rowNum)) };
}

/** Type-aware sort of the visible rows. Missing values always sort last. */
function sortRows(rows, sort, profile) {
  if (!sort.columnId || !sort.dir) return rows;

  const type = profile.byColumn[sort.columnId]?.type ?? "string";
  const numeric = type === "integer" || type === "float";
  const isDate = type === "date";
  const dir = sort.dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const va = a[sort.columnId] ?? "";
    const vb = b[sort.columnId] ?? "";
    const ma = isMissing(va);
    const mb = isMissing(vb);
    if (ma && mb) return 0;
    if (ma) return 1;   // missing always last, regardless of direction
    if (mb) return -1;

    if (numeric) return (Number(va) - Number(vb)) * dir;
    if (isDate) {
      const da = parseDate(va)?.getTime() ?? 0;
      const db = parseDate(vb)?.getTime() ?? 0;
      return (da - db) * dir;
    }
    return String(va).localeCompare(String(vb)) * dir;
  });
}

/* ============================================================
   CSVette — data-profile.js
   Missing-value tokens, conservative type inference, per-column
   profiles, and dataset-level profiling. Pure module: no DOM.

   Guiding rule: identifiers like "00123" are labels, not numbers.
   ============================================================ */

import { parseNumber, mean, median, stdDev, percentile, countUnique, mode, frequencies } from "./statistics.js";

/* ---------- Missing values ---------- */

// Whole-cell tokens treated as missing (case-insensitive). A cell containing
// these as part of a larger string ("NASA", "n/a today") is NOT missing.
export const MISSING_TOKENS = new Set(["", "null", "n/a", "na", "?", "-", "—"]);

export function isMissing(value) {
  return MISSING_TOKENS.has(String(value).trim().toLowerCase());
}

/* ---------- Type inference ---------- */

const INT_RE = /^[+-]?\d+$/;
const FLOAT_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CODE_RE = /^[A-Za-z]{2,}[-_ ]\d{2,}$/; // "SO-1001", "S_1001", "ORD 2001"
const BOOL_VALUES = new Set(["true", "false", "yes", "no", "y", "n"]);

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
// Month names for parsing "01-Mar-2024" / "1 Mar 2024" values.
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function looksLikeDate(value) {
  return parseDate(value) !== null;
}

/**
 * Parse a value in one of the recognized date shapes into a UTC-midnight
 * Date, or null. One source of truth for date handling: type inference,
 * type-violation checks, and date filters all use this function.
 *
 * Recognized shapes: 2024-03-01 · 2024/03/01 · 03/01/2024 (mm/dd/yyyy) ·
 * 01-Mar-2024 · 1 Mar 2024.
 */
export function parseDate(value) {
  const v = String(value).trim();

  // yyyy-m-d or yyyy/m/d
  let m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/.exec(v);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));

  // d-Mon-yyyy or d Mon yyyy
  m = /^(\d{1,2})[- ]([A-Za-z]{3,})[- ](\d{4})$/.exec(v);
  if (m) {
    const month = MONTH_NAMES.indexOf(m[2].slice(0, 3).toLowerCase());
    return month >= 0 ? new Date(Date.UTC(+m[3], month, +m[1])) : null;
  }

  // mm/dd/yyyy
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));

  return null;
}

/**
 * Does a single value fit a column's inferred type?
 * Used by the quality engine to find type inconsistencies.
 * Categorical/string types accept any text by definition.
 */
export function matchesType(type, value) {
  const v = String(value).trim();
  switch (type) {
    case "integer": return INT_RE.test(v);
    case "float":
    case "number": return FLOAT_RE.test(v);
    case "boolean": return BOOL_VALUES.has(v.toLowerCase());
    case "date": return looksLikeDate(v);
    case "categorical":
    case "string":
    case "identifier":
    default: return true;
  }
}

/**
 * Infer one type for a column from its non-missing values.
 * A type wins only if ≥ 90% of values match it (conservative).
 * Identifier detection is deliberately protective: anything that looks
 * like an ID is excluded from numeric analysis downstream.
 */
export function inferType(values) {
  if (values.length === 0) return "empty";

  const n = values.length;
  const sample = n > 10000 ? values.slice(0, 10000) : values;

  let boolCount = 0;
  let intCount = 0;
  let floatCount = 0;
  let dateCount = 0;

  for (const raw of sample) {
    const v = String(raw).trim();
    if (BOOL_VALUES.has(v.toLowerCase())) boolCount++;
    if (INT_RE.test(v)) { intCount++; floatCount++; }
    else if (FLOAT_RE.test(v)) floatCount++;
    if (looksLikeDate(v)) dateCount++;
  }

  const uniqueCount = countUnique(sample);
  const uniqueRatio = uniqueCount / sample.length;

  // --- Identifier check (before numeric, so IDs never become numbers) ---
  const allStringsIntLike = sample.every((v) => INT_RE.test(String(v).trim()));
  const hasLeadingZeros = allStringsIntLike && sample.some((v) => /^0\d/.test(String(v).trim()));
  const sameLength = allStringsIntLike && new Set(sample.map((v) => String(v).trim().length)).size === 1;
  const allUuid = sample.every((v) => UUID_RE.test(String(v).trim()));
  const allCodes = sample.every((v) => CODE_RE.test(String(v).trim()));

  // 0.9 (not 0.95): a few legitimately repeated keys must not stop an ID column
  // from being recognized. Still conservative: generic numeric columns rarely
  // combine ~90% uniqueness with leading zeros / fixed length / code patterns.
  const identifierSuspicious =
    sample.length >= 5 &&
    uniqueRatio >= 0.9 &&
    (hasLeadingZeros || (sameLength && sample[0].trim().length >= 4) || allUuid || allCodes);

  if (identifierSuspicious) return "identifier";
  if (boolCount / sample.length >= 0.9) return "boolean";
  if (dateCount / sample.length >= 0.9) return "date";
  if (intCount / sample.length >= 0.9) return "integer";
  if (floatCount / sample.length >= 0.9) return "float";

  // Categorical: repeats a lot, small vocabulary.
  if (uniqueRatio <= 0.5 && uniqueCount <= 50) return "categorical";

  return "string";
}

/* ---------- Column profiles ---------- */

/**
 * Build the profile of one column.
 * Numeric stats are computed only for integer/float columns.
 * Identifier columns deliberately get NO numeric statistics.
 */
export function profileColumn(column, values) {
  const total = values.length;
  const present = values.filter((v) => !isMissing(v));
  const missing = total - present.length;
  const unique = countUnique(present);
  const type = inferType(present);

  const profile = {
    columnId: column.id,
    name: column.name,
    type,
    total,
    missing,
    missingPct: total > 0 ? (missing / total) * 100 : 0,
    unique,
    uniquePct: present.length > 0 ? (unique / present.length) * 100 : 0,
    isConstant: present.length > 0 && unique === 1,
    topValues: null,
    stats: null,
  };

  if (type === "integer" || type === "float") {
    const numbers = present.map((v) => parseNumber(v)).filter((v) => v !== null);
    if (numbers.length > 0) {
      const q1 = percentile(numbers, 0.25);
      const q3 = percentile(numbers, 0.75);
      profile.stats = {
        count: numbers.length,
        min: Math.min(...numbers),
        max: Math.max(...numbers),
        mean: mean(numbers),
        median: median(numbers),
        stdDev: stdDev(numbers),
        q1,
        q3,
        iqr: q3 - q1,
      };
    }
  } else {
    const freq = frequencies(present.map((v) => String(v)));
    const top = mode(present.map((v) => String(v)));
    profile.mode = top ? top.value : null;
    profile.topValues = freq.slice(0, 8);
  }

  return profile;
}

/* ---------- Dataset profile ---------- */

/**
 * Profile the whole dataset: per-column profiles plus dataset totals.
 * Duplicate rows are exact matches across all columns (first occurrence
 * is the original; every later copy counts as a duplicate).
 */
export function profileDataset(dataset) {
  const byColumn = {};
  let missingCells = 0;

  for (const column of dataset.columns) {
    const values = dataset.rows.map((row) => row[column.id] ?? "");
    const prof = profileColumn(column, values);
    byColumn[column.id] = prof;
    missingCells += prof.missing;
  }

  // Exact duplicate rows (streaming key comparison — no giant copies)
  const seenKeys = new Set();
  const duplicateRowNumbers = [];
  for (const row of dataset.rows) {
    const key = dataset.columns.map((c) => row[c.id] ?? "").join("\u0000");
    if (seenKeys.has(key)) {
      duplicateRowNumbers.push(row.__rowNum);
    } else {
      seenKeys.add(key);
    }
    // Bound memory/report size for very messy datasets
    if (duplicateRowNumbers.length >= 1000) break;
  }

  const typeCounts = {};
  for (const prof of Object.values(byColumn)) {
    typeCounts[prof.type] = (typeCounts[prof.type] ?? 0) + 1;
  }

  return {
    byColumn,
    rowCount: dataset.rowCount,
    columnCount: dataset.columns.length,
    totalCells: dataset.rowCount * dataset.columns.length,
    missingCells,
    duplicateRows: duplicateRowNumbers.length,
    duplicateRowNumbers,
    typeCounts,
  };
}

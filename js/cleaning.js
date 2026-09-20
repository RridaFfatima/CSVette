/* ============================================================
   CSVette — cleaning.js
   Pure cleaning operations. Every function takes a dataset and
   returns a NEW dataset (copy-on-write: rows that don't change are
   shared, rows that change are fresh objects) — the original and
   the previous working state are never mutated, which is also what
   makes snapshot-based undo reliable.

   Missing-value semantics come from data-profile.js's isMissing()
   — ONE definition of "missing" across quality, filters, charts,
   and cleaning. No separate cleaning-specific definition exists.
   ============================================================ */

import { isMissing, parseDate, matchesType } from "./data-profile.js";
import { parseNumber, mean, median, frequencies } from "./statistics.js";

/* ---------- Shared internals ---------- */

/** Shallow-clone the dataset shell; callers replace rows/columns. */
function cloneShell(dataset) {
  return {
    name: dataset.name,
    sizeBytes: dataset.sizeBytes,
    columns: [...dataset.columns],
    rows: dataset.rows, // replaced by the op
    rowCount: dataset.rowCount,
  };
}

/** The same duplicate-row definition the Data Quality engine uses. */
function duplicateKey(row, columns) {
  return columns.map((c) => row[c.id] ?? "").join("\u0000");
}

function summarize(op, label, detail, extra = {}) {
  return { op, label, detail, ...extra };
}

/* ---------- Preview helpers (counts BEFORE applying) ---------- */

/** How many exact duplicate rows exist (not counting first occurrences). */
export function countDuplicates(dataset) {
  const seen = new Set();
  let count = 0;
  for (const row of dataset.rows) {
    const key = duplicateKey(row, dataset.columns);
    if (seen.has(key)) count++;
    else seen.add(key);
  }
  return count;
}

/** Cells in a column whose value has leading/trailing whitespace. */
export function countTrimmable(dataset, columnId) {
  let count = 0;
  for (const row of dataset.rows) {
    const v = String(row[columnId] ?? "");
    if (v !== "" && v !== v.trim()) count++;
  }
  return count;
}

/** Rows in a column holding exactly `from` (trimmed, case-sensitive). */
export function countValueMatches(dataset, columnId, from) {
  let count = 0;
  for (const row of dataset.rows) {
    if (String(row[columnId] ?? "").trim() === from) count++;
  }
  return count;
}

/** Missing cells in a column, by the shared definition. */
export function countMissing(dataset, columnId) {
  let count = 0;
  for (const row of dataset.rows) {
    if (isMissing(row[columnId] ?? "")) count++;
  }
  return count;
}

/**
 * The value a fill strategy would write, or null if it can't be
 * computed (e.g. mean of a column with no usable numbers).
 * Integer columns get integer fill values (rounded) so filling does
 * not silently change the column's inferred type.
 */
export function computeFillValue(dataset, columnId, strategy, customValue) {
  const values = [];
  for (const row of dataset.rows) {
    const raw = row[columnId] ?? "";
    if (isMissing(raw)) continue;
    const n = parseNumber(raw);
    if (n !== null) values.push(n);
  }

  if (strategy === "custom") {
    return customValue;
  }
  if (strategy === "mode") {
    const freq = frequencies(
      dataset.rows.map((r) => String(r[columnId] ?? "").trim()).filter((v) => !isMissing(v)),
    );
    return freq.length > 0 ? freq[0].value : null;
  }
  if (values.length === 0) return null;
  if (strategy === "mean") {
    const m = mean(values);
    return allIntegers(values) ? String(Math.round(m)) : String(+m.toFixed(4));
  }
  if (strategy === "median") {
    const m = median(values);
    return allIntegers(values) ? String(Math.round(m)) : String(+m.toFixed(4));
  }
  return null;
}

function allIntegers(nums) {
  return nums.every((n) => Number.isInteger(n));
}

/** Which fill strategies the UI may offer for a column type. */
export function fillStrategiesFor(type) {
  if (type === "integer" || type === "float") return ["mean", "median", "custom"];
  if (type === "boolean") return ["mode", "custom"];
  return ["mode", "custom"]; // string / categorical / identifier / date
}

/* ---------- Custom-value validation (§8) ---------- */

/**
 * Validate a user-typed replacement/fill value against the inferred
 * column type. Returns null when valid, else a human explanation.
 * String columns accept arbitrary text; typed columns must not be
 * silently corrupted.
 */
export function customValueError(type, raw) {
  const v = String(raw ?? "");
  if (v.trim() === "") return "Enter a value — filling with empty would change nothing.";
  if (type === "integer" && !/^[+-]?\d+$/.test(v.trim())) {
    return `"${v}" is not a whole number, and this column is inferred as integer.`;
  }
  if (type === "float" && !/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(v.trim())) {
    return `"${v}" is not a number, and this column is inferred as numeric.`;
  }
  if (type === "boolean" && !matchesType("boolean", v)) {
    return `"${v}" is not a boolean — use values like true / false / yes / no.`;
  }
  if (type === "date" && parseDate(v) === null) {
    return `"${v}" is not a recognized date (shapes like 2024-03-01 or 01-Mar-2024).`;
  }
  return null;
}

/* ---------- Rename validation ---------- */

export function renameError(dataset, columnId, newName) {
  const name = String(newName ?? "").trim();
  if (name === "") return "The column name cannot be empty.";
  if (name.length > 80) return "Column names are limited to 80 characters.";
  const clash = dataset.columns.some(
    (c) => c.id !== columnId && c.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (clash) return `A column named "${name}" already exists — names must be unique.`;
  return null;
}

/* ---------- Operations ---------- */

/**
 * Remove exact duplicate rows (first occurrence kept).
 * Original row numbers are preserved on remaining rows so the rest
 * of the app stays consistent; removed numbers simply vanish.
 */
export function removeDuplicates(dataset) {
  const seen = new Set();
  const kept = [];
  const removedRowNums = [];
  for (const row of dataset.rows) {
    const key = duplicateKey(row, dataset.columns);
    if (seen.has(key)) {
      removedRowNums.push(row.__rowNum);
    } else {
      seen.add(key);
      kept.push(row);
    }
  }
  const next = cloneShell(dataset);
  next.rows = kept;
  next.rowCount = kept.length;
  return {
    dataset: next,
    summary: summarize(
      "remove-duplicates",
      `Removed ${removedRowNums.length} duplicate row${removedRowNums.length === 1 ? "" : "s"}`,
      `${removedRowNums.length} removed · ${kept.length} remain`,
      { removedRowNums, affected: removedRowNums.length },
    ),
  };
}

/**
 * Fill missing cells in one column. `strategy`: mean | median | mode |
 * custom (with `customValue`). Uses the shared isMissing definition.
 */
export function fillMissing(dataset, columnId, strategy, customValue = "") {
  const fill = computeFillValue(dataset, columnId, strategy, customValue);
  if (fill === null || String(fill).trim() === "") {
    return { error: "No usable fill value could be computed for this column." };
  }

  const fillStr = String(fill);
  let changed = 0;
  const rows = dataset.rows.map((row) => {
    if (!isMissing(row[columnId] ?? "")) return row;
    changed++;
    return { ...row, [columnId]: fillStr };
  });

  const next = cloneShell(dataset);
  next.rows = rows;
  next.rowCount = rows.length;
  const colName = dataset.columns.find((c) => c.id === columnId)?.name ?? columnId;
  return {
    dataset: next,
    summary: summarize(
      "fill-missing",
      `Filled ${changed} missing value${changed === 1 ? "" : "s"} in ${colName} using ${strategy === "custom" ? `custom value "${fillStr}"` : strategy}`,
      `${changed} cells set to "${fillStr}"`,
      { affected: changed, columnIds: [columnId] },
    ),
  };
}

/**
 * Trim leading/trailing whitespace in the given columns.
 * Whitespace-only cells become empty (still missing — honest).
 */
export function trimWhitespace(dataset, columnIds) {
  const idSet = new Set(columnIds);
  let changed = 0;
  const rows = dataset.rows.map((row) => {
    let rowChanged = false;
    const nextRow = { ...row };
    for (const id of idSet) {
      const v = String(row[id] ?? "");
      if (v !== "" && v !== v.trim()) {
        nextRow[id] = v.trim();
        rowChanged = true;
        changed++;
      }
    }
    return rowChanged ? nextRow : row;
  });

  const next = cloneShell(dataset);
  next.rows = rows;
  const cols = columnIds
    .map((id) => dataset.columns.find((c) => c.id === id)?.name ?? id)
    .join(", ");
  return {
    dataset: next,
    summary: summarize(
      "trim",
      `Trimmed whitespace in ${cols} — ${changed} cell${changed === 1 ? "" : "s"}`,
      `${changed} cells cleaned`,
      { affected: changed, columnIds: [...idSet] },
    ),
  };
}

/** Title case: first letter of each whitespace-separated word. */
function toTitleCase(v) {
  return v.replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

/**
 * Normalize text case in one column. `mode`: lower | upper | title.
 * Only cells whose value actually changes are rewritten.
 */
export function normalizeCase(dataset, columnId, mode) {
  const transform = mode === "lower" ? (v) => v.toLowerCase()
    : mode === "upper" ? (v) => v.toUpperCase()
    : toTitleCase;
  if (!["lower", "upper", "title"].includes(mode)) {
    return { error: `Unknown case mode "${mode}".` };
  }

  let changed = 0;
  const rows = dataset.rows.map((row) => {
    const v = String(row[columnId] ?? "");
    if (isMissing(v)) return row;
    const t = transform(v);
    if (t === v) return row;
    changed++;
    return { ...row, [columnId]: t };
  });

  const next = cloneShell(dataset);
  next.rows = rows;
  const colName = dataset.columns.find((c) => c.id === columnId)?.name ?? columnId;
  const modeLabel = mode === "lower" ? "lowercase" : mode === "upper" ? "uppercase" : "title case";
  return {
    dataset: next,
    summary: summarize(
      "normalize-case",
      `Normalized ${colName} to ${modeLabel} — ${changed} cell${changed === 1 ? "" : "s"}`,
      `${changed} cells changed`,
      { affected: changed, columnIds: [columnId] },
    ),
  };
}

/**
 * Replace one exact value with another in one column.
 * Matching is on the trimmed cell (the way values are displayed and
 * quality-checked); the replacement is written as given.
 */
export function replaceValue(dataset, columnId, from, to) {
  const fromStr = String(from ?? "").trim();
  if (fromStr === "") return { error: "Choose a value to replace." };
  const toStr = String(to ?? "");
  if (fromStr === toStr.trim()) {
    return { error: "The new value is the same as the old value." };
  }

  let changed = 0;
  const rows = dataset.rows.map((row) => {
    if (String(row[columnId] ?? "").trim() !== fromStr) return row;
    changed++;
    return { ...row, [columnId]: toStr };
  });

  const next = cloneShell(dataset);
  next.rows = rows;
  const colName = dataset.columns.find((c) => c.id === columnId)?.name ?? columnId;
  return {
    dataset: next,
    summary: summarize(
      "replace-value",
      `Replaced "${fromStr}" with "${toStr}" in ${colName} — ${changed} row${changed === 1 ? "" : "s"}`,
      `${changed} rows changed`,
      { affected: changed, columnIds: [columnId] },
    ),
  };
}

/**
 * Rename a column. The internal column id stays STABLE on purpose:
 * filters, chart configs, and deep links reference ids, so a rename
 * never orphans them — only the display name changes.
 */
export function renameColumn(dataset, columnId, newName) {
  const err = renameError(dataset, columnId, newName);
  if (err) return { error: err };
  const name = String(newName).trim();
  const oldName = dataset.columns.find((c) => c.id === columnId)?.name ?? columnId;
  if (oldName === name) {
    return { error: "That is already the column's name." };
  }

  const next = cloneShell(dataset);
  next.columns = dataset.columns.map((c) => (c.id === columnId ? { ...c, name } : c));
  // Rows are keyed by id — unchanged, and safely shared.
  return {
    dataset: next,
    summary: summarize(
      "rename-column",
      `Renamed ${oldName} → ${name}`,
      "Column renamed",
      { columnIds: [columnId] },
    ),
  };
}

/** Delete a column entirely (working dataset only). */
export function deleteColumn(dataset, columnId) {
  if (!dataset.columns.some((c) => c.id === columnId)) {
    return { error: "That column no longer exists." };
  }
  const colName = dataset.columns.find((c) => c.id === columnId)?.name ?? columnId;

  const next = cloneShell(dataset);
  next.columns = dataset.columns.filter((c) => c.id !== columnId);
  next.rows = dataset.rows.map((row) => {
    const clone = { ...row };
    delete clone[columnId];
    return clone;
  });

  return {
    dataset: next,
    summary: summarize(
      "delete-column",
      `Deleted column ${colName}`,
      `${dataset.rows.length} rows × ${next.columns.length} columns remain`,
      { columnIds: [columnId] },
    ),
  };
}

/**
 * Delete rows by original row number (the Data Table's selection).
 * Unknown numbers are ignored so stale selections can't misfire.
 */
export function deleteRows(dataset, rowNums) {
  const targets = new Set(rowNums);
  if (targets.size === 0) return { error: "No rows are selected." };

  const kept = [];
  const removed = [];
  for (const row of dataset.rows) {
    if (targets.has(row.__rowNum)) removed.push(row.__rowNum);
    else kept.push(row);
  }
  if (removed.length === 0) {
    return { error: "None of the selected rows exist in the current dataset." };
  }

  const next = cloneShell(dataset);
  next.rows = kept;
  next.rowCount = kept.length;
  return {
    dataset: next,
    summary: summarize(
      "delete-rows",
      `Deleted ${removed.length} row${removed.length === 1 ? "" : "s"} (rows ${removed.slice(0, 5).join(", ")}${removed.length > 5 ? "…" : ""})`,
      `${removed.length} removed · ${kept.length} remain`,
      { removedRowNums: removed, affected: removed.length },
    ),
  };
}

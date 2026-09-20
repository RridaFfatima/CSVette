/* ============================================================
   CSVette — csv-export.js
   Pure CSV serialization + safe filenames + export variants.
   No DOM here: everything is string-in/string-out so it can be
   unit-tested in Node. The download step (Blob → object URL →
   click → revoke) lives in views/export.js.

   FORMULA INJECTION POLICY (§9):
   CSVette preserves cell values EXACTLY. Values beginning with
   = + - @ are exported verbatim, never prefixed with ' or =.
   Rationale: prefixing silently corrupts data (a "-5" becomes
   "'-5" forever), while preserving is honest — CSV files cannot
   execute anything by themselves; evaluation only happens if a
   user deliberately opens the file in a spreadsheet and confirms
   its import prompts. This matches CSVette's core rule: never
   alter user data silently. The Export screen states this in
   plain language so the choice is visible, not hidden.
   ============================================================ */

import { computeView } from "./data-filter.js";

/** Serialize one field per RFC 4180: quote when needed, double embedded quotes. */
export function csvField(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Quote if the value contains a quote, comma, CR/LF — or has
  // leading/trailing spaces we must preserve exactly (§8).
  if (/["\,\r\n]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Serialize columns + rows to a CSV string (CRLF line endings per RFC 4180).
 * A UTF-8 BOM is prepended so spreadsheets detect Unicode correctly;
 * it marks the file encoding and is not part of any cell value.
 *
 * @param {Array<{id: string, name: string}>} columns
 * @param {Array<object>} rows - row objects keyed by column id
 * @returns {string}
 */
export function serializeCsv(columns, rows) {
  const lines = [];
  lines.push(columns.map((c) => csvField(c.name)).join(","));
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(row[c.id])).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/**
 * A safe, deterministic download filename: strips path separators,
 * filesystem-unsafe characters, control chars, and trailing dots/spaces,
 * and caps the length. Unicode letters are preserved (they are legal).
 * @param {string} base - dataset file name, e.g. "sales.csv"
 * @param {string} suffix - e.g. "original" | "working" | "filtered"
 * @param {string} ext - "csv" | "html"
 */
export function safeFilename(base, suffix, ext) {
  const BOM = "\uFEFF";
  let stem = String(base ?? "dataset");
  stem = stem.replace(BOM, "");
  stem = stem.replace(/\.[^.]*$/, ""); // drop the original extension
  stem = stem.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-"); // unsafe chars
  stem = stem.replace(/\s+/g, " ").trim();
  stem = stem.replace(/[. ]+$/g, ""); // Windows: no trailing dots/spaces
  if (stem === "") stem = "dataset";
  if (stem.length > 80) stem = stem.slice(0, 80).trimEnd().replace(/[. ]+$/g, "");
  return `${stem}_${suffix}.${ext}`;
}

/** Export the original or working dataset as-is (no filters, no sorting). */
export function buildDatasetCsv(dataset) {
  return {
    text: serializeCsv(dataset.columns, dataset.rows),
    rowCount: dataset.rowCount,
    columnCount: dataset.columns.length,
  };
}

/**
 * Export the current filtered explorer view. Uses the SAME pipeline as the
 * Data Table (computeView: search → filters → sort), but ignores pagination
 * — every matching row is included. Sorting only affects row order, never
 * membership, so it cannot distort the export.
 *
 * @param {object} working - working dataset
 * @param {object} profile - profileDataset(working) result
 * @param {object} explorer - the explorer state singleton from data-filter.js
 */
export function buildFilteredCsv(working, profile) {
  // computeView applies search → filters → sort (the Data Table's own
  // pipeline). Pagination lives in the view layer, NOT in computeView, so
  // every matching row is exported regardless of the current page.
  const { rows } = computeView(working, profile);
  return {
    text: serializeCsv(working.columns, rows),
    rowCount: rows.length,
    columnCount: working.columns.length,
  };
}

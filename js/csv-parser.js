/* ============================================================
   CSVette — csv-parser.js
   File validation + Papa Parse wrapper + normalization.

   Papa Parse is loaded as a classic script in index.html (window.Papa).
   dynamicTyping is intentionally OFF: "00123" must stay "00123" —
   types are inferred conservatively in data-profile.js instead.
   ============================================================ */

/** Soft limit (warn but allow) and hard limit (refuse), in bytes. */
export const SIZE_LIMITS = {
  warn: 50 * 1024 * 1024,   // ~50 MB
  hard: 150 * 1024 * 1024,  // ~150 MB
};

const CSV_EXTENSIONS = [".csv", ".tsv", ".txt"];

/**
 * Pre-parse file validation.
 * @returns {{ ok: boolean, level: "error"|"warn", message: string } | { ok: true }}
 */
export function validateFile(file) {
  const name = file.name || "file";
  const lower = name.toLowerCase();
  const looksLikeCsv = CSV_EXTENSIONS.some((ext) => lower.endsWith(ext));

  if (!looksLikeCsv && file.type && !/csv|text|spreadsheet/i.test(file.type)) {
    return {
      ok: false,
      level: "error",
      message: `"${name}" doesn't look like a CSV file. Supported: .csv, .tsv, .txt`,
    };
  }

  if (file.size > SIZE_LIMITS.hard) {
    return {
      ok: false,
      level: "error",
      message: `"${name}" is ${formatBytes(file.size)} — larger than CSVette's current ${formatBytes(SIZE_LIMITS.hard)} limit. Try splitting the file or removing unneeded columns.`,
    };
  }

  if (file.size > SIZE_LIMITS.warn) {
    return {
      ok: true,
      level: "warn",
      message: `"${name}" is ${formatBytes(file.size)} — large files may take a moment to process.`,
    };
  }

  return { ok: true };
}

/** Parse CSV text/file via Papa Parse (Promise wrapper). */
export function parseCsv(source, { onProgress = null } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof window.Papa === "undefined") {
      reject(new Error("CSV parser failed to load. Check your connection and reload the page."));
      return;
    }

    window.Papa.parse(source, {
      header: true,
      skipEmptyLines: "greedy",
      dynamicTyping: false,
      transformHeader: (h) => h.trim(),
      download: false,
      worker: false,
      chunk: undefined,
      complete: (results) => resolve(results),
      error: (error) => reject(error),
    });

    // Papa reports progress for File sources only.
    if (onProgress && source instanceof File) {
      window.Papa.parse && onProgress(0); // start state; Papa streams chunk progress in v5 builds
    }
  });
}

/**
 * Normalize Papa's results into CSVette's Dataset shape.
 * - de-duplicates header names (name, name_2, …)
 * - keeps each row's original 1-based row number (file line, headers excluded)
 * - reports structural problems without throwing
 */
export function normalizeDataset(papaResults, fileName, fileSize = 0) {
  const errors = papaResults.errors || [];
  const rawFields = papaResults.meta?.fields ?? [];

  // Header checks
  const headers = rawFields.filter((h) => h !== "" && h !== null && h !== undefined);
  const headerOnly = headers.length > 0 && papaResults.data.length === 0;
  const unnamedColumns = rawFields.filter((h) => h === "" || h === "__parsed_extra").length;

  // De-duplicate header names
  const seen = new Map();
  const columns = headers.map((h) => {
    const clean = String(h).trim();
    const count = (seen.get(clean) ?? 0) + 1;
    seen.set(clean, count);
    return { id: count === 1 ? clean : `${clean}_${count}`, name: clean };
  });

  // Rows: objects keyed by column id, preserving original row numbers.
  // NOTE: with header:true Papa returns data as OBJECTS keyed by the raw
  // header text (not arrays), so cells are read by original header name.
  const rows = [];
  const fileLineBase = 1; // line 1 is the header
  papaResults.data.forEach((record, i) => {
    const row = {};
    columns.forEach((col, c) => {
      const originalHeader = headers[c];
      let raw = record[originalHeader];
      if (raw === undefined && record.__parsed_extra && record.__parsed_extra[c] !== undefined) {
        raw = record.__parsed_extra[c]; // fields beyond the header row
      }
      row[col.id] = raw === null || raw === undefined ? "" : String(raw);
    });
    rows.push({ __rowNum: fileLineBase + i + 1, ...row });
  });

  // Ragged-row accounting: Papa pads/trims extra fields into "__parsed_extra"
  const raggedRows = errors.filter((e) => e.code === "TooFewFields" || e.code === "TooManyFields" || e.type === "FieldMismatch");
  const otherErrors = errors.filter((e) => !raggedRows.includes(e));

  const dataset = {
    name: fileName,
    sizeBytes: fileSize,
    columns,
    rows,
    rowCount: rows.length,
  };

  const warnings = [];
  if (headerOnly) warnings.push("This file has a header row but no data rows.");
  if (unnamedColumns > 0) warnings.push(`${unnamedColumns} column(s) have no header name and may be misaligned.`);
  if (raggedRows.length > 0) warnings.push(`${raggedRows.length} row(s) had more/fewer fields than the header — extra or missing cells were treated as empty.`);
  for (const e of otherErrors.slice(0, 3)) {
    warnings.push(e.message || "A parsing issue was found and worked around.");
  }

  return { dataset, warnings };
}

/** Human-readable byte size. */
export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

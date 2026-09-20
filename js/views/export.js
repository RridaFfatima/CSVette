/* ============================================================
   CSVette — views/export.js
   The two Export screens (Milestone 7): "export-csv" and "report".

   §3/§28: the three dataset states (original / working / filtered
   view) are always labeled with their actual row counts — the UI
   makes it impossible to confuse them. Downloads are pure
   client-side: Blob → object URL → click → revoke (§10). Nothing
   is cached (§29): every render and every click reads current state.
   ============================================================ */

import { el } from "../dom.js";
import { getState } from "../state.js";
import { explorer } from "../data-filter.js";
import { buildDatasetCsv, buildFilteredCsv, safeFilename } from "../csv-export.js";
import { buildQualityReportHtml } from "../report.js";

/* ---------- download helper (§10) ---------- */

/**
 * Trigger a client-side download. Returns { ok } or { ok: false, error }.
 * Feedback is only shown after click() has actually been called (§11).
 */
function downloadText(filename, text, mime) {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message ?? "Download failed." };
  }
}

/* ---------- shared pieces ---------- */

function screenHeader(container, title, subtitle) {
  container.append(
    el("h1", { class: "screen-title", text: title }),
    el("p", { class: "screen-subtitle muted", text: subtitle }),
  );
}

function feedback(container, text, isError = false) {
  const line = el("p", { class: "clean-feedback", role: "status" });
  line.append(el("span", { class: `chip chip-flag ${isError ? "chip-error" : ""}`, text: isError ? "Problem" : "Done" }));
  line.append(document.createTextNode(` ${text}`));
  container.append(line);
}

function exportCard({ overline, title, description, countLine, buttonLabel, onClick, disabled, disabledReason }) {
  const card = el("section", { class: "export-option card" });
  card.append(
    el("p", { class: "overline muted", text: overline }),
    el("h2", { class: "export-option-title", text: title }),
    el("p", { class: "muted", text: description }),
  );
  const count = el("p", { class: "export-count mono", text: countLine });
  card.append(count);
  const btn = el("button", { class: "btn btn-primary", type: "button", text: buttonLabel });
  if (disabled) {
    btn.disabled = true;
    card.append(el("p", { class: "caption muted", text: disabledReason ?? "" }));
  } else {
    btn.addEventListener("click", onClick);
  }
  card.append(btn);
  return card;
}

/* ---------- CSV export screen (§4–§12) ---------- */

export function renderExportCsv(container) {
  const s = getState();
  const working = s.dataset.working;
  container.replaceChildren();

  screenHeader(container, "Export CSV",
    "Downloads are generated in your browser — nothing is uploaded anywhere.");

  if (!working) {
    container.append(el("p", { class: "muted", text: "No dataset is loaded." }));
    return;
  }

  const name = s.dataset.fileName ?? "dataset";
  const zeroRows = working.rowCount === 0;

  /* — Original — */
  container.append(exportCard({
    overline: "Dataset state: original",
    title: "Original dataset",
    description: "The CSV exactly as uploaded — no cleaning, no filters, no sorting.",
    countLine: `${s.dataset.original.rowCount} rows × ${s.dataset.original.columns.length} columns`,
    buttonLabel: "Export original CSV",
    onClick: () => {
      const exp = buildDatasetCsv(s.dataset.original);
      const file = safeFilename(name, "original", "csv");
      const res = downloadText(file, exp.text, "text/csv;charset=utf-8");
      if (res.ok) feedback(container, `Original dataset exported — ${exp.rowCount} rows × ${exp.columnCount} columns.`);
      else feedback(container, `Export failed: ${res.error}`, true);
    },
  }));

  /* — Working — */
  container.append(exportCard({
    overline: "Dataset state: working",
    title: "Working dataset",
    description: "The current dataset with all cleaning applied — renamed columns, filled values, removed rows.",
    countLine: `${working.rowCount} rows × ${working.columns.length} columns`,
    buttonLabel: "Export working CSV",
    disabled: zeroRows,
    disabledReason: "The working dataset has no rows to export.",
    onClick: () => {
      const exp = buildDatasetCsv(working);
      const file = safeFilename(name, "working", "csv");
      const res = downloadText(file, exp.text, "text/csv;charset=utf-8");
      if (res.ok) feedback(container, `Working dataset exported — ${exp.rowCount} rows × ${exp.columnCount} columns.`);
      else feedback(container, `Export failed: ${res.error}`, true);
    },
  }));

  /* — Filtered view — */
  const hasFilter = explorer.filters.length > 0 || explorer.search.trim() !== "";
  const filteredCount = zeroRows ? 0 : buildFilteredCsv(working, s.profile).rowCount;
  const emptyFiltered = hasFilter && filteredCount === 0;

  const filteredCard = exportCard({
    overline: "Dataset state: filtered view",
    title: "Current filtered view",
    description: hasFilter
      ? "Rows matching the active search and filters — every match, not just the visible page."
      : "No filters are active. This export contains all working rows.",
    countLine: hasFilter
      ? `${filteredCount} of ${working.rowCount} rows match`
      : `${filteredCount} rows × ${working.columns.length} columns`,
    buttonLabel: hasFilter ? `Export filtered CSV (${filteredCount} rows)` : "Export all working rows",
    disabled: zeroRows || emptyFiltered,
    disabledReason: emptyFiltered ? "There are no rows matching the current filters." : undefined,
    onClick: () => {
      const exp = buildFilteredCsv(working, s.profile);
      const file = safeFilename(name, "filtered", "csv");
      const res = downloadText(file, exp.text, "text/csv;charset=utf-8");
      if (res.ok) feedback(container, `Filtered dataset exported — ${exp.rowCount} rows × ${exp.columnCount} columns.`);
      else feedback(container, `Export failed: ${res.error}`, true);
    },
  });
  if (emptyFiltered) {
    filteredCard.append(el("button", {
      class: "btn btn-secondary btn-sm", type: "button", text: "Clear filters",
      onclick: () => {
        explorer.filters = [];
        explorer.search = "";
        explorer.pageIndex = 0;
        renderExportCsv(container);
      },
    }));
  }
  container.append(filteredCard);

  /* — Safety policy (§9): stated, not hidden — */
  container.append(el("p", {
    class: "caption muted export-policy",
    text: "Values are exported exactly as they appear — CSVette never prefixes =, +, - or @ values, " +
      "and never evaluates them. A CSV file is plain text; treat unknown files with care before opening them in a spreadsheet.",
  }));
}

/* ---------- Data Quality Report screen (§13–§26) ---------- */

export function renderReport(container) {
  const s = getState();
  const working = s.dataset.working;
  container.replaceChildren();

  screenHeader(container, "Data Quality Report",
    "A standalone HTML document describing the current working dataset — works offline, prints well, and contains no dataset rows.");

  if (!working || !s.profile || !s.quality || !s.health) {
    container.append(el("p", { class: "muted", text: "No analyzed dataset is loaded." }));
    return;
  }

  const ops = s.history?.length ?? 0;
  const card = el("section", { class: "export-option card" });
  card.append(
    el("p", { class: "overline muted", text: "Report contents" }),
    el("p", { class: "muted", text: "Dataset summary · overall quality score and dimensions · all six finding categories (each shown even when clear) · column profile · before/after comparison · cleaning history." }),
  );
  card.append(el("p", {
    class: "export-count mono",
    text: `${working.rowCount} rows × ${working.columns.length} columns · ${ops} cleaning operation${ops === 1 ? "" : "s"}`,
  }));
  card.append(el("p", {
    class: "caption muted",
    text: ops === 0
      ? "The working dataset currently matches the original upload."
      : "The report describes the cleaned working dataset; the original upload stays unchanged in CSVette.",
  }));

  const generate = el("button", { class: "btn btn-primary", type: "button", text: "Generate HTML report" });
  const preview = el("button", { class: "btn btn-secondary", type: "button", text: "Preview in browser" });

  /** Build the report from ONE consistent snapshot of current state (§26). */
  const buildHtml = () => buildQualityReportHtml({
    fileName: s.dataset.fileName ?? "dataset",
    original: s.dataset.original,
    working,
    profile: s.profile,
    quality: s.quality,
    health: s.health,
    history: s.history ?? [],
    generatedAt: new Date(),
  });

  const run = (openInline) => {
    let html;
    try {
      html = buildHtml();
    } catch (err) {
      feedback(container, `Report generation failed: ${err?.message ?? "unknown error"}`, true);
      return;
    }
    const file = safeFilename(s.dataset.fileName ?? "dataset", "data_quality_report", "html");
    if (openInline) {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      if (win) {
        feedback(container, `Report preview opened — it is also downloadable as ${file}.`);
      } else {
        // Popup blocked: fall back to a normal download so the user still
        // gets the artifact instead of a silent nothing.
        const res = downloadText(file, html, "text/html;charset=utf-8");
        if (res.ok) feedback(container, `Pop-up blocked — the report was downloaded as ${file} instead.`);
        else feedback(container, `Could not open a preview: ${res.error}`, true);
      }
      return;
    }
    const res = downloadText(file, html, "text/html;charset=utf-8");
    if (res.ok) feedback(container, `Report generated — ${file} (${working.rowCount} rows × ${working.columns.length} columns).`);
    else feedback(container, `Report generation failed: ${res.error}`, true);
  };

  generate.addEventListener("click", () => run(false));
  preview.addEventListener("click", () => run(true));
  card.append(el("div", { class: "export-actions" }, [generate, preview]));
  container.append(card);

  container.append(el("p", {
    class: "caption muted export-policy",
    text: "All dataset values are embedded as escaped text — a value like <script> can never execute inside the report.",
  }));
}

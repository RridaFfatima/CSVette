/* ============================================================
   CSVette — views/clean.js
   The Clean Data workspace (and the History screen via the
   historyOnly option). Cleaning is non-destructive: operations
   produce a NEW working dataset through app.js's applyCleaning,
   the original stays frozen, and every panel shows a live
   preview before anything is applied.

   This module owns NO cleaning logic — all counts and
   transformations come from ../cleaning.js.
   ============================================================ */

import { el, confirmButton } from "../dom.js";
import { getState } from "../state.js";
import {
  countDuplicates, countTrimmable, countValueMatches, countMissing,
  computeFillValue, customValueError, renameError, fillStrategiesFor,
  removeDuplicates, fillMissing, trimWhitespace, normalizeCase,
  replaceValue, renameColumn, deleteColumn,
} from "../cleaning.js";
import { frequencies } from "../statistics.js";

/* ---------- Hooks injected by app.js ---------- */

let hooks = null; // { apply(opFn, args), undo(), reset() }

/** app.js calls this once at boot. */
export function setCleanHooks(h) {
  hooks = h;
}

/** The table's delete-selected flow uses the same orchestrator. */
export function getCleanHooks() {
  return hooks;
}

/* ---------- Screen entry ---------- */

export function renderClean(container, opts = {}) {
  const s = getState();
  const working = s.dataset.working;
  const original = s.dataset.original;
  const history = s.history ?? [];

  container.replaceChildren();

  if (opts.historyOnly) {
    container.append(
      el("h1", { class: "screen-title", text: "History" }),
      el("p", {
        class: "screen-subtitle muted",
        text: "Every successful cleaning operation this session, newest first. Undo restores the dataset exactly as it was before the last operation; Reset restores the original file.",
      }),
    );
    renderHistorySection(container, { fullPage: true, rerender: (opts) => renderClean(container, { historyOnly: true, ...opts }) });
    return;
  }

  /* ---------- Header ---------- */
  container.append(
    el("h1", { class: "screen-title", text: "Clean Data" }),
    el("p", {
      class: "screen-subtitle muted",
      text: "Every operation works on a working copy — the original file stays untouched, and each change can be undone.",
    }),
  );

  /* ---------- Dataset state: where am I? ---------- */
  const changes = history.length;
  const stateGrid = el("div", { class: "clean-state-grid" });
  for (const [k, v] of [
    ["Dataset", s.dataset.fileName ?? "—"],
    ["Original", `${original.rowCount} rows × ${original.columns.length} cols`],
    ["Working", `${working.rowCount} rows × ${working.columns.length} cols`],
    ["Changes", String(changes)],
  ]) {
    stateGrid.append(
      el("div", { class: "clean-state-item" }, [
        el("span", { class: "overline muted", text: k }),
        el("span", { class: "clean-state-value mono", text: v }),
      ]),
    );
  }
  const stateCard = el("section", { class: "clean-state card", "aria-label": "Dataset state" });
  stateCard.append(stateGrid);

  const differs = changes > 0
    || working.rowCount !== original.rowCount
    || working.columns.length !== original.columns.length;
  stateCard.append(el("p", {
    class: "clean-state-note caption",
    text: differs
      ? "The working dataset differs from the original. History below lists every change; Reset restores the original."
      : "The working dataset matches the original — no changes have been applied yet.",
  }));
  container.append(stateCard);

  /* ---------- Feedback banner for the last action ---------- */
  if (opts.error || opts.justApplied) {
    const feedback = el("p", { class: "clean-feedback", role: "status" });
    feedback.append(el("span", { class: "chip chip-flag", text: opts.error ? "Not applied" : "Applied" }));
    feedback.append(document.createTextNode(` ${opts.error ?? opts.justApplied}`));
    container.append(feedback);
  }

  /* ---------- History + undo + reset ---------- */
  renderHistorySection(container, { rerender: (opts) => renderClean(container, opts) });

  /* ---------- Operations ---------- */
  const ops = el("section", { class: "clean-ops", "aria-label": "Cleaning operations" });
  ops.append(el("h2", { class: "section-title", text: "Operations" }));
  buildDuplicatesPanel(ops, container);
  buildFillPanel(ops, container);
  buildTrimPanel(ops, container);
  buildCasePanel(ops, container);
  buildReplacePanel(ops, container);
  buildRenamePanel(ops, container);
  buildDeleteColumnPanel(ops, container);
  container.append(ops);
}

/* ---------- History section (§16, §17, §18) ---------- */

function renderHistorySection(container, { fullPage = false, rerender } = {}) {
  const history = getState().history ?? [];

  const section = el("section", { class: "clean-history-section", "aria-label": "Operation history" });
  section.append(el("h2", { class: "section-title", text: fullPage ? "All operations" : "History" }));

  if (history.length === 0) {
    section.append(el("p", {
      class: "caption muted",
      text: "No cleaning operations yet. Successful operations appear here; previews and cancellations never do.",
    }));
    container.append(section);
    return;
  }

  const list = el("ol", { class: "clean-history" });
  [...history].reverse().forEach((entry, i) => {
    list.append(el("li", { class: "clean-history-item" }, [
      el("span", { class: "clean-history-num mono", text: `#${history.length - i}` }),
      el("span", { class: "clean-history-label", text: entry.label }),
      el("span", { class: "clean-history-detail caption muted", text: entry.detail }),
      el("span", { class: "clean-history-time caption muted mono", text: timeAgo(entry.time) }),
    ]));
  });
  section.append(list);

  const last = history[history.length - 1];
  const actions = el("div", { class: "clean-history-actions" });
  actions.append(
    el("button", {
      class: "btn btn-secondary btn-sm",
      type: "button",
      text: `Undo: ${last.label}`,
      "aria-label": `Undo the last operation: ${last.label}`,
      onclick: () => {
        const res = hooks.undo();
        if (res.ok) rerender({ justApplied: `Undone — ${res.removedLabel}. The dataset is back to the state before it.` });
        else rerender({ error: res.error });
      },
    }),
    confirmButton({
      label: "Reset all changes",
      confirmLabel: "Confirm reset",
      onConfirm: () => {
        const res = hooks.reset();
        if (res.ok) rerender({ justApplied: "All changes discarded — the working dataset is the original again." });
        else rerender({ error: res.error });
      },
    }),
  );
  section.append(actions);
  container.append(section);
}

/** Relative time for history entries, minute resolution is plenty. */
function timeAgo(date) {
  const sec = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/* ---------- Shared panel scaffold (§15: preview before apply) ---------- */

/**
 * One collapsible operation panel. `build` supplies the controls, a
 * live preview line, an optional validation error, and the apply
 * action. The Apply button stays disabled until the preview has
 * something honest to say and no validation error exists.
 */
function opPanel(container, { title, description, applyLabel = "Apply", danger = false, controls, preview, canApply, onApply }) {
  const details = el("details", { class: "clean-op card" });
  const summary = el("summary", { class: "clean-op-summary" });
  summary.append(
    el("span", { class: "clean-op-title", text: title }),
    el("span", { class: "clean-op-desc caption muted", text: description }),
    el("span", { class: "clean-op-chevron", "aria-hidden": "true", text: "▸" }),
  );

  const body = el("div", { class: "clean-op-body" });
  const previewLine = el("p", { class: "clean-op-preview caption", hidden: true });
  const errorLine = el("p", { class: "clean-op-error caption", role: "alert", hidden: true });

  const applyBtn = el("button", { class: `btn btn-sm ${danger ? "btn-danger" : "btn-primary"}`, type: "button", text: applyLabel });
  const cancelBtn = el("button", {
    class: "btn btn-secondary btn-sm", type: "button", text: "Cancel",
    onclick: () => { details.open = false; },
  });
  applyBtn.addEventListener("click", () => onApply(ui));

  const ui = {
    applyBtn, errorLine, previewLine,
    refresh() {
      const err = canApply ? canApply(ui) : null;
      errorLine.hidden = !err;
      errorLine.textContent = err ?? "";
      const pt = preview ? preview(ui) : null;
      // A string preview enables Apply; { text, blocked: true } shows an
      // all-clear/nothing-to-do message and keeps Apply disabled (§5).
      const text = pt === null ? null : typeof pt === "string" ? pt : pt.text;
      previewLine.hidden = !text;
      previewLine.textContent = text ?? "";
      applyBtn.disabled = !!err || text === null || (pt && typeof pt === "object" && pt.blocked === true);
    },
    showError(msg) {
      errorLine.hidden = false;
      errorLine.textContent = msg;
    },
  };

  body.append(...(controls(ui) ?? []), previewLine, errorLine, el("div", { class: "clean-op-actions" }, [applyBtn, cancelBtn]));
  details.append(summary, body);
  details.addEventListener("toggle", () => { if (details.open) ui.refresh(); });
  container.append(details);
  return ui;
}

/** Run an operation through app.js; show the outcome on this screen. */
function runOp(screen, ui, opFn, args) {
  const res = hooks.apply(opFn, args);
  if (!res.ok) {
    ui?.showError(res.error);
    return;
  }
  renderClean(screen, { justApplied: `${res.summary.label}. Analysis, Data Health, and the sidebar have been recalculated.` });
}

/* ---------- §5 Remove duplicate rows ---------- */

function buildDuplicatesPanel(container, screen) {
  opPanel(container, {
    title: "Remove duplicate rows",
    description: "Exact duplicates only — every column equal. The first occurrence is kept.",
    applyLabel: "Remove duplicates",
    controls: () => [
      el("p", { class: "caption muted", text: "Uses exactly the same definition as the Duplicates screen in Data Health." }),
    ],
    preview: () => {
      const n = countDuplicates(getState().dataset.working);
      if (n === 0) {
        return { text: "No duplicate rows found — this dataset has nothing to remove here.", blocked: true };
      }
      return `Before: ${getState().dataset.working.rowCount} rows · duplicates: ${n} · after: ${getState().dataset.working.rowCount - n} rows`;
    },
    onApply: () => runOp(screen, null, removeDuplicates, []),
  });
}

/* ---------- §6–§8 Fill missing values ---------- */

const STRATEGY_LABELS = { mean: "Mean (average)", median: "Median (middle value)", mode: "Most frequent value", custom: "Custom value…" };

function buildFillPanel(container, screen) {
  const columnsWithMissing = () =>
    getState().dataset.working.columns
      .map((c) => ({ col: c, type: getState().profile.byColumn[c.id]?.type ?? "string", n: countMissing(getState().dataset.working, c.id) }))
      .filter((x) => x.n > 0);

  opPanel(container, {
    title: "Fill missing values",
    description: "Replace empty / N/A / NULL / ? cells in one column. Nothing is filled until you apply.",
    controls: (ui) => {
      const colSel = el("select", { class: "clean-input", "aria-label": "Column with missing values" });
      const stratSel = el("select", { class: "clean-input", "aria-label": "Fill strategy" });
      const customInput = el("input", { class: "clean-input", type: "text", placeholder: "Custom value", "aria-label": "Custom fill value" });
      const customField = el("div", { class: "builder-field" }, [
        el("label", { class: "field-label", text: "Custom value" }), customInput,
      ]);

      const fillColumns = () => {
        colSel.replaceChildren();
        const cols = columnsWithMissing();
        if (cols.length === 0) {
          colSel.append(el("option", { value: "", text: "No columns have missing values" }));
          return;
        }
        for (const { col, type, n } of cols) {
          colSel.append(el("option", { value: col.id, text: `${col.name} — ${n} missing (${type})` }));
        }
      };
      const fillStrategies = () => {
        const type = columnsWithMissing().find((x) => x.col.id === colSel.value)?.type ?? "string";
        stratSel.replaceChildren();
        for (const s of fillStrategiesFor(type)) {
          stratSel.append(el("option", { value: s, text: STRATEGY_LABELS[s] ?? s }));
        }
        customField.hidden = stratSel.value !== "custom";
      };

      colSel.addEventListener("change", () => { fillStrategies(); ui.refresh(); });
      stratSel.addEventListener("change", () => { customField.hidden = stratSel.value !== "custom"; ui.refresh(); });
      customInput.addEventListener("input", () => ui.refresh());
      // Panel content is rebuilt on every screen render; expose the current
      // selections to the preview/apply closures via the select elements.
      ui.colSel = colSel; ui.stratSel = stratSel; ui.customInput = customInput;

      fillColumns();
      fillStrategies();
      return [
        el("div", { class: "builder-field" }, [el("label", { class: "field-label", text: "Column" }), colSel]),
        el("div", { class: "builder-field" }, [el("label", { class: "field-label", text: "Strategy" }), stratSel]),
        customField,
      ];
    },
    preview: (ui) => {
      const { dataset, profile } = getState();
      const colId = ui.colSel?.value;
      if (!colId) return null;
      const type = profile.byColumn[colId]?.type ?? "string";
      const strategy = ui.stratSel?.value ?? "mode";
      const n = countMissing(dataset.working, colId);
      if (n === 0) return null;
      const fill = computeFillValue(dataset.working, colId, strategy, ui.customInput?.value ?? "");
      if (fill === null || String(fill).trim() === "") return null;
      return `Column: ${profile.byColumn[colId]?.name ?? colId} · missing: ${n} · method: ${strategy} · ${n} cell${n === 1 ? "" : "s"} will become "${fill}"`;
    },
    canApply: (ui) => {
      const colId = ui.colSel?.value;
      if (!colId) return "No column with missing values is available.";
      if ((ui.stratSel?.value) === "custom") {
        const type = getState().profile.byColumn[colId]?.type ?? "string";
        return customValueError(type, ui.customInput?.value ?? "");
      }
      const fill = computeFillValue(getState().dataset.working, colId, ui.stratSel?.value ?? "mode", "");
      if (fill === null || String(fill).trim() === "") {
        return "No usable fill value can be computed from this column's existing values.";
      }
      return null;
    },
    onApply: (ui) => {
      runOp(screen, null, fillMissing, [ui.colSel.value, ui.stratSel.value, ui.customInput?.value ?? ""]);
    },
  });
}

/* ---------- §9 Trim whitespace ---------- */

function buildTrimPanel(container, screen) {
  opPanel(container, {
    title: "Trim whitespace",
    description: "Remove leading/trailing spaces from cell values. Whitespace-only cells become empty (missing).",
    controls: (ui) => {
      const colSel = el("select", { class: "clean-input", "aria-label": "Columns to trim" });
      colSel.append(el("option", { value: "*", text: "All columns" }));
      for (const c of getState().dataset.working.columns) {
        colSel.append(el("option", { value: c.id, text: c.name }));
      }
      colSel.addEventListener("change", () => ui.refresh());
      ui.colSel = colSel;
      return [el("div", { class: "builder-field" }, [el("label", { class: "field-label", text: "Scope" }), colSel])];
    },
    preview: (ui) => {
      const ds = getState().dataset.working;
      const ids = ui.colSel?.value === "*" ? ds.columns.map((c) => c.id) : [ui.colSel?.value];
      const n = ids.reduce((sum, id) => sum + countTrimmable(ds, id), 0);
      if (n === 0) return null;
      return `${n} cell${n === 1 ? "" : "s"} contain leading or trailing whitespace and will be cleaned.`;
    },
    onApply: (ui) => {
      const ds = getState().dataset.working;
      const ids = ui.colSel?.value === "*" ? ds.columns.map((c) => c.id) : [ui.colSel?.value];
      runOp(screen, null, trimWhitespace, [ids]);
    },
  });
}

/* ---------- §10 Normalize text case ---------- */

function buildCasePanel(container, screen) {
  const MODES = [
    ["lower", "lowercase — Pakistan → pakistan"],
    ["upper", "UPPERCASE — Pakistan → PAKISTAN"],
    ["title", "Title Case — new york → New York"],
  ];
  opPanel(container, {
    title: "Normalize text case",
    description: "Rewrites values in one text column. This changes the data — categories like Pakistan/pakistan/PAKISTAN become one form.",
    controls: (ui) => {
      const colSel = el("select", { class: "clean-input", "aria-label": "Text column" });
      const modeSel = el("select", { class: "clean-input", "aria-label": "Case mode" });
      for (const c of getState().dataset.working.columns) colSel.append(el("option", { value: c.id, text: c.name }));
      for (const [v, label] of MODES) modeSel.append(el("option", { value: v, text: label }));
      colSel.addEventListener("change", () => ui.refresh());
      modeSel.addEventListener("change", () => ui.refresh());
      ui.colSel = colSel; ui.modeSel = modeSel;
      return [
        el("div", { class: "builder-field" }, [el("label", { class: "field-label", text: "Column" }), colSel]),
        el("div", { class: "builder-field" }, [el("label", { class: "field-label", text: "Convert to" }), modeSel]),
      ];
    },
    preview: (ui) => {
      const ds = getState().dataset.working;
      const colId = ui.colSel?.value;
      if (!colId) return null;
      const mode = ui.modeSel?.value ?? "lower";
      const t = mode === "lower" ? (v) => v.toLowerCase() : mode === "upper" ? (v) => v.toUpperCase() : (v) => v.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
      let n = 0;
      for (const row of ds.rows) {
        const v = String(row[colId] ?? "");
        if (v.trim() === "") continue;
        if (t(v) !== v) n++;
      }
      if (n === 0) return null;
      return `${n} cell${n === 1 ? "" : "s"} in "${ds.columns.find((c) => c.id === colId)?.name ?? colId}" will change.`;
    },
    onApply: (ui) => runOp(screen, null, normalizeCase, [ui.colSel.value, ui.modeSel.value]),
  });
}

/* ---------- §11 Category value replacement ---------- */

function buildReplacePanel(container, screen) {
  opPanel(container, {
    title: "Replace a value",
    description: "Replace one specific value with another in one column — e.g. Pak → Pakistan. You choose the pair; nothing is inferred.",
    controls: (ui) => {
      const colSel = el("select", { class: "clean-input", "aria-label": "Column" });
      const fromInput = el("input", { class: "clean-input", type: "text", list: "clean-replace-values", placeholder: "Existing value", "aria-label": "Value to replace" });
      const dataList = el("datalist", { id: "clean-replace-values" });
      const toInput = el("input", { class: "clean-input", type: "text", placeholder: "New value", "aria-label": "New value" });

      const fillCols = () => {
        colSel.replaceChildren();
        for (const c of getState().dataset.working.columns) colSel.append(el("option", { value: c.id, text: c.name }));
        fillValues();
      };
      const fillValues = () => {
        dataList.replaceChildren();
        const ds = getState().dataset.working;
        const freq = frequencies(ds.rows.map((r) => String(r[colSel.value] ?? "").trim()).filter((v) => v !== ""));
        for (const f of freq.slice(0, 200)) dataList.append(el("option", { value: f.value }));
      };
      colSel.addEventListener("change", () => { fillValues(); ui.refresh(); });
      fromInput.addEventListener("input", () => ui.refresh());
      toInput.addEventListener("input", () => ui.refresh());
      ui.colSel = colSel; ui.fromInput = fromInput; ui.toInput = toInput;
      fillCols();
      return [
        el("div", { class: "builder-field" }, [el("label", { class: "field-label", text: "Column" }), colSel]),
        el("div", { class: "builder-field" }, [el("label", { class: "field-label", text: "Existing value" }), fromInput, dataList]),
        el("div", { class: "builder-field" }, [el("label", { class: "field-label", text: "New value" }), toInput]),
      ];
    },
    preview: (ui) => {
      const colId = ui.colSel?.value;
      const from = String(ui.fromInput?.value ?? "").trim();
      const to = String(ui.toInput?.value ?? "");
      if (!colId || from === "") return null;
      if (from === to.trim()) return null;
      const n = countValueMatches(getState().dataset.working, colId, from);
      if (n === 0) return null;
      const name = getState().dataset.working.columns.find((c) => c.id === colId)?.name ?? colId;
      return `${name}: "${from}" → "${to}" · ${n} row${n === 1 ? "" : "s"} affected.`;
    },
    canApply: (ui) => {
      const from = String(ui.fromInput?.value ?? "").trim();
      const to = String(ui.toInput?.value ?? "");
      if (from !== "" && from === to.trim()) return "The new value is the same as the old value.";
      return null;
    },
    onApply: (ui) => runOp(screen, null, replaceValue, [ui.colSel.value, ui.fromInput.value, ui.toInput.value]),
  });
}

/* ---------- §12 Rename column ---------- */

function buildRenamePanel(container, screen) {
  opPanel(container, {
    title: "Rename column",
    description: "Changes only the display name — filters, charts, and deep links keep working because the internal column reference stays the same.",
    controls: (ui) => {
      const colSel = el("select", { class: "clean-input", "aria-label": "Column to rename" });
      const nameInput = el("input", { class: "clean-input", type: "text", placeholder: "New name", "aria-label": "New column name", maxlength: "80" });
      for (const c of getState().dataset.working.columns) colSel.append(el("option", { value: c.id, text: c.name }));
      colSel.addEventListener("change", () => { nameInput.value = ""; ui.refresh(); });
      nameInput.addEventListener("input", () => ui.refresh());
      ui.colSel = colSel; ui.nameInput = nameInput;
      return [
        el("div", { class: "builder-field" }, [el("label", { class: "field-label", text: "Column" }), colSel]),
        el("div", { class: "builder-field" }, [el("label", { class: "field-label", text: "New name" }), nameInput]),
      ];
    },
    preview: (ui) => {
      const colId = ui.colSel?.value;
      const name = String(ui.nameInput?.value ?? "").trim();
      if (!colId || name === "") return null;
      const old = getState().dataset.working.columns.find((c) => c.id === colId)?.name ?? colId;
      if (old === name) return null;
      return `${old} → ${name}`;
    },
    canApply: (ui) => {
      const colId = ui.colSel?.value;
      if (!colId) return null;
      return renameError(getState().dataset.working, colId, ui.nameInput?.value ?? "");
    },
    onApply: (ui) => runOp(screen, null, renameColumn, [ui.colSel.value, ui.nameInput.value]),
  });
}

/* ---------- §13 Delete column ---------- */

function buildDeleteColumnPanel(container, screen) {
  opPanel(container, {
    title: "Delete a column",
    description: "Permanently removes a column from the working dataset. The original file keeps it; undo restores it.",
    applyLabel: "Delete column",
    danger: true,
    controls: (ui) => {
      const colSel = el("select", { class: "clean-input", "aria-label": "Column to delete" });
      colSel.append(el("option", { value: "", text: "Choose a column…" }));
      for (const c of getState().dataset.working.columns) colSel.append(el("option", { value: c.id, text: c.name }));
      colSel.addEventListener("change", () => ui.refresh());
      ui.colSel = colSel;
      return [el("div", { class: "builder-field" }, [el("label", { class: "field-label", text: "Column" }), colSel])];
    },
    preview: (ui) => {
      const colId = ui.colSel?.value;
      if (!colId) return null;
      const ds = getState().dataset.working;
      const name = ds.columns.find((c) => c.id === colId)?.name ?? colId;
      return `Delete "${name}"? This removes the column from the working dataset (${ds.rowCount} rows keep their other data). The original file is untouched.`;
    },
    onApply: (ui) => {
      const colId = ui.colSel?.value;
      if (!colId) return;
      // The in-panel preview already shows "Delete \"name\"? …" with the
      // affected counts — that IS the explicit confirmation (§13/§15), so we
      // go straight to the orchestrator. Undo restores the column.
      runOp(screen, null, deleteColumn, [colId]);
    },
  });
}

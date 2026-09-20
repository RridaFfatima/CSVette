/* ============================================================
   CSVette — views/table.js
   The Data Table explorer: search, type-aware filters, sorting,
   and pagination — all combinable and all view-only. The working
   dataset is never mutated.

   The explorer state (search text, active filters, page, sort)
   and the combined row pipeline live in ../data-filter.js so they
   stay pure and testable; this module renders what they produce.
   ============================================================ */

import { getState } from "../state.js";
import { isMissing } from "../data-profile.js";
import {
  EXPLORER_PAGE_SIZE as pageSize,
  explorer, computeView, clampPage, cellMatchesQuery, effectiveFamily,
} from "../data-filter.js";
import { el, confirmButton } from "../dom.js";
import { renderExplorerControls } from "./filters.js";
import { deleteRows } from "../cleaning.js";
import { getCleanHooks } from "./clean.js";

/* Row selection for explicit row deletion (Milestone 6).
   Holds original row numbers (__rowNum) of selected rows. Pruned
   against the working dataset on every render, so deleted rows
   leave the selection automatically. */
const selectedRowNums = new Set();

/**
 * Render the table view.
 * @param {HTMLElement} container
 * @param {object} [params] deep-link params: { rows: "27,41", col: "age" }
 */
export function renderTable(container, params = {}) {
  const { dataset, profile } = getState();
  const working = dataset.working;

  // Combined pipeline: search → filters → sort (see data-filter.js)
  const view = computeView(working, profile);
  explorer.pageIndex = clampPage(view.rows.length);

  // Deep links from analysis screens are one-shot: they spotlight rows
  // (by original row number) and/or focus a column, then clear.
  const deepRows = params.rows
    ? new Set(String(params.rows).split(",").map(Number).filter(Number.isFinite))
    : new Set();
  const deepCol = typeof params.col === "string" ? params.col : null;

  // Deep-link grace (M6): a row may have been DELETED since the link
  // was made. Links to rows hidden by filters get one note; links to
  // rows that no longer exist get another. Never fail silently.
  const existingRowNums = new Set(working.rows.map((r) => r.__rowNum));
  const vanishedRows = [...deepRows].filter((n) => !existingRowNums.has(n));

  // If a deep-linked row is invisible because of active filters, say so —
  // never fail silently.
  const filtersActive = explorer.filters.length > 0;
  const hiddenByFilters = filtersActive
    ? [...deepRows].filter((n) => existingRowNums.has(n) && !view.visibleRowNums.has(n))
    : [];

  // Jump to the first visible spotlighted row so deep links land somewhere useful.
  if (deepRows.size > 0) {
    const firstIdx = view.rows.findIndex((r) => deepRows.has(r.__rowNum));
    if (firstIdx >= 0) explorer.pageIndex = Math.floor(firstIdx / pageSize);
  }

  container.replaceChildren();

  // Explain deleted deep-linked rows + hidden ones — two separate notes.
  if (vanishedRows.length > 0) {
    container.append(el("div", { class: "deep-note card", role: "status" }, [
      el("p", {
        text: `Row${vanishedRows.length === 1 ? "" : "s"} ${vanishedRows.join(", ")} no longer exist${vanishedRows.length === 1 ? "s" : ""} in the working dataset — ${vanishedRows.length === 1 ? "it was" : "they were"} probably deleted during cleaning. The original file still has ${vanishedRows.length === 1 ? "it" : "them"}.`,
      }),
    ]));
  }
  if (hiddenByFilters.length > 0) {
    const note = el("div", { class: "deep-note card", role: "status" });
    const list = hiddenByFilters.join(", ");
    note.append(
      el("p", {
        text: `Row${hiddenByFilters.length === 1 ? "" : "s"} ${list} ${hiddenByFilters.length === 1 ? "is" : "are"} linked from the analysis but hidden by the active filter${explorer.filters.length === 1 ? "" : "s"}.`,
      }),
      el("button", {
        class: "btn btn-secondary btn-sm",
        type: "button",
        text: "Remove filters and show",
        onclick: () => {
          explorer.filters = [];
          explorer.pageIndex = 0;
          renderTable(container, params);
        },
      }),
    );
    container.append(note);
  }

  // Toolbar: search, filter controls, active chips (built by filters.js)
  const toolbar = el("div", { class: "table-toolbar" });
  container.append(toolbar);
  renderExplorerControls(toolbar, container, () => renderTable(container));

  // Selection bar — only when rows are selected (§26)
  pruneSelection(working);
  if (selectedRowNums.size > 0) {
    container.append(buildSelectionBar(view, container));
  }

  // Bar: live status + pager
  const bar = el("div", { class: "table-bar" });
  const status = el("p", {
    class: "caption muted table-status",
    id: "table-status",
    role: "status",
  });
  bar.append(status, buildPager(view.rows.length, container));
  container.append(bar);

  // ----- Table -----
  const wrap = el("div", {
    class: "table-scroll card",
    tabindex: "0",
    role: "region",
    "aria-label": "Data table — scrolls horizontally",
  });
  const table = el("table", { class: "data-table" });
  table.setAttribute("aria-rowcount", String(view.rows.length));

  const thead = el("thead");
  const headRow = el("tr");

  // Page rows are needed by both the select-all header and the body.
  const start = explorer.pageIndex * pageSize;
  const pageRows = view.rows.slice(start, start + pageSize);

  // Selection column (delete rows arrives via Clean/selection bar)
  const selectAll = el("input", {
    type: "checkbox",
    class: "row-select",
    "aria-label": "Select all rows on this page",
  });
  const pageRowNums = pageRows.map((r) => r.__rowNum);
  const allPageSelected = pageRowNums.length > 0 && pageRowNums.every((n) => selectedRowNums.has(n));
  const somePageSelected = pageRowNums.some((n) => selectedRowNums.has(n));
  selectAll.checked = allPageSelected;
  selectAll.indeterminate = !allPageSelected && somePageSelected;
  selectAll.addEventListener("change", () => {
    for (const n of pageRowNums) {
      if (selectAll.checked) selectedRowNums.add(n);
      else selectedRowNums.delete(n);
    }
    renderTable(container);
  });
  headRow.append(el("th", { class: "rownum rownum-select", scope: "col" }, [selectAll]));
  const rowNumTh = el("th", { class: "rownum", scope: "col", text: "#" });
  headRow.append(rowNumTh);

  for (const col of working.columns) {
    const th = el("th", { scope: "col", class: "sortable" });
    th.dataset.columnId = col.id;
    if (deepCol === col.id) th.classList.add("col-focus");
    if (explorer.filters.some((f) => f.columnId === col.id)) {
      th.classList.add("col-filtered");
    }

    const label = el("span", { text: col.name });
    const arrow = el("span", {
      class: "sort-arrow",
      "aria-hidden": "true",
      text: explorer.sort.columnId === col.id ? (explorer.sort.dir === "asc" ? "↑" : "↓") : "",
    });
    th.append(label, arrow);

    if (explorer.filters.some((f) => f.columnId === col.id)) {
      th.append(
        el("span", { class: "filter-dot", "aria-hidden": "true", title: "Filtered" }),
        el("span", { class: "sr-only", text: " (filtered)" }),
      );
    }

    th.addEventListener("click", () => {
      if (explorer.sort.columnId === col.id) {
        explorer.sort.dir = explorer.sort.dir === "asc" ? "desc" : explorer.sort.dir === "desc" ? null : "asc";
        explorer.sort.columnId = explorer.sort.dir === null ? null : col.id;
      } else {
        explorer.sort = { columnId: col.id, dir: "asc" };
      }
      explorer.pageIndex = 0;
      renderTable(container);
    });
    if (explorer.sort.columnId === col.id) {
      th.setAttribute("aria-sort", explorer.sort.dir === "asc" ? "ascending" : "descending");
    }
    if (deepCol === col.id) {
      th.setAttribute("aria-label", `${col.name} — examined by the analysis that linked here`);
    }
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  const q = explorer.search.trim();

  for (const row of pageRows) {
    const tr = el("tr");
    if (deepRows.has(row.__rowNum)) tr.classList.add("row-highlight");
    if (selectedRowNums.has(row.__rowNum)) tr.classList.add("row-selected");

    const selectBox = el("input", {
      type: "checkbox",
      class: "row-select",
      "aria-label": `Select row ${row.__rowNum}`,
    });
    selectBox.checked = selectedRowNums.has(row.__rowNum);
    selectBox.addEventListener("change", () => {
      if (selectBox.checked) selectedRowNums.add(row.__rowNum);
      else selectedRowNums.delete(row.__rowNum);
      renderTable(container);
    });
    tr.append(el("td", { class: "rownum rownum-select" }, [selectBox]));

    const numTd = el("td", { class: "rownum mono", text: String(row.__rowNum) });
    tr.append(numTd);

    for (const col of working.columns) {
      const raw = row[col.id] ?? "";
      const missing = isMissing(raw);
      const type = profile.byColumn[col.id]?.type ?? "string";

      const td = el("td");
      if (missing) {
        td.textContent = "—";
        td.classList.add("is-missing");
        td.setAttribute("aria-label", `${col.name}: missing`);
      } else {
        if (q !== "" && cellMatchesQuery(raw, q)) {
          td.append(buildMatchSpan(String(raw), q));
        } else {
          td.textContent = String(raw);
        }
        if (type === "integer" || type === "float") td.classList.add("num", "mono");
        else if (type === "identifier") td.classList.add("mono");
      }
      if (deepCol === col.id) td.classList.add("col-focus");

      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  container.append(wrap);

  // ----- Empty state (no rows match) -----
  if (pageRows.length === 0) {
    const emptyTr = el("tr", { class: "empty-row" });
    const emptyTd = el("td", {
      class: "empty-cell",
      colspan: String(working.columns.length + 2),
    });
    const searchOn = q !== "";
    const filtersOn = explorer.filters.length > 0;
    emptyTd.append(
      el("p", {
        class: "empty-title",
        text: searchOn
          ? `No rows match "${q}"`
          : "No rows match the active filters",
      }),
      el("p", {
        class: "caption muted",
        text: searchOn && filtersOn
          ? "The search and the filters apply together (AND)."
          : "Try a different search or remove a filter.",
      }),
      el("button", {
        class: "btn btn-secondary btn-sm",
        type: "button",
        text: searchOn ? "Clear search & filters" : "Clear all filters",
        onclick: () => {
          explorer.search = "";
          explorer.filters = [];
          explorer.pageIndex = 0;
          renderTable(container);
        },
      }),
    );
    emptyTr.append(emptyTd);
    tbody.append(emptyTr);
  }

  // ----- Status line: always say what you're looking at -----
  const total = profile.rowCount;
  const shown = view.rows.length;
  const startN = shown === 0 ? 0 : start + 1;
  const endN = start + pageRows.length;
  const searching = q !== "";
  const filtering = explorer.filters.length > 0;

  const sortNote = explorer.sort.columnId
    ? ` · sorted by "${explorer.sort.columnId}" ${explorer.sort.dir === "asc" ? "↑" : "↓"}`
    : "";
  const filterNote = filtering
    ? ` · ${explorer.filters.length} filter${explorer.filters.length === 1 ? "" : "s"} active`
    : "";
  const spotNote = deepRows.size > 0
    ? ` · spotlighting row${deepRows.size === 1 ? "" : "s"} ${[...deepRows].sort((a, b) => a - b).join(", ")} from the analysis`
    : "";

  if (shown === 0) {
    status.textContent = searching
      ? `0 of ${total} rows match "${q}"${filterNote}`
      : `0 of ${total} rows match the active filters`;
  } else if (searching || filtering) {
    status.textContent =
      `Showing ${startN}–${endN} of ${shown} matching rows (from ${total})` +
      `${sortNote}${filterNote}${spotNote}`;
  } else {
    status.textContent =
      `Showing ${startN}–${endN} of ${total} rows${sortNote}${spotNote}`;
  }

  // Bring the first spotlighted row into view (skipped when nothing linked).
  if (deepRows.size > 0) {
    wrap.querySelector("tr.row-highlight")?.scrollIntoView({ block: "center" });
  }
}

/**
 * Wrap the parts of a cell value that match the search query in
 * <mark class="match"> — plain DOM, no innerHTML.
 */
function buildMatchSpan(value, query) {
  const span = document.createElement("span");
  const lower = value.toLowerCase();
  const needle = query.toLowerCase();
  let from = 0;
  let idx = lower.indexOf(needle, from);
  while (idx >= 0) {
    if (idx > from) span.append(value.slice(from, idx));
    span.append(el("mark", { class: "match", text: value.slice(idx, idx + needle.length) }));
    from = idx + needle.length;
    idx = lower.indexOf(needle, from);
  }
  if (from < value.length) span.append(value.slice(from));
  return span;
}

function buildPager(totalRows) {
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const pager = el("div", { class: "pager" });

  const mkBtn = (label, target, disabled, ariaLabel) => {
    const b = el("button", {
      class: "btn btn-secondary btn-sm",
      type: "button",
      text: label,
      "aria-label": ariaLabel,
      onclick: () => {
        explorer.pageIndex = target;
        renderTable(document.getElementById("workspace"));
      },
    });
    b.disabled = disabled;
    return b;
  };

  pager.append(
    mkBtn("First", 0, explorer.pageIndex === 0, "Go to first page"),
    mkBtn("Prev", Math.max(0, explorer.pageIndex - 1), explorer.pageIndex === 0, "Go to previous page"),
  );

  const info = el("span", {
    class: "pager-info mono caption",
    text: `Page ${explorer.pageIndex + 1} / ${totalPages}`,
  });
  pager.append(info);

  pager.append(
    mkBtn("Next", Math.min(totalPages - 1, explorer.pageIndex + 1), explorer.pageIndex >= totalPages - 1, "Go to next page"),
    mkBtn("Last", totalPages - 1, explorer.pageIndex >= totalPages - 1, "Go to last page"),
  );

  return pager;
}

/* ---------- Row selection (Milestone 6, §26) ---------- */

/** Drop selections of rows that no longer exist in the working set. */
function pruneSelection(working) {
  if (selectedRowNums.size === 0) return;
  const existing = new Set(working.rows.map((r) => r.__rowNum));
  for (const n of [...selectedRowNums]) {
    if (!existing.has(n)) selectedRowNums.delete(n);
  }
}

/**
 * Clear the whole selection. Used when the dataset identity changes —
 * selection is per-dataset, and __rowNum values from a previous dataset
 * would otherwise silently select (and delete!) unrelated rows in the new
 * one. Called from app.js on every load.
 */
export function clearRowSelection() {
  selectedRowNums.clear();
}

/**
 * The bar shown while rows are selected. Says exactly what would be
 * deleted — the SELECTED rows, never "filtered rows" (§26) — and asks
 * for explicit confirmation.
 */
function buildSelectionBar(view, container) {
  const n = selectedRowNums.size;
  const bar = el("div", { class: "selection-bar", role: "status" });
  bar.append(
    el("span", {
      class: "selection-count",
      text: `${n} row${n === 1 ? "" : "s"} selected${view.rows.length !== workingRowCount() ? ` — of the ${view.rows.length} rows in the current view` : ""}`,
    }),
    el("button", {
      class: "btn btn-secondary btn-sm",
      type: "button",
      text: "Clear selection",
      onclick: () => {
        selectedRowNums.clear();
        renderTable(container);
      },
    }),
    confirmButton({
      label: `Delete ${n} selected row${n === 1 ? "" : "s"}`,
      confirmLabel: "Confirm delete",
      onConfirm: () => {
        const nums = [...selectedRowNums].sort((a, b) => a - b);
        // Goes through the same orchestrator as every other cleaning op:
        // snapshot → history → reprofile → re-render. This removes exactly
        // the selected rows — never the whole filtered view.
        const res = getCleanHooks()?.apply(deleteRows, [nums]);
        if (res?.ok) selectedRowNums.clear();
      },
    }),
  );
  return bar;
}

function workingRowCount() {
  return getState().dataset.working.rowCount;
}

/* ============================================================
   CSVette — views/filters.js
   Explorer controls for the Data Table: dataset search, the
   filter builder popover (type-aware forms), and active filter
   chips with edit/remove/clear-all.

   Progressive disclosure: the toolbar stays compact — one search
   box, one filter button, and chips only for filters the user
   actually created. Pure logic lives in ../data-filter.js.
   ============================================================ */

import { getState } from "../state.js";
import {
  explorer, makeFilter, describeFilter, filterError,
  filterFamilyFor, effectiveFamily, OPERATORS,
} from "../data-filter.js";
import { el } from "../dom.js";

let searchTimer = null;
let editingIndex = null; // filter index currently loaded into the builder
let outsideBound = false; // guard against double-binding the outside-click closer

/**
 * Build the toolbar controls into `toolbar`. Re-renders the table via `rerender`.
 */
export function renderExplorerControls(toolbar, container, rerender) {
  const { profile } = getState();

  // ----- Search -----
  const searchWrap = el("div", { class: "search-wrap" });
  const searchInput = el("input", {
    class: "search-input",
    type: "search",
    id: "table-search",
    placeholder: `Search all ${profile.columnCount} columns…`,
    "aria-label": "Search the dataset",
    autocomplete: "off",
  });
  searchInput.value = explorer.search;
  const clearBtn = el("button", {
    class: "search-clear",
    type: "button",
    "aria-label": "Clear search",
    text: "×",
    onclick: () => {
      searchInput.value = "";
      applySearch("", rerender);
    },
  });
  clearBtn.hidden = explorer.search === "";
  searchInput.addEventListener("input", () => {
    clearBtn.hidden = searchInput.value === "";
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applySearch(searchInput.value, rerender), 150);
  });
  searchWrap.append(searchInput, clearBtn);

  // ----- Filter button + popover -----
  const filterBtn = el("button", {
    class: "btn btn-secondary btn-sm filter-btn",
    type: "button",
    "aria-expanded": "false",
    "aria-controls": "filter-popover",
    onclick: () => togglePopover(toolbar, container, rerender),
  });
  filterBtn.append("Filter");
  if (explorer.filters.length > 0) {
    filterBtn.append(
      el("span", { class: "filter-count-badge", text: String(explorer.filters.length) }),
    );
  }
  filterBtn.append(el("span", { class: "filter-caret", "aria-hidden": "true", text: "▾" }));

  // ----- Active filter chips (always visible when filters exist) -----
  const chips = el("div", { class: "filter-chips", "aria-label": "Active filters" });
  explorer.filters.forEach((f, i) => {
    chips.append(buildChip(f, i, container, rerender));
  });
  if (explorer.filters.length > 0) {
    chips.append(
      el("button", {
        class: "chip-link",
        type: "button",
        text: "Clear all",
        onclick: () => {
          explorer.filters = [];
          explorer.pageIndex = 0;
          rerender();
        },
      }),
    );
  }

  toolbar.append(searchWrap, filterBtn);
  if (explorer.filters.length > 0) toolbar.append(chips);

  if (toolbar.querySelector("#filter-popover")) {
    renderPopoverInto(toolbar.querySelector("#filter-popover"), container, rerender);
  }
}

/** Debounced search application shared by typing and the clear button. */
function applySearch(value, rerender) {
  explorer.search = value;
  explorer.pageIndex = 0;
  rerender();
}

/* ---------- Active filter chips ---------- */

function buildChip(filter, index, container, rerender) {
  const { profile } = getState();
  const chip = el("span", { class: "filter-chip" });
  chip.append(el("span", { class: "chip-text", text: describeFilter(filter, columnName(filter.columnId, profile)) }));
  chip.append(
    el("button", {
      class: "chip-edit",
      type: "button",
      "aria-label": `Edit filter on ${filter.columnId}`,
      text: "✎",
      onclick: () => {
        editingIndex = index;
        openPopover(container, rerender);
      },
    }),
    el("button", {
      class: "chip-remove",
      type: "button",
      "aria-label": `Remove filter on ${filter.columnId}`,
      text: "×",
      onclick: () => {
        explorer.filters.splice(index, 1);
        explorer.pageIndex = 0;
        rerender();
      },
    }),
  );
  return chip;
}

function columnName(columnId, profile) {
  return profile.byColumn[columnId]?.name ?? columnId;
}

/* ---------- Popover / filter builder ---------- */

function togglePopover(toolbar, container, rerender) {
  const existing = toolbar.querySelector("#filter-popover");
  const btn = toolbar.querySelector(".filter-btn");
  if (existing) {
    existing.remove();
    btn.setAttribute("aria-expanded", "false");
  } else {
    const panel = el("div", { class: "filter-popover card", id: "filter-popover", role: "dialog", "aria-label": "Filter builder" });
    toolbar.append(panel);
    renderPopoverInto(panel, container, rerender);
    btn.setAttribute("aria-expanded", "true");
    bindOutsideClose(container, rerender);
    panel.querySelector("#filter-column-select")?.focus();
  }
}

function openPopover(container, rerender) {
  rerender(); // rebuilds the toolbar; then open the popover fresh
  const toolbar = container.querySelector(".table-toolbar");
  if (toolbar) {
    togglePopover(toolbar, container, rerender);
  }
}

function bindOutsideClose(container, rerender) {
  if (outsideBound) return;
  outsideBound = true;
  // Query the toolbar LIVE at event time: re-renders replace the toolbar
  // node, so a captured reference would go stale (detached) and silently
  // stop matching. `container` (#workspace) persists across re-renders.
  document.addEventListener("click", (e) => {
    const toolbar = container.querySelector(".table-toolbar");
    const panel = toolbar?.querySelector("#filter-popover");
    if (!panel) return;
    const btn = toolbar.querySelector(".filter-btn");
    if (panel.contains(e.target) || btn?.contains(e.target)) return;
    // Clicks elsewhere in the app close the builder; other clicks re-render
    // the table anyway, so nothing stale survives.
    if (!container.contains(e.target) || e.target.closest(".chip-edit")) return;
    panel.remove();
    btn?.setAttribute("aria-expanded", "false");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const toolbar = container.querySelector(".table-toolbar");
    const panel = toolbar?.querySelector("#filter-popover");
    if (!panel) return;
    panel.remove();
    toolbar.querySelector(".filter-btn")?.setAttribute("aria-expanded", "false");
  });
}

function renderPopoverInto(panel, container, rerender) {
  const { profile } = getState();
  panel.replaceChildren();

  panel.append(el("h3", { class: "popover-title", text: editingIndex !== null ? "Edit filter" : "Add a filter" }));

  // Column select
  const colSelect = el("select", { id: "filter-column-select", "aria-label": "Column to filter" });
  for (const col of getState().dataset.working.columns) {
    const t = profile.byColumn[col.id]?.type ?? "string";
    colSelect.append(el("option", { value: col.id, text: `${col.name} (${t})` }));
  }
  if (editingIndex !== null) colSelect.value = explorer.filters[editingIndex].columnId;

  // The operator/value form rebuilds when the column changes.
  const formSlot = el("div", { class: "filter-form-slot" });
  const rebuildForm = () => buildFormForColumn(formSlot, colSelect.value, container, rerender);
  colSelect.addEventListener("change", rebuildForm);

  panel.append(
    el("label", { class: "field-label", for: "filter-column-select", text: "Column" }),
    colSelect,
    formSlot,
  );
  rebuildForm();

  // List of active filters with edit/remove
  if (explorer.filters.length > 0) {
    const list = el("ul", { class: "popover-filter-list" });
    explorer.filters.forEach((f, i) => {
      const li = el("li");
      li.append(
        el("span", { class: "chip-text", text: describeFilter(f, columnName(f.columnId, profile)) }),
        el("button", {
          class: "chip-link",
          type: "button",
          text: i === editingIndex ? "Editing…" : "Edit",
        onclick: () => {
          // renderPopoverInto rebuilds the whole panel (including the
          // column select and pre-filled form) from editingIndex.
          editingIndex = i;
          renderPopoverInto(panel, container, rerender);
        },
        }),
        el("button", {
          class: "chip-remove",
          type: "button",
          "aria-label": `Remove filter on ${f.columnId}`,
          text: "×",
          onclick: () => {
            explorer.filters.splice(i, 1);
            if (editingIndex === i) editingIndex = null;
            else if (editingIndex > i) editingIndex -= 1;
            explorer.pageIndex = 0;
            renderPopoverInto(panel, container, rerender);
            rerender();
          },
        }),
      );
      list.append(li);
    });
    panel.append(el("h4", { class: "popover-subtitle", text: "Active filters" }), list);
    panel.append(
      el("button", {
        class: "btn btn-secondary btn-sm",
        type: "button",
        text: "Clear all filters",
        onclick: () => {
          explorer.filters = [];
          editingIndex = null;
          explorer.pageIndex = 0;
          renderPopoverInto(panel, container, rerender);
          rerender();
        },
      }),
    );
  }

  panel.append(
    el("button", {
      class: "btn btn-ghost btn-sm popover-done",
      type: "button",
      text: "Done",
      onclick: () => {
        editingIndex = null;
        panel.remove();
        toolbarRef(container)?.querySelector(".filter-btn")?.setAttribute("aria-expanded", "false");
      },
    }),
  );
}

function toolbarRef(container) {
  return container.querySelector(".table-toolbar");
}

/**
 * Build the operator + value form for one column, driven by its
 * effective filter family (text / number / boolean / date / other).
 */
function buildFormForColumn(slot, columnId, container, rerender) {
  const { profile } = getState();
  const type = profile.byColumn[columnId]?.type ?? "string";
  const family = effectiveFamily(filterFamilyFor(type));
  const current = editingIndex !== null && explorer.filters[editingIndex]?.columnId === columnId
    ? explorer.filters[editingIndex]
    : null;

  slot.replaceChildren();

  const ops = OPERATORS[effectiveFamily(filterFamilyFor(type))].ops;
  const opSelect = el("select", { id: "filter-op-select", "aria-label": "Operator" });
  for (const op of ops) {
    opSelect.append(el("option", { value: op, text: OPERATORS[family].labels[op] ?? op }));
  }
  opSelect.value = current ? current.op : ops[0];

  const valueA = el("input", { id: "filter-value-a", class: "filter-input", type: "text", "aria-label": "Value" });
  const valueB = el("input", { id: "filter-value-b", class: "filter-input", type: "text", "aria-label": "Second value" });
  configureInputsForFamily(family, opSelect, valueA, valueB, columnId, profile, current);

  const syncInputs = () => configureInputsForFamily(family, opSelect, valueA, valueB, columnId, profile, current);
  opSelect.addEventListener("change", syncInputs);

  const error = el("p", { class: "filter-error", role: "alert", hidden: "true" });

  const apply = el("button", {
    class: "btn btn-primary btn-sm",
    type: "button",
    text: editingIndex !== null ? "Update filter" : "Apply filter",
    onclick: () => {
      const filter = makeFilter(
        columnId,
        opSelect.value,
        valueA.value.trim(),
        valueB ? valueB.value.trim() : undefined,
      );
      const err = filterError(filter, type);
      if (err) {
        error.textContent = err;
        error.hidden = false;
        return;
      }
      if (editingIndex !== null) {
        explorer.filters[editingIndex] = filter;
        editingIndex = null;
      } else {
        explorer.filters.push(filter);
      }
      explorer.pageIndex = 0;
      rerender();
      // Reopen fresh so the user sees the updated active list.
      const toolbar = toolbarRef(container);
      const panel2 = toolbar?.querySelector("#filter-popover");
      if (panel2) renderPopoverInto(panel2, container, rerender);
    },
  });

  slot.append(
    el("label", { class: "field-label", for: "filter-op-select", text: "Operator" }),
    opSelect,
    valueA,
    valueB,
    error,
    apply,
  );

  // Quick-select common values for text-ish columns (not while editing).
  if (current === null && (family === "text" || family === "other")) {
    const top = profile.byColumn[columnId]?.topValues;
    if (top && top.length > 1) {
      const quick = el("div", { class: "quick-values" });
      quick.append(el("span", { class: "field-label", text: "Common values" }));
      for (const { value, count } of top.slice(0, 6)) {
        quick.append(
          el("button", {
            class: "quick-value",
            type: "button",
            text: `${value} (${count})`,
            onclick: () => {
              opSelect.value = "equals";
              valueA.value = String(value);
              syncInputs();
            },
          }),
        );
      }
      slot.append(quick);
    }
  }
}


/** Show/hide and configure the value inputs per operator and family. */
function configureInputsForFamily(family, opSelect, valueA, valueB, columnId, profile, current) {
  const op = opSelect.value;
  const needsA = !["is-empty", "is-not-empty", "is-true", "is-false"].includes(op);
  const needsB = op === "between";

  valueA.hidden = !needsA;
  valueB.hidden = !needsB;
  if (!needsA) valueA.value = "";
  if (!needsB) valueB.value = "";

  if (needsA) {
    if (family === "date") valueA.type = "date";
    else if (family === "number") valueA.type = "text";
    else valueA.type = "text";
    if (family === "number") valueA.inputMode = "decimal";
    else valueA.removeAttribute("inputmode");
  }
  if (needsB && family === "date") valueB.type = "date";
  if (needsB && family === "number") valueB.inputMode = "decimal";

  // Prefill from the filter being edited.
  if (current && current.op === op) {
    if (needsA) valueA.value = current.value ?? "";
    if (needsB && current.value2 !== undefined) valueB.value = current.value2 ?? "";
  }

  valueA.placeholder = placeholderFor(family, op, valueA.type, columnId, profile);
  valueB.placeholder = needsB ? "and" : "";
}

function placeholderFor(family, op, inputType, columnId, profile) {
  if (inputType === "date") return "yyyy-mm-dd";
  if (family === "number") return op === "eq" ? "e.g. 42" : "e.g. 70";
  const t = profile.byColumn[columnId]?.type;
  if (t === "boolean") return "true / false";
  return "e.g. Pakistan";
}

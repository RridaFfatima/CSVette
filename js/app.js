/* ============================================================
   CSVette — app.js
   Orchestrator: theme, routing, upload/drop/sample handling,
   loading & error states, and view dispatch. Views render from
   state; this module owns all event wiring.
   ============================================================ */

import { el } from "./dom.js";
import { getPref, setPref } from "./storage.js";
import { getState, loadDataset, setAnalysis, clearRouteParams, setRoute, replaceWorking, pushHistory, undoLast, resetToOriginal, canUndo, getHistory } from "./state.js";
import { startRouter, navigate } from "./router.js";
import { validateFile, parseCsv, normalizeDataset, formatBytes } from "./csv-parser.js";
import { profileDataset } from "./data-profile.js";
import { analyzeQuality } from "./data-quality.js";
import { generateInsights } from "./insights.js";
import { explorer, resetExplorer } from "./data-filter.js";
import { initLandingView, renderLanding, setUploadProgress, setLandingError } from "./views/landing.js";
import { buildShell, setActiveRoute, updateSidebarCounts, updateHeaderChip, setDrawerOpen, markScoreDirty } from "./views/shell.js";
import { renderOverview } from "./views/overview.js";
import { renderTable, clearRowSelection } from "./views/table.js";
import { renderStats } from "./views/stats.js";
import { renderCharts } from "./views/charts.js";
import { renderCorrelations } from "./views/correlations.js";
import { renderClean, setCleanHooks } from "./views/clean.js";
import { renderExportCsv, renderReport } from "./views/export.js";
import { renderPlaceholder } from "./views/placeholder.js";
import { renderHealth, renderMissing, renderDuplicates, renderOutliers, renderConsistency, renderTypes, renderIdentifiers } from "./views/health.js";

/* ---------- Samples (spec §8) ---------- */

const SAMPLES = [
  { id: "sales", file: "sales.csv", label: "Sales", blurb: "36 orders · mostly clean, one missing value" },
  { id: "students", file: "students.csv", label: "Students", blurb: "28 students · grades, majors, attendance" },
  { id: "orders", file: "orders.csv", label: "Orders", blurb: "36 orders · statuses and shipping dates" },
  { id: "messy_customers", file: "messy_customers.csv", label: "Messy Customers", blurb: "30 customers · every kind of data problem", messy: true },
];

/* ---------- Boot ---------- */

let workspaceApi = null;   // { root, workspace, sidebar } once built
let appRoot = null;

function init() {
  appRoot = document.getElementById("app-root");

  initTheme();
  initLandingView();
  bindLandingHandlers();

  startRouter(handleRoute);

  // Cleaning hooks: the Clean view stays DOM-pure about orchestration —
  // it calls back into these instead of importing app.js (cycle).
  setCleanHooks({ apply: applyCleaning, undo: undoCleaning, reset: resetCleaning });

  // Debug/verification hook (testing aid, like the ?cb console helper).
  window.__csvette_state = { getState, explorer };
}

/* ---------- Theme ---------- */

const THEME_KEY = "theme";
const bound = new WeakMap(); // node → Set<eventType>

function bindOnce(node, type, fn) {
  let types = bound.get(node);
  if (!types) {
    types = new Set();
    bound.set(node, types);
  }
  if (types.has(type)) return;
  types.add(type);
  node.addEventListener(type, fn);
}

function applyTheme(theme) {
  const root = document.documentElement;
  const current = root.getAttribute("data-theme");
  if (current === theme) return;
  // M10: crossfade property changes for one transition window.
  // Rapid toggles get the `fast` snap instead of a smeared fade.
  const fade = root.classList.contains("live") ? "fast" : "live";
  root.classList.add(fade);
  root.setAttribute("data-theme", theme);
  if (fade === "live") {
    const done = () => {
      root.classList.remove("live");
      root.removeEventListener("transitionend", done);
    };
    root.addEventListener("transitionend", done, { once: false });
    setTimeout(done, 400); // safety net if transitionend never fires
  } else {
    setTimeout(() => root.classList.remove("fast"), 60);
  }
  // Landing and workspace each have a toggle; update whichever exists.
  for (const toggle of document.querySelectorAll(".theme-toggle")) {
    toggle.setAttribute("aria-pressed", String(theme === "dark"));
    toggle.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }
}

function initTheme() {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(current);
  bindThemeToggle();
}

function bindThemeToggle() {
  for (const toggle of document.querySelectorAll(".theme-toggle")) {
    bindOnce(toggle, "click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      setPref(THEME_KEY, next);
    });
  }
}

/* ---------- Routing ---------- */

function handleRoute(route, params = {}) {
  setLandingError(appRoot, null);
  closeDrawer();

  if (route === null) {
    renderLanding(appRoot);
    bindLandingHandlers();
    bindThemeToggle();
    document.body.classList.remove("has-dataset");
    return;
  }

  document.body.classList.add("has-dataset");
  appRoot.replaceChildren(); // unmount the landing — the shell takes over
  // Mirror the route into state (the cleaning orchestrator re-dispatches
  // from here after every operation; views may also read routeParams).
  setRoute(route, params);

  if (!workspaceApi) {
    workspaceApi = buildShell();
    document.body.append(workspaceApi.root);
    bindShellHandlers();
  }

  const state = getState();
  updateSidebarCounts(state.profile, state.quality);
  updateHeaderChip(state.profile, state.dataset.fileName);
  setActiveRoute(route);
  bindThemeToggle();

  const ws = workspaceApi.workspace;
  // M10: subtle route entrance — content rises in; not a page animation.
  ws.classList.remove("screen-enter");
  switch (route) {
    case "overview": renderOverview(ws); break;
    case "table": renderTable(ws, params); break;
    case "stats": renderStats(ws); break;
    case "charts": renderCharts(ws, params); break;
    case "correlations": renderCorrelations(ws); break;
    case "clean": renderClean(ws); break;
    case "export-csv": renderExportCsv(ws); break;
    case "report": renderReport(ws); break;
    case "history": renderClean(ws, { historyOnly: true }); break;
    case "health": renderHealth(ws); break;
    case "missing": renderMissing(ws, params); break;
    case "duplicates": renderDuplicates(ws, params); break;
    case "outliers": renderOutliers(ws, params); break;
    case "consistency": renderConsistency(ws); break;
    case "types": renderTypes(ws, params); break;
    case "identifiers": renderIdentifiers(ws); break;
    default: renderPlaceholder(ws, route);
  }

  ws.classList.add("screen-enter"); // after children are rendered

  window.scrollTo(0, 0);
  // Deep-link params are one-shot: Back/forward then shows the screen unfiltered.
  clearRouteParams();
}

/* ---------- Landing handlers ---------- */

function bindLandingHandlers() {
  const uploadBtn = document.getElementById("upload-btn");
  const sampleBtn = document.getElementById("sample-btn");
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  if (!uploadBtn) return; // not on landing

  bindOnce(uploadBtn, "click", () => fileInput.click());
  bindOnce(fileInput, "change", () => {
    const file = fileInput.files?.[0];
    if (file) loadUserFile(file);
    fileInput.value = ""; // allow picking the same file again later
  });

  // Sample menu
  sampleBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSampleMenu(sampleBtn);
  });
  // Drag & drop onto the preview frame
  if (dropzone) {
    bindOnce(dropzone, "dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); });
    bindOnce(dropzone, "dragleave", () => dropzone.classList.remove("drag-over"));
    bindOnce(dropzone, "drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (file) loadUserFile(file);
    });
  }

  // Close the sample menu on outside clicks (bound once per page)
  if (!bindLandingHandlers._outsideBound) {
    bindLandingHandlers._outsideBound = true;
    document.addEventListener("click", landingOutsideClick, { capture: true });
  }
}

function landingOutsideClick(e) {
  const menu = document.getElementById("sample-menu");
  if (menu && !menu.hidden && !menu.contains(e.target) && !e.target.closest("#sample-btn")) {
    menu.hidden = true;
  }
}

function toggleSampleMenu(anchor) {
  let menu = document.getElementById("sample-menu");
  if (menu) { menu.hidden = !menu.hidden; return; }

  menu = el("div", { class: "sample-menu", id: "sample-menu", role: "menu" });
  for (const s of SAMPLES) {
    const item = el("button", { class: "sample-item" + (s.messy ? " sample-item-messy" : ""), type: "button", role: "menuitem" }, [
      el("span", { class: "sample-item-label" }, [s.label]),
      el("span", { class: "caption muted" }, [s.blurb]),
    ]);
    item.addEventListener("click", () => {
      menu.hidden = true;
      loadSample(s);
    });
    menu.append(item);
  }
  anchor.parentElement.append(menu);
}

/* ---------- Shell handlers ---------- */

function bindShellHandlers() {
  const menuBtn = workspaceApi.root.querySelector(".ws-menu-btn");
  menuBtn.addEventListener("click", () => {
    const open = !document.querySelector(".workspace-root").classList.contains("drawer-open");
    setDrawerOpen(open);
  });

  document.getElementById("new-dataset-btn").addEventListener("click", () => {
    const { profile, history } = getState();
    const hasEdits = history.length > 0;
    if (profile && hasEdits && !confirm("Start over with a new dataset? Your cleaning history will be lost.")) {
      return;
    }
    navigate(null);
  });

  // Backdrop click closes the drawer
  const backdrop = document.createElement("div");
  backdrop.className = "drawer-backdrop";
  backdrop.addEventListener("click", closeDrawer);
  workspaceApi.root.append(backdrop);

  // Escape closes the drawer
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });
}

function closeDrawer() {
  const root = document.querySelector(".workspace-root");
  if (root) root.classList.remove("drawer-open");
}

/* ---------- Loading pipeline ---------- */

async function loadUserFile(file) {
  setLandingError(appRoot, null);

  const validation = validateFile(file);
  if (!validation.ok) {
    setLandingError(appRoot, validation.message);
    return;
  }

  setUploadProgress(appRoot, true);
  try {
    const results = await parseCsv(file);
    finishLoad(results, file.name, file.size, validation.level === "warn" ? [validation.message] : []);
  } catch (error) {
    setUploadProgress(appRoot, false);
    setLandingError(appRoot,
      `The file couldn't be read (${error.message ?? "unknown parser error"}). ` +
      "Make sure it's a valid CSV file, or try a sample dataset.");
  }
}

async function loadSample(sample) {
  setLandingError(appRoot, null);
  setUploadProgress(appRoot, true);
  try {
    const response = await fetch(`sample-data/${sample.file}`);
    if (!response.ok) throw new Error(`sample file not found (${response.status})`);
    const text = await response.text();
    const results = await parseCsv(text);
    finishLoad(results, sample.file, text.length, []);
  } catch (error) {
    setUploadProgress(appRoot, false);
    setLandingError(appRoot,
      `The sample dataset couldn't be loaded (${error.message}). ` +
      "This needs to run over HTTP (http://localhost:8000), not file://.");
  }
}

function finishLoad(papaResults, fileName, fileSize, extraWarnings) {
  const { dataset, warnings } = normalizeDataset(papaResults, fileName, fileSize);

  // Hard error: nothing usable
  if (dataset.columns.length === 0) {
    setUploadProgress(appRoot, false);
    setLandingError(appRoot,
      "No columns were found in this file. It may be empty or not actually CSV-formatted. " +
      "CSV needs at least one header row, with column names separated by commas.");
    return;
  }
  if (dataset.rowCount === 0) {
    setUploadProgress(appRoot, false);
    setLandingError(appRoot,
      "This file has a header row but no data rows — there's nothing to analyze yet. " +
      "Add some rows to the file, or try a sample dataset.");
    return;
  }

  // Profile + quality + health, then commit to state in the right order:
  // loadDataset registers the frozen original, setAnalysis attaches results.
  const profile = profileDataset(dataset);
  const quality = analyzeQuality(dataset, profile);
  const insights = generateInsights(dataset, profile, quality);
  loadDataset(dataset, [...extraWarnings, ...warnings]);
  setAnalysis(profile, quality.health, quality, insights);
  resetExplorer(); // a new dataset must not inherit the old view's filters/sort
  clearRowSelection(); // selections are per-dataset — stale __rowNums would select (and delete) unrelated rows

  setUploadProgress(appRoot, false);
  navigate("overview");
}

/* ---------- Cleaning orchestration (Milestone 6) ----------
   ONE recalculation pipeline: operation → new working dataset →
   history entry → reprofile → re-analyze → re-render. Every screen
   reads state, so re-rendering the current route is the update. */

/** The single pipeline after any working-dataset change. */
function recalculate() {
  const s = getState();
  const profile = profileDataset(s.dataset.working);
  const quality = analyzeQuality(s.dataset.working, profile);
  const insights = generateInsights(s.dataset.working, profile, quality);
  setAnalysis(profile, quality.health, quality, insights);
  updateSidebarCounts(profile, quality);
  updateHeaderChip(profile, s.dataset.fileName);
}

/**
 * Apply one cleaning operation: validate → compute → confirm through
 * the caller's preview UI → commit + history + recalculate → re-render
 * the current screen so no stale analysis survives.
 * Returns { ok, error, summary } for the caller's feedback UI.
 */
function applyCleaning(opFn, args) {
  const before = getState().dataset.working;
  const result = opFn(before, ...args);
  if (result.error) return { ok: false, error: result.error };

  // Stale-view guard (§22): if a column disappeared (delete column),
  // drop explorer filters/sort that referenced it rather than leaving
  // the table silently matching everything.
  const after = result.dataset;
  if (after.columns.length < before.columns.length) {
    const ids = new Set(after.columns.map((c) => c.id));
    const beforeCount = explorer.filters.length + (explorer.sort.columnId ? 1 : 0);
    explorer.filters = explorer.filters.filter((f) => ids.has(f.columnId));
    if (explorer.sort.columnId && !ids.has(explorer.sort.columnId)) {
      explorer.sort = { columnId: null, dir: null };
    }
    const afterCount = explorer.filters.length + (explorer.sort.columnId ? 1 : 0);
    if (afterCount < beforeCount) explorer.pageIndex = 0;
  }

  // Freeze the new working state exactly like a freshly loaded dataset.
  replaceWorking(result.dataset);
  pushHistory(result.summary, before);
  recalculate();

  // The current route re-renders with the fresh analysis. Deep-link
  // params stay cleared — operations come from explicit user actions.
  handleRoute(getState().ui.route, {});
  markScoreDirty(); // health score changed — next Health visit gets one restrained emphasis
  return { ok: true, summary: result.summary };
}

function undoCleaning() {
  const entry = getHistory()[getHistory().length - 1];
  const removedLabel = entry?.label ?? null;
  const restored = undoLast();
  if (!restored) return { ok: false, error: "Nothing to undo." };
  recalculate();
  handleRoute(getState().ui.route, {});
  markScoreDirty();
  return { ok: true, removedLabel };
}

function resetCleaning() {
  resetToOriginal();
  resetExplorer(); // explorer state may reference renamed/deleted columns
  recalculate();
  handleRoute(getState().ui.route, {});
  markScoreDirty();
  return { ok: true };
}

/* ---------- Boot ---------- */

// Module scripts are deferred: the DOM above is fully parsed by now.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

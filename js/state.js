/* ============================================================
   CSVette — state.js
   One app-state object, mutated only through named functions.
   original = never touched again (frozen); working = what every
   screen reads. Listeners re-render only what they need.
   ============================================================ */const state = {
  dataset: {
    original: null,   // frozen after load — NEVER mutated, by anyone
    working: null,    // current version — what views render
    fileName: null,
    sizeBytes: 0,
    loadedAt: null,
  },
  profile: null,      // profileDataset(working) result — set via setAnalysis()
  health: null,       // computeHealth(...) result — set via setAnalysis()
  quality: null,      // analyzeQuality(...) result (findings + detail tables) — set via setAnalysis()
  insights: null,     // generateInsights(working, profile, quality) — set via setAnalysis()
  warnings: [],       // non-blocking parse warnings
  history: [],        // cleaning history: [{ label, detail, affected, time, datasetBefore }]
  ui: {
    route: null,      // null = landing; otherwise a workspace view key
    routeParams: {},
  },
};

/* ---------- Change notification ---------- */

const listeners = [];

export function onChange(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function emit(topic) {
  for (const fn of listeners) fn(topic);
}

/* ---------- Mutators ---------- */

/** Load a freshly parsed dataset. The original is frozen and never mutated. */
export function loadDataset(dataset, warnings = []) {
  deepFreeze(dataset);
  state.dataset.original = dataset;
  state.dataset.working = dataset;
  state.dataset.fileName = dataset.name;
  state.dataset.sizeBytes = state.dataset.original.sizeBytes ?? 0;
  state.dataset.loadedAt = new Date();
  state.warnings = warnings;
  state.history = []; // a fresh dataset starts with an empty cleaning history
  state.profile = null; // orchestrator computes and sets it
  emit("dataset");
}

/** Swap the working dataset (cleaning arrives in a later milestone). */
export function replaceWorking(dataset) {
  deepFreeze(dataset);
  state.dataset.working = dataset;
  state.profile = null; // orchestrator recomputes and sets it
  emit("dataset");
}

/* ---------- Cleaning history (Milestone 6) ----------
   Model: each successful op pushes { datasetBefore, ...entry }.
   UNDO restores the snapshot — the previous working state object,
   never an inverse-operation reconstruction. Memory note: rows are
   shared structurally between snapshots (copy-on-write in
   cleaning.js), so history costs only the changed rows. */

/** Record a successful cleaning op: entry from cleaning.js's summary. */
export function pushHistory(entry, datasetBefore) {
  state.history.push({
    label: entry.label,
    detail: entry.detail,
    affected: entry.affected ?? 0,
    columnIds: entry.columnIds ?? null,
    time: new Date(),
    datasetBefore, // frozen snapshot for undo
  });
  emit("history");
}

/** Can the last operation be undone? */
export function canUndo() {
  return state.history.length > 0;
}

/**
 * Undo the latest operation: restore its before-snapshot and drop
 * the entry. Returns the restored dataset or null when empty.
 */
export function undoLast() {
  const entry = state.history.pop();
  if (!entry) return null;
  state.dataset.working = entry.datasetBefore;
  state.profile = null;
  emit("history");
  emit("dataset");
  return state.dataset.working;
}

/** Reset everything back to the pristine original (§18). */
export function resetToOriginal() {
  state.dataset.working = state.dataset.original; // the frozen original itself
  state.history = [];
  state.profile = null;
  emit("history");
  emit("dataset");
  return state.dataset.working;
}

export function getHistory() {
  return state.history;
}

/** Has the working dataset been cleaned at all? */
export function isCleaned() {
  return state.history.length > 0;
}

/** Store analysis results for the current working dataset. */
export function setAnalysis(profile, health, quality, insights = null) {
  state.profile = profile;
  state.health = health;
  state.quality = quality ?? null;
  state.insights = insights; // recomputed by the caller in the same pass — never stale
  emit("dataset");
}

/** Navigate: route keys match sidebar items; null returns to landing. */
export function setRoute(route, params = {}) {
  state.ui.route = route;
  state.ui.routeParams = params;
  emit("route");
}

/** One-shot deep-link params (e.g. ?rows=27) — consumed by the target view. */
export function clearRouteParams() {
  state.ui.routeParams = {};
}

export function setWarnings(warnings) {
  state.warnings = warnings;
}

export function getState() {
  return state;
}

/* ---------- Internals ---------- */

function deepFreeze(obj) {
  if (obj && !Object.isFrozen(obj) && typeof obj === "object") {
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
      deepFreeze(obj[key]);
    }
  }
}

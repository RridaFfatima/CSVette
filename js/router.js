/* ============================================================
   CSVette — router.js
   Hash-based routing: #/overview, #/table, … and "" for landing.
   The guard sends users without a dataset back to the landing
   page — no way to reach a broken empty workspace.
   ============================================================ */

import { getState } from "./state.js";

export const WORKSPACE_ROUTES = new Set([
  "overview", "table", "stats",
  // Data Health (placeholder views until their milestones)
  "health", "missing", "duplicates", "outliers", "consistency", "types", "identifiers",
  // Visualize
  "charts", "correlations",
  // Clean
  "clean", "history",
  // Export
  "export-csv", "report",
]);

/** Parse "#/table" → { route: "table", params: {} }; "#/table?col=age&rows=27" → params { col, rows }.
 *  "" / "#foo" / "#" → null (landing). */
export function parseHash(hash) {
  if (!hash || !hash.startsWith("#/")) return null;
  const [routePart, queryPart] = hash.slice(2).split("?");
  const route = routePart.replace(/\/+$/, "");
  if (route === "") return null;

  const params = {};
  if (queryPart) {
    for (const pair of queryPart.split("&")) {
      const eq = pair.indexOf("=");
      if (eq === -1) {
        if (pair) params[decodeURIComponent(pair)] = "";
      } else {
        const key = decodeURIComponent(pair.slice(0, eq));
        params[key] = decodeURIComponent(pair.slice(eq + 1));
      }
    }
  }
  return { route, params };
}

/** Navigate: navigate("table", { col: "age" }) → "#/table?col=age". */
export function navigate(route, params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  const query = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const target = route === null ? "#/" : `#/${route}${query ? `?${query}` : ""}`;
  if (location.hash === target) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    location.hash = target;
  }
}

/** Start listening. onRoute(routeOrNull) fires on every change + once at boot. */
export function startRouter(onRoute) {
  function handle() {
    const parsed = parseHash(location.hash);
    const route = parsed === null ? null : parsed.route;
    const params = parsed === null ? {} : parsed.params;

    // Guard: workspace routes need a dataset.
    if (route !== null && !getState().dataset.working) {
      // Replace the bad hash so Back doesn't bounce into the guard forever.
      history.replaceState(null, "", location.pathname + "#/");
      onRoute(null, params);
      return;
    }

    // Unknown workspace routes fall back to Overview.
    if (route !== null && !WORKSPACE_ROUTES.has(route)) {
      location.hash = "#/overview";
      return;
    }

    onRoute(route, params);
  }

  window.addEventListener("hashchange", handle);
  handle(); // initial dispatch
}

/* ============================================================
   CSVette — views/landing.js
   The landing experience. index.html contains the full landing
   markup inside <template id="tpl-landing">; this module clones
   it, remembers the node, and mounts/unmounts it as routing
   moves between landing and workspace. Views stay thin: all
   state changes flow through app.js handlers.
   ============================================================ */

let landingRoot = null;

/** Clone the landing template once and remember it. */
export function initLandingView() {
  const tpl = document.getElementById("tpl-landing");
  landingRoot = tpl.content.firstElementChild.cloneNode(true);
  return landingRoot;
}

/** Re-mount the cached landing node. */
export function renderLanding(container) {
  container.replaceChildren(landingRoot);
  return landingRoot;
}

/** Show/hide the upload progress bar inside the hero. */
export function setUploadProgress(container, visible) {
  const bar = container.querySelector(".upload-progress");
  if (bar) bar.hidden = !visible;
}

/** Render a landing-page load error (replaces the hero note area). */
export function setLandingError(container, message) {
  const slot = container.querySelector("#landing-error-slot");
  if (!slot) return;
  slot.replaceChildren();

  if (!message) return;

  const alert = document.createElement("div");
  alert.className = "alert alert-critical";
  alert.setAttribute("role", "alert");

  const title = document.createElement("div");
  title.className = "alert-title";
  title.textContent = "Couldn't load that file";

  const body = document.createElement("div");
  body.className = "alert-body";
  body.textContent = message;

  alert.append(title, body);
  slot.append(alert);
}

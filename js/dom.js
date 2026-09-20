/* ============================================================
   CSVette — dom.js
   Tiny DOM helpers. Dynamic content must go through these so
   dataset values are always inserted as text, never as HTML.
   ============================================================ */

/**
 * Create an element.
 * @param {string} tag - element tag name
 * @param {Object} [attrs] - attributes/props: class, id, type, href, ariaLabel, dataset, onClick…
 * @param {string|Node|Array<string|Node>} [children] - text (safe) and/or nodes
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = null) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === "class") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = value; // safe by construction
    } else if (key === "html") {
      throw new Error("dom.el(): use text/children, never innerHTML, for dynamic content");
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "dataset" && typeof value === "object") {
      Object.assign(node.dataset, value);
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }

  if (children !== null) {
    const list = Array.isArray(children) ? children : [children];
    for (const child of list) {
      if (child === null || child === undefined) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
  }

  return node;
}

/** Get the first element matching a selector (throws if missing — typos fail loudly). */
export function $ (selector, root = document) {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`dom.$: no element matches "${selector}"`);
  return found;
}

/**
 * Two-step destructive-action button — CSVette's replacement for native
 * confirm() dialogs, which freeze the whole page thread.
 *
 * First click arms the button (it switches to confirmLabel); a second click
 * runs onConfirm. Clicking anywhere else, or waiting 6 seconds, disarms it.
 */
export function confirmButton({ label, confirmLabel = "Confirm", className = "btn btn-danger btn-sm", onConfirm }) {
  let armed = false;
  let timer = null;

  const disarm = () => {
    armed = false;
    btn.textContent = label;
    btn.classList.remove("btn-armed");
    document.removeEventListener("click", onDocClick, true);
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const arm = () => {
    armed = true;
    btn.textContent = confirmLabel;
    btn.classList.add("btn-armed");
    // Capture phase: any click outside the button disarms it. Added during
    // this click's handler, so the arming click itself is never caught.
    document.addEventListener("click", onDocClick, true);
    timer = setTimeout(disarm, 6000);
  };

  const onDocClick = (e) => {
    if (armed && !btn.contains(e.target)) disarm();
  };

  const btn = el("button", {
    class: className,
    type: "button",
    text: label,
    onclick: () => {
      if (!armed) {
        arm();
        return;
      }
      disarm();
      onConfirm();
    },
  });

  return btn;
}

/** Remove an element after a transition (or immediately if none/immediate=true). */
export function removeAfterTransition(node, immediate = false) {
  if (immediate) {
    node.remove();
    return;
  }
  const done = () => node.remove();
  if (getComputedStyle(node).transitionDuration !== "0s") {
    node.addEventListener("transitionend", done, { once: true });
    // Safety net if transitionend never fires
    setTimeout(done, 400);
  } else {
    done();
  }
}

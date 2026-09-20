/* ============================================================
   CSVette — views/chart-render.js
   Hand-rolled SVG chart rendering, styled with the design tokens
   (no chart library — charts must look like CSVette in both
   themes, and every required chart type is geometrically simple).

   Separation of concerns (creative-elevation ready):
     chart-data.js  → WHAT to draw (pure data)
     this module    → HOW to draw it (SVG)
     views/charts.js→ screen composition + builder UI
   ============================================================ */

const W = 680, H = 380;             // logical SVG units (responsive via viewBox)
const M = { top: 16, right: 18, bottom: 46, left: 58 };
const IW = W - M.left - M.right;
const IH = H - M.top - M.bottom;

const SVG_NS = "http://www.w3.org/2000/svg";

/* ---------- Small shared helpers ---------- */

export function formatNum(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (Number.isInteger(v)) return v.toLocaleString("en-US");
  return v.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Scale domain → pixel range. */
function scale(d0, d1, r0, r1) {
  const span = d1 - d0 || 1;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** "Nice numbers" tick steps (1/2/5 × 10^k) — deterministic, documented. */
export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) max = min + 1;
  const step0 = (max - min) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2.5 ? 5 : norm >= 1.2 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 1e-6; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return ticks;
}

function tickDecimals(step) {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  return 2;
}

const trunc = (s, n = 11) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/* ---------- Figure scaffold: svg + tooltip ---------- */

/**
 * Create a responsive figure: a viewBox SVG (grows to container width)
 * plus one shared tooltip positioned inside the container.
 * Returns drawing context { svg, g, tip, box }.
 */
function makeFigure(container, { ariaLabel }) {
  const figure = document.createElement("figure");
  figure.className = "chart-figure";

  const scroll = document.createElement("div");
  scroll.className = "chart-scroll";

  const svg = svgEl("svg", {
    class: "chart-svg",
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": ariaLabel ?? "Chart",
    preserveAspectRatio: "xMidYMid meet",
  });

  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  tip.setAttribute("role", "status");

  scroll.append(svg);
  figure.append(scroll, tip);
  container.append(figure);

  const g = svgEl("g", { transform: `translate(${M.left} ${M.top})` });
  svg.append(g);

  const showTip = (build, clientX, clientY) => {
    tip.replaceChildren();
    build(tip);
    tip.hidden = false;
    const rect = figure.getBoundingClientRect();
    let x = clientX - rect.left + 12;
    let y = clientY - rect.top - 12;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    if (x + tw > rect.width - 4) x = clientX - rect.left - tw - 12;
    if (y + th > rect.height - 4) y = rect.height - th - 4;
    if (y < 4) y = 4;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const hideTip = () => { tip.hidden = true; };

  return { svg, g, showTip, hideTip, figure };
}

/* ---------- Axes ---------- */

function drawYAxis(ctx, { ticks, fmt, yLabel, yScale }) {
  const { g, svg } = ctx;
  for (const t of ticks) {
    const y = yScale(t);
    g.append(svgEl("line", {
      x1: 0, x2: IW, y1: y, y2: y,
      class: "chart-grid",
      "shape-rendering": "crispEdges",
    }));
    const lbl = svgEl("text", { x: -8, y: y + 3.5, class: "chart-tick", "text-anchor": "end" });
    lbl.textContent = fmt(t);
    g.append(lbl);
  }
  g.append(svgEl("line", {
    x1: 0, x2: IW, y1: IH, y2: IH,
    class: "chart-axis",
    "shape-rendering": "crispEdges",
  }));
  if (yLabel) {
    // Top-left, above the plot area — inside the viewBox (a rotated
    // side label costs more readability than it buys).
    const lbl = svgEl("text", { x: 6, y: 14, class: "chart-axis-label" });
    lbl.textContent = yLabel;
    svg.append(lbl);
  }
}

function drawXAxis(ctx, { positions, labels, y = IH, cls = "chart-tick" }) {
  const { g } = ctx;
  positions.forEach((x, i) => {
    const lbl = svgEl("text", { x, y: y + 16, class: cls, "text-anchor": "middle" });
    lbl.textContent = labels[i];
    g.append(lbl);
  });
}

/** Centered x-axis title below the tick labels. */
function drawXTitle(ctx, label) {
  if (!label) return;
  const t = svgEl("text", { x: M.left + IW / 2, y: H - 6, class: "chart-axis-label", "text-anchor": "middle" });
  t.textContent = label;
  ctx.svg.append(t);
}

/* ---------- Histogram ---------- */

export function renderHistogram(container, data, { columnLabel }) {
  const maxY = Math.max(...data.bins.map((b) => b.count), 1);
  const tickVals = niceTicks(0, maxY, 5);
  const yScale = scale(0, tickVals[tickVals.length - 1], IH, 0);
  const xScale = scale(data.min, data.max || data.min + 1, 0, IW);

  const ctx = makeFigure(container, { ariaLabel: `Histogram of ${columnLabel}` });
  const step = tickVals[1] - tickVals[0] ?? 1;
  drawYAxis(ctx, {
    ticks: tickVals,
    fmt: (t) => formatNum(+t.toFixed(tickDecimals(step))),
    yLabel: "Rows",
    yScale,
  });
  drawXAxis(ctx, {
    positions: tickVals.slice(0, 6).map((t) => xScale(t)),
    labels: tickVals.slice(0, 6).map((t) => formatNum(+t.toFixed(tickDecimals((data.max - data.min) / 6 || 1)))),
  });
  drawXTitle(ctx, columnLabel);

  const slot = IW / data.bins.length;
  const barW = Math.min(slot * 0.86, 46);
  data.bins.forEach((bin, i) => {
    const x = xScale(bin.x0) + (slot - barW) / 2;
    const y = yScale(bin.count);
    const h = IH - y;
    if (h <= 0) return;
    const rect = svgEl("rect", {
      x, y, width: barW, height: h, rx: 2,
      class: "chart-bar",
      style: `animation-delay:${i * 14}ms`,
      tabindex: "0",
    });
    const build = (tip) => {
      tip.append(
        tipRow(`Range`, `${formatNum(bin.x0)} – ${formatNum(bin.x1)}`),
        tipRow("Rows", String(bin.count)),
      );
    };
    rect.addEventListener("mousemove", (e) => ctx.showTip(build, e.clientX, e.clientY));
    rect.addEventListener("mouseleave", ctx.hideTip);
    ctx.g.append(rect);
  });

  caption(ctx.figure, `${data.bins.length} bins · Freedman–Diaconis binning · ${formatNum(data.min)} to ${formatNum(data.max)}`);
}

/* ---------- Box plot ---------- */

export function renderBox(container, box, { columnLabel }) {
  const lo = Math.min(box.whiskerLow, ...box.outliers.map((o) => o.value));
  const hi = Math.max(box.whiskerHigh, ...box.outliers.map((o) => o.value));
  const pad = (hi - lo) * 0.12 || 1;
  const tickVals = niceTicks(lo - pad, hi + pad, 5);
  const yScale = scale(tickVals[0], tickVals[tickVals.length - 1], IH, 0);

  const ctx = makeFigure(container, { ariaLabel: `Box plot of ${columnLabel}` });
  const step = tickVals[1] - tickVals[0] ?? 1;
  drawYAxis(ctx, {
    ticks: tickVals,
    fmt: (t) => formatNum(+t.toFixed(tickDecimals(step))),
    yLabel: columnLabel,
    yScale,
  });
  // No x title: a single box is the column itself, already named on the y axis.

  const cx = IW / 2;
  const bw = 120;
  const q1y = yScale(box.q1), q3y = yScale(box.q3), medY = yScale(box.median);
  const wloY = yScale(box.whiskerLow), whiY = yScale(box.whiskerHigh);

  // whiskers
  ctx.g.append(svgEl("line", { x1: cx, x2: cx, y1: wloY, y2: q1y, class: "chart-whisker" }));
  ctx.g.append(svgEl("line", { x1: cx, x2: cx, y1: q3y, y2: whiY, class: "chart-whisker" }));
  for (const [y, pos] of [[wloY, "Whisker low"], [whiY, "Whisker high"]]) {
    const cap = svgEl("line", { x1: cx - 22, x2: cx + 22, y1: y, y2: y, class: "chart-whisker" });
    cap.addEventListener("mousemove", (e) => ctx.showTip((tip) => tipRow2(tip, pos, formatNum(pos === "Whisker low" ? box.whiskerLow : box.whiskerHigh)), e.clientX, e.clientY));
    cap.addEventListener("mouseleave", ctx.hideTip);
    ctx.g.append(cap);
  }

  // box + median
  const boxRect = svgEl("rect", {
    x: cx - bw / 2, y: Math.min(q1y, q3y),
    width: bw, height: Math.abs(q3y - q1y) || 2, rx: 3,
    class: "chart-box",
    tabindex: "0",
  });
  boxRect.addEventListener("mousemove", (e) => ctx.showTip((tip) => {
    tip.append(
      tipRow("Q1", formatNum(box.q1)),
      tipRow("Median", formatNum(box.median)),
      tipRow("Q3", formatNum(box.q3)),
      tipRow("IQR", formatNum(box.iqr)),
    );
  }, e.clientX, e.clientY));
  boxRect.addEventListener("mouseleave", ctx.hideTip);
  ctx.g.append(boxRect);

  const medianLine = svgEl("line", { x1: cx - bw / 2, x2: cx + bw / 2, y1: medY, y2: medY, class: "chart-median" });
  medianLine.addEventListener("mousemove", (e) => ctx.showTip((tip) => tipRow2(tip, "Median", formatNum(box.median)), e.clientX, e.clientY));
  medianLine.addEventListener("mouseleave", ctx.hideTip);
  ctx.g.append(medianLine);

  // potential outliers — neutral wording, never "error"
  box.outliers.forEach((o, i) => {
    const c = svgEl("circle", {
      cx, cy: yScale(o.value), r: 4,
      class: "chart-outlier",
      style: `animation-delay:${120 + i * 30}ms`,
      tabindex: "0",
    });
    c.addEventListener("mousemove", (e) => ctx.showTip((tip) => {
      tip.append(tipRow("Potential outlier", formatNum(o.value)), tipRow("Row", String(o.rowNum)));
    }, e.clientX, e.clientY));
    c.addEventListener("mouseleave", ctx.hideTip);
    ctx.g.append(c);
  });

  caption(ctx.figure, `n = ${box.n} · median ${formatNum(box.median)} · IQR ${formatNum(box.iqr)} · whiskers at 1.5 × IQR`);
}

/* ---------- Bar charts (categorical + aggregated) ---------- */

export function renderBarChart(container, data, { xLabel, yLabel, statLabel, countOf }) {
  const cats = data.categories;
  const maxY = Math.max(...cats.map((c) => c.stat), 1);
  const tickVals = niceTicks(0, maxY, 5);
  const yScale = scale(0, tickVals[tickVals.length - 1], IH, 0);

  const ctx = makeFigure(container, { ariaLabel: `Bar chart of ${statLabel ?? xLabel}` });
  const step = tickVals[1] - tickVals[0] ?? 1;
  drawYAxis(ctx, {
    ticks: tickVals,
    fmt: (t) => formatNum(+t.toFixed(tickDecimals(step))),
    yLabel,
    yScale,
  });
  drawXTitle(ctx, xLabel);

  const slot = IW / cats.length;
  const barW = Math.min(slot * 0.66, 56);
  cats.forEach((cat, i) => {
    const x = slot * i + (slot - barW) / 2;
    const y = yScale(cat.stat);
    const h = IH - y;
    if (h <= 0) return;
    const rect = svgEl("rect", {
      x, y, width: barW, height: h, rx: 2,
      class: "chart-bar",
      style: `animation-delay:${i * 24}ms`,
      tabindex: "0",
    });
    const build = (tip) => {
      tip.append(
        tipRow(xLabel, cat.value),
        tipRow(statLabel ?? "Count", formatNum(cat.stat)),
      );
      if (countOf) tip.append(tipRow("Based on", `${countOf(cat)} row${cat.n === 1 ? "" : "s"}`));
    };
    rect.addEventListener("mousemove", (e) => ctx.showTip(build, e.clientX, e.clientY));
    rect.addEventListener("mouseleave", ctx.hideTip);
    ctx.g.append(rect);

    const lbl = svgEl("text", { x: slot * i + slot / 2, y: IH + 16, class: "chart-tick", "text-anchor": "middle" });
    lbl.textContent = trunc(cat.value);
    ctx.g.append(lbl);
  });

  const parts = [`${cats.length} categories`];
  if (data.omitted > 0) parts.push(`top ${cats.length} of ${data.totalCategories} shown — ${data.omittedCount ?? data.omitted} rows in smaller categories not displayed`);
  if (data.skipped > 0) parts.push(`${data.skipped} row${data.skipped === 1 ? "" : "s"} skipped (missing values)`);
  caption(ctx.figure, parts.join(" · "));
}

/* ---------- Scatter ---------- */

export function renderScatter(container, data, { xLabel, yLabel }) {
  const xs = data.points.map((p) => p.x);
  const ys = data.points.map((p) => p.y);
  const xTicks = niceTicks(Math.min(...xs), Math.max(...xs), 5);
  const yTicks = niceTicks(Math.min(...ys), Math.max(...ys), 5);
  const xScale = scale(xTicks[0], xTicks[xTicks.length - 1], 0, IW);
  const yScale = scale(yTicks[0], yTicks[yTicks.length - 1], IH, 0);

  const ctx = makeFigure(container, { ariaLabel: `Scatter plot of ${xLabel} and ${yLabel}` });
  const xStep = xTicks[1] - xTicks[0] ?? 1;
  const yStep = yTicks[1] - yTicks[0] ?? 1;
  drawYAxis(ctx, {
    ticks: yTicks,
    fmt: (t) => formatNum(+t.toFixed(tickDecimals(yStep))),
    yLabel,
    yScale,
  });
  drawXAxis(ctx, {
    positions: xTicks.slice(0, 7).map((t) => xScale(t)),
    labels: xTicks.slice(0, 7).map((t) => formatNum(+t.toFixed(tickDecimals(xStep)))),
  });
  drawXTitle(ctx, xLabel);

  const dense = data.points.length > 400;
  data.points.forEach((p, i) => {
    const c = svgEl("circle", {
      cx: xScale(p.x), cy: yScale(p.y),
      r: dense ? 2.4 : 3.6,
      class: dense ? "chart-point chart-point-dense" : "chart-point",
      style: `animation-delay:${Math.min(i * 4, 400)}ms`,
      tabindex: "0",
    });
    c.addEventListener("mousemove", (e) => ctx.showTip((tip) => {
      tip.append(tipRow(xLabel, formatNum(p.x)), tipRow(yLabel, formatNum(p.y)), tipRow("Row", String(p.rowNum)));
    }, e.clientX, e.clientY));
    c.addEventListener("mouseleave", ctx.hideTip);
    ctx.g.append(c);
  });

  caption(ctx.figure, `${data.points.length} observations · both values required` +
    (data.skipped > 0 ? ` · ${data.skipped} row${data.skipped === 1 ? "" : "s"} skipped (missing values)` : ""));
}

/* ---------- Line (time series) ---------- */

export function renderLine(container, data, { xLabel, yLabel }) {
  const ts = data.points.map((p) => p.t);
  const vs = data.points.map((p) => p.value);
  const pad = (Math.max(...vs) - Math.min(...vs)) * 0.15 || 1;
  const yTicks = niceTicks(Math.min(...vs) - pad, Math.max(...vs) + pad, 5);
  const xScale = scale(Math.min(...ts), Math.max(...ts) || Math.min(...ts) + 86400000, 0, IW);
  const yScale = scale(yTicks[0], yTicks[yTicks.length - 1], IH, 0);

  const ctx = makeFigure(container, { ariaLabel: `Line chart of ${yLabel} over ${xLabel}` });
  const yStep = yTicks[1] - yTicks[0] ?? 1;
  drawYAxis(ctx, {
    ticks: yTicks,
    fmt: (t) => formatNum(+t.toFixed(tickDecimals(yStep))),
    yLabel,
    yScale,
  });
  // Time ticks: evenly spread observations (date formatting, not numeric ticks)
  const tickIdx = evenlySpacedIndices(data.points.length, Math.min(6, data.points.length));
  drawXAxis(ctx, {
    positions: tickIdx.map((i) => xScale(data.points[i].t)),
    labels: tickIdx.map((i) => data.points[i].label),
  });
  drawXTitle(ctx, xLabel);

  // Area fill (subtle) then line then points
  const pts = data.points.map((p) => `${xScale(p.t).toFixed(1)},${yScale(p.value).toFixed(1)}`);
  const area = svgEl("path", {
    d: `M${xScale(data.points[0].t)},${IH} L${pts.join(" L")} L${xScale(data.points[data.points.length - 1].t)},${IH} Z`,
    class: "chart-area",
  });
  ctx.g.append(area);
  const line = svgEl("path", {
    d: `M${pts.join(" L")}`,
    class: "chart-line",
    fill: "none",
  });
  ctx.g.append(line);

  data.points.forEach((p, i) => {
    const c = svgEl("circle", {
      cx: xScale(p.t), cy: yScale(p.value), r: 3.4,
      class: "chart-point",
      style: `animation-delay:${Math.min(i * 20, 500)}ms`,
      tabindex: "0",
    });
    c.addEventListener("mousemove", (e) => ctx.showTip((tip) => {
      tip.append(tipRow(xLabel, p.label), tipRow(`${yLabel} (${data.agg})`, formatNum(p.value)), tipRow("Rows on this date", String(p.n)));
    }, e.clientX, e.clientY));
    c.addEventListener("mouseleave", ctx.hideTip);
    ctx.g.append(c);
  });

  caption(ctx.figure, `${data.points.length} date${data.points.length === 1 ? "" : "s"} · ${data.agg} per day` +
    (data.skipped > 0 ? ` · ${data.skipped} row${data.skipped === 1 ? "" : "s"} skipped (missing/unparseable)` : ""));
}

function evenlySpacedIndices(n, count) {
  if (count >= n) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: count }, (_, i) => Math.round((i * (n - 1)) / (count - 1)));
}

/* ---------- Tooltip / caption primitives ---------- */

function tipRow(label, value) {
  const row = document.createElement("p");
  row.className = "tip-row";
  const l = document.createElement("span");
  l.className = "tip-label";
  l.textContent = label;
  row.append(l, document.createTextNode(value));
  return row;
}

function tipRow2(tip, label, value) {
  tip.append(tipRow(label, value));
}

function caption(figure, text) {
  const cap = document.createElement("figcaption");
  cap.className = "chart-caption caption muted";
  cap.textContent = text;
  figure.append(cap);
}

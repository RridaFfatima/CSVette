# CSVette — Design System

Status: design agreed before implementation. Extends `docs/UX-ARCHITECTURE.md`; referenced by the technical-architecture and milestone prompts. No code yet.

The design intent in one sentence: **a calm, dense, trustworthy analytical tool — graphite surfaces, crisp borders instead of glow, one teal accent, and real data typography.**

What makes it *not* look like a generic AI dashboard: no glassmorphism, no gradient hero, no neon-on-black, no oversized rounding, no shadow soup. Structure comes from borders, spacing rhythm, alignment, and typography — not decoration.

---

## 1. Design tokens

All tokens are CSS custom properties defined once in `css/variables.css`, scoped to `:root` (light) and `[data-theme="dark"]`. Components never use raw hex values — only tokens.

### 1.1 Radii, borders, shadows

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 4px | inputs, badges, small chips |
| `--radius-md` | 6px | buttons, cards, dropdowns, modals |
| `--radius-lg` | 8px | large containers, full-screen table |
| `--border` | 1px solid var(--border-color) | the primary structural device |
| `--shadow-1` | `0 1px 2px rgba(16,20,24,.05)` | cards (light theme; dark theme uses borders only) |
| `--shadow-2` | `0 4px 16px rgba(16,20,24,.10)` | modals, popovers, toasts |

Rules: **borders first, shadows second.** Elevated layers (modals, popovers) are the only strong shadows. No glows, no multi-layer shadow stacks.

### 1.2 Focus ring

`--focus-ring: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent)` — a 2px accent ring with a surface-colored gap, applied via `:focus-visible` everywhere. Never removed, never replaced with a color change alone.

---

## 2. Typography

| Role | Font | Notes |
|---|---|---|
| UI & body | **IBM Plex Sans** (Google Fonts, OFL) | distinctive, engineered, analytical character; avoids the default-Inter look |
| Data & numerics | **IBM Plex Mono** | all data values, counts, scores, statistics, table numerics |
| Fallbacks | `system-ui, -apple-system, "Segoe UI", sans-serif` / `ui-monospace, "SF Mono", Consolas, monospace` | app must remain fully usable if the CDN is blocked |

### 2.1 Scale

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| Display | 32px / 40px | 600 | landing headline |
| H1 | 24px / 32px | 600 | screen titles |
| H2 | 18px / 26px | 600 | card/section titles |
| H3 | 15px / 22px | 600 | sub-sections, table card titles |
| Body | 14px / 22px | 400 | default UI text |
| Body-strong | 14px / 22px | 500 | emphasized labels, nav items |
| Caption | 12.5px / 18px | 400 | helper text, meta, axis notes |
| Overline | 11px / 16px | 600, `letter-spacing: .08em`, uppercase | sidebar group labels, table headers |
| Data | 13.5px / 20px | 400, **tabular numerals** | table cells, stats, badges with counts |
| Data-lg | 40px / 44px | 600, mono | health score hero number |

Weights used: 400, 500, 600 only. Line heights are generous (≥1.5 for body) because this is a reading-heavy product.

---

## 3. Color system

Neutral graphite core + one teal accent + four severity hues. Every pair below meets WCAG AA (≥4.5:1 for normal text, ≥3:1 for large text/icons) against its stated background.

### 3.1 Light theme ("Paper")

| Token | Value | On | Contrast |
|---|---|---|---|
| `--bg` | `#F6F7F8` page background | — | — |
| `--surface` | `#FFFFFF` cards, sidebar, table | — | — |
| `--surface-2` | `#EFF1F3` hovers, skeletons, subtle fills | — | — |
| `--elevated` | `#FFFFFF` + `--border` + `--shadow-2` | modals, popovers | — |
| `--border-color` | `#E2E5E9` | on surface | — |
| `--border-strong` | `#CBD1D8` | inputs, hover borders | — |
| `--text` | `#191D21` | on `--bg`/`--surface` | ≈15:1 |
| `--text-2` | `#454C54` | secondary text | ≈8:1 |
| `--text-3` | `#6B727B` | muted text, captions | ≈4.9:1 |
| `--accent` | `#0F766E` deep teal | links, active nav, primary buttons | white-on-accent ≈4.9:1 |
| `--accent-strong` | `#0B5D57` | accent hover | — |
| `--accent-soft` | `#E4F2F0` | selected rows, accent-tinted fills | — |
| `--success` | `#067647` | healthy states | ≈5.6:1 |
| `--warning` | `#B54708` | warnings | ≈5.3:1 |
| `--critical` | `#B42318` | critical issues, errors | ≈6:1 |
| `--info` | `#175CD3` | informational | ≈5.5:1 |
| severity tints | success `#ECFDF3` · warning `#FFFAEB` · critical `#FEF3F2` · info `#EFF8FF` | badge/alert backgrounds | — |

### 3.2 Dark theme ("Graphite")

Charcoal, never pure black. Same token names, re-valued:

| Token | Value |
|---|---|
| `--bg` | `#17191C` |
| `--surface` | `#1E2125` |
| `--surface-2` | `#26292E` |
| `--elevated` | `#24282D` + `--border` |
| `--border-color` | `#34383E` |
| `--border-strong` | `#474C53` |
| `--text` | `#E7EAED` (≈13:1) |
| `--text-2` | `#A9B0B8` (≈7:1) |
| `--text-3` | `#878E96` (≈4.6:1) |
| `--accent` | `#3FBDAF` (≈7:1 on `--bg`) |
| `--accent-strong` | `#5ED0C4` hover |
| `--accent-soft` | `#1B3330` |
| `--success` | `#4ADE80` · `--warning` `#FBBF24` · `--critical` `#F87171` · `--info` `#7DABF8` |
| severity tints | success `#12291C` · warning `#2E2410` · critical `#2E1614` · info `#14243B` |
| shadows | replaced by stronger borders; `--shadow-2` kept only for `--elevated` |

### 3.3 Usage rules

- Accent is **scarce**: active nav, primary buttons, links, focus rings, the health-score meter fill. If everything is teal, nothing is.
- Neutrals carry the product; severity colors appear only where data quality is being communicated.
- Never encode meaning in color alone (see §4).
- Dark theme is a first-class theme — all components are checked in both, and Plotly charts re-theme on toggle.

---

## 4. Data-quality severity treatment

Consistent, four-part treatment used identically in sidebar badges, attention cards, alerts, table cells, and the report:

| Severity | Icon (Lucide, 16px) | Label | Text/icon color | Fill |
|---|---|---|---|---|
| Critical | `octagon-alert` | "Critical" | `--critical` | critical tint |
| Warning | `triangle-alert` | "Warning" | `--warning` | warning tint |
| Info | `info` | "Info" | `--info` | info tint |
| Healthy | `check` | "OK" / "No issues" | `--success` | success tint (used sparingly) |

Every severity instance = **icon + text label (+ count)** — color is redundant, never primary. Count badges in the sidebar are mono, right-aligned: `· 8`. A zero-findings row shows the check icon and dimmed text, communicating "checked, clean" rather than "not analyzed".

---

## 5. Spacing system

4px base grid. Tokens: `--space-1..10` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.

| Context | Rule |
|---|---|
| Page padding | 32px desktop · 24px laptop · 16px mobile |
| Section spacing | 32px between major screen sections (24px mobile) |
| Card padding | 20–24px (16px mobile) |
| Card grids | 16px gaps, 2 columns ≥1024px, 1 below |
| Sidebar | 16px outer padding; 12px vertical / 12px horizontal per nav item; 16px above group labels |
| Table | cell padding 10px 12px; header 8px 12px; row height ≈40px |
| Forms | 16px between fields; 6px label-to-input; helper text 4px below |
| Buttons | 36px tall (padding 0 14px); 32px compact; icon buttons 32×32 |
| Inline rhythm | 8px between related controls (chips, toolbar buttons) |

Densities: tables and stats use the compact end; marketing/landing uses the generous end.

---

## 6. Components

All share: 6px radius (unless noted), 1px border, focus ring per §1.2, disabled = 45% opacity + `cursor: not-allowed` + a visible reason per the UX spec.

**Buttons** — Primary: accent fill, white text (dark theme: accent fill, `#0B1F1D` text). Secondary: `--surface` fill + border, `--text`. Ghost: transparent, `--text-2`, hover `--surface-2`. Danger: critical fill, used only in confirms. Loading state: spinner replaces label, width preserved.

**Icon buttons** — 32×32, 18px Lucide icon, `aria-label` mandatory, tooltip on hover/focus.

**Cards** — `--surface`, 1px border, `--shadow-1`, 6px radius. Card header pattern: H2 title left, caption/meta or action right. No drop-shadow stacking, no hover lift on non-interactive cards.

**Badges & chips** — Type chips (column types): mono 12px, `--surface-2` fill, border. Severity badges per §4. Filter chips: label + × button, `--accent-soft` fill.

**Alerts** — Severity tint fill, 1px severity-color border-left (3px), icon + bold label + message; optional action link. Used for errors and standing notices (e.g. correlation ≠ causation lives in the Correlations screen as an info alert).

**Toasts** — Bottom-right (bottom-center mobile), `--elevated`, `--shadow-2`, 4s auto-dismiss, one visible action max (**Undo**). Success toast: check icon; never severity-colored unless it's an error path (errors use banners/dialogs instead).

**Modals / confirms** — `--elevated` panel, max-width 440px, dimmed `rgba(12,14,16,.5)` scrim, focus trapped, Esc closes, title + explanation + Cancel/primary action. Destructive primary is a Danger button.

**Dropdowns / selects / popovers** — `--elevated`, 8px max visible items with scroll, keyboard navigable (arrows, Enter, Esc), selected item gets check icon, 6px radius, `--shadow-2`. Native `<select>` styled to match where a custom list isn't needed.

**Inputs / search** — 36px tall, `--surface` fill, `--border-strong` border, 6px radius; focus = accent border + ring. Search inputs get a magnifier icon and a clear (×) button when non-empty. Invalid input: critical border + inline message (not just red border).

**Tabs / segmented controls** — Used inside screens (e.g. Clean preview Before/After). Underline style: 2px accent underline on active, `--text-2` inactive; `role="tablist"` semantics.

**Tooltips** — Dark `--elevated` (inverse in light theme), 12.5px caption, 150ms fade, Esc/hover-out dismisses, never the sole carrier of information.

**Empty states** — Centered in the card: 24px muted Lucide icon, one-sentence explanation, one action button. No illustrations, no emoji.

**Loading states** — Skeleton blocks (`--surface-2`, 6px radius, subtle shimmer) for layout-shaped loading; indeterminate 2px progress bar under the header for parsing; staged text per the UX spec ("Profiling columns…"). Skeletons disappear entirely under `prefers-reduced-motion`.

**Error states** — Inline for field errors; alert card for screen-level errors with what/why/next-actions per the UX spec.

---

## 7. Sidebar

- **Width:** 264px fixed (240px at 1024–1279px); `--surface` background, 1px `--border-color` right edge. Mobile: off-canvas drawer (breakpoint in §12).
- **Header:** wordmark "CSVette" — H2-size, 600, with the "C" set in accent? No — keep it monochrome: "CSV" in `--text` + "ette" in `--text-3`. Below it, 12.5px caption "CSV analysis, in your browser." No logo illustration.
- **Group labels:** overline style (11px uppercase, `--text-3`), 16px top margin.
- **Items:** 36px tall, 14px/500, 18px Lucide icon, label, count badge right-aligned in mono. Hover: `--surface-2`. Focus: ring. **Active:** `--accent-soft` fill + 2px accent left bar + `--text` + `aria-current="page"` — recognizable at a glance, in peripheral vision, and by position (not color alone: fill + bar + weight change).
- **Badge with findings:** `--text-2` mono; zero-findings: check icon, `--text-3`.
- **Footer:** 12.5px caption privacy line with a `lock` icon: "Your data stays in your browser."
- No collapse-to-rail mode (not needed at these widths; drawer covers small screens).

---

## 8. Dashboard (Overview)

Vertical hierarchy, most important first:

1. **Header strip** — dataset name (H1) + `1,204 rows × 18 columns` in mono chips.
2. **Health score card** — the visual anchor: 40px mono score, band label as a severity badge, thin 4px accent meter, four dimension values (Completeness/Uniqueness/Consistency/Validity) as mono numbers with mini-bars, "See why →" link. Never a big glowing gauge or radial chart.
3. **Stat strip** — 6 equal cells (missing cells, duplicate rows, numeric/categorical/date/boolean columns, potential outliers): caption label over mono value. Grid, not decorated tiles.
4. **"What needs your attention?"** — H2; grid of attention cards (2-col desktop). Card: severity icon + title, count in mono ("23 missing values"), caption ("4 columns affected"), "View details →" accent link. Cards are bordered by severity tint + 3px left border; ordered Critical → Warning → Info. All-clear: single calm card with check icon and next-step links.
5. **Column table** — dense per-column rows (name, type chip, missing % bar, unique count) per the UX spec.
6. **Quick actions** — a row of secondary buttons (Open data table · Make a chart · Clean data · Export). Below the fold; analysis first, actions second.
7. **Recent cleaning activity** — last 3 history entries as caption lines with Undo link; hidden when history is empty.

Decoration budget for the whole dashboard: zero illustrations, zero gradients, one accent meter.

---

## 9. Data tables

- **Header:** overline style, `--surface-2` background, sticky top, sortable headers show ↑/↓/↕ icon (↕ = sortable, not sorted) — direction is icon + text semantics (`aria-sort`), never color alone.
- **Row height:** ≈40px, 1px row separators (`--border-color` at 60% opacity). Hover: `--surface-2`. No zebra striping (hover + separators are enough; zebra fights horizontal scanning).
- **Numeric columns:** right-aligned, mono, tabular numerals. Headers of numeric columns right-aligned too.
- **Missing cells:** muted `—` (em dash) + small `circle-dashed` icon with `aria-label="missing"`; light warning tint on the cell in both themes.
- **Long values:** truncate with ellipsis at ~48ch; full value in tooltip + expands on cell click in a detail popover.
- **Row numbers:** sticky left column, mono, `--text-3`, showing original row indices.
- **Filter/sort status:** the active-filter chip bar + status line from the UX spec sit directly above the table — always visible.
- **Responsive:** ≥768px — full table, sticky header + row-number column, horizontal scroll for overflow. <768px — same scroll approach (no card-per-row transformation; analysts need columns), but filter menus become bottom sheets and the toolbar collapses to two rows.
- Full-screen mode: table fills viewport, `--radius-lg` container, Esc exits.

---

## 10. Charts

- **Container:** standard card; title H3, one-line caption description (e.g. "Count of orders per region — 1,196 rows plotted"), chart area, optional footer caption.
- **Library:** Plotly.js, themed to tokens: transparent plot background, `--border-color` gridlines (horizontal only by default), `--text-2` axis titles (caption size), `--text-3` tick labels, hover = `--elevated` box with `--text`.
- **Legend:** hidden for single-series charts; bottom-placed, caption-size for multi-series.
- **Categorical palette (colorblind-aware, muted):**
  light: `#0F766E · #3B5B92 · #B45309 · #6D5BA6 · #0E7490 · #9A3412 · #4D7C0F · #64748B`
  dark: `#3FBDAF · #7C9CD6 · #E8A13D · #A493D9 · #5BB8CB · #E08A63 · #8FB65A · #94A3B8`
- **Diverging (correlations):** `#3B5B92 → #E5E7EB → #B42318` (light) / `#7C9CD6 → #3A3F45 → #F87171` (dark).
- **Sequential:** surface-2 → accent ramp.
- **Empty state:** "Choose columns to build a chart" with a link to recommendations. **Loading:** skeleton plot-sized block. **Too much data:** aggregate or warn ("3,000+ points — showing a sample; values may be binned").
- Every chart card offers "View as table" — the same data as an accessible table (charts never gate information).
- Responsive: Plotly `responsive: true`; on mobile, builder controls stack above the chart.

---

## 11. Theme rules

- Tokens only — theming is a variable swap, `:root` vs `[data-theme="dark"]`.
- Default: follow `prefers-color-scheme` on first visit; user toggle (light/dark) persists to `localStorage` (`csvette.theme`) and wins thereafter.
- Theme is applied **before first paint** (inline snippet in `<head>`) to prevent flash-of-wrong-theme.
- Both themes are designed, not derived: dark uses charcoal (not inverted white), severity tints are re-chosen for dark, Plotly themes re-apply on toggle, charts/tables/scratch states verified in both.
- The workspace always renders in the active theme; the landing preview mock shows the current theme too.

---

## 12. Responsive rules

Breakpoints: **640** (mobile), **768** (tablet), **1024** (laptop / drawer switch), **1280** (desktop), **1536** (wide).

| Range | Sidebar | Layout |
|---|---|---|
| ≥1280 | persistent 264px | two-pane screens side by side; content max 1200px |
| 1024–1279 | persistent 240px | two-pane screens stack below 1100px |
| 768–1023 | **off-canvas drawer** (hamburger) | single column; card grids 2-col where space allows |
| <768 | drawer, full-width | single column; bottom-sheet filter menus; 44px touch targets; toolbar compresses |

(This fixes the provisional "~900px" drawer switch from the UX architecture doc at 1024px — tablet landscape keeps the full nav.)

Forms: labels above inputs always (no side-by-side labels below 1024). Cards go single-column below 768. The stat strip wraps 6 → 3 → 2 cells. Charts: height clamps (240–420px) and Plotly responsive config. Tables: per §9.

---

## 13. Motion

Purposeful, fast, rare. Durations: **120ms** hover/focus color changes, **180ms** drawer slide + scrim fade, **200ms** modal fade/scale (0.98→1) and toast slide-up, skeletons shimmer at 1.4s. Easing: `ease-out` for entrances, `ease-in` for exits. No animation on route swaps — the workspace updates in place (a 120ms fade on the workspace container at most). No parallax, no scroll-triggered animation, no looping animation except the indeterminate progress bar.

**`prefers-reduced-motion: reduce`** → all transitions/animations off (values applied instantly); skeletons become static blocks; the progress bar stays (it's informative, and rendered without motion).

---

## 14. Accessibility notes (visual system)

- All token pairs meet AA contrast as listed in §3; both themes verified.
- Focus is always visible (`:focus-visible` ring, §1.2) and never suppressed.
- Severity/status = icon + text + color (§4); charts get text alternatives (§10); table semantics per the UX spec.
- Type never below 12.5px; interactive targets ≥32px (44px on touch).
- Dark theme avoids pure black and pure white to reduce halation.

---

## 15. Open items for the next prompt

- Module/file layout that carries these tokens (`css/variables.css`, `style.css`, `components.css`, `responsive.css` boundaries) → **technical architecture**.
- How Plotly theming hooks into the theme toggle → technical architecture.
- Exact MVP component subset to build in Milestone 1 → milestone prompt.

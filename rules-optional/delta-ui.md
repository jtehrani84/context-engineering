# Dense Dashboard Design System ("Delta" Style, opt-in)

> Opt-in rule. It is not installed by `setup.sh`. Copy it to `~/.claude/rules/` if you build internal dashboards or monitoring views and want one consistent dense, dark look. Rules in that folder load into every session, and this one is opinionated (dark background, mono data font, no decoration), so skip it if you have a house style of your own.

## When This Applies
Use it when building: internal dashboards, data views, monitoring UIs, intelligence feeds, graph visualizations, channel digests, analytics, competitive matrices, or anything the user calls "Delta style." Also apply it when the user says "use Delta."

Do not use it for customer-facing slides, case studies, or narrative pages. Those want a lighter, more editorial look (see `tailwind-ui.md`, or a brand rule of your own). A dashboard of metric blocks is data, so `structural-voice.md`'s ban on parallel card grids, which targets argued pages, does not apply here.

## Design Philosophy
Terminal-grade density meets investment-dashboard clarity. This is an instrument panel, not a marketing page. Every pixel shows data or provides navigation to data. Zero decoration. If it doesn't inform a decision, delete it.

## Typography — Mono Data + Sans Narrative
```
Data font:      JetBrains Mono (Google Fonts CDN) — labels, values, metrics, tables, tickers
Narrative font: DM Sans (Google Fonts CDN) — descriptive paragraphs, briefing text, longer explanations
Weights:        200 (ticker/ambient), 300 (body), 400 (labels), 500 (section headers), 600 (values/emphasis), 700 (page title only)
Body size:      14px (narrative), 13px (data/tables)
Line height:    1.65
Features:       font-feature-settings: 'tnum' (tabular numbers on mono elements)
Smoothing:      -webkit-font-smoothing: antialiased
```

### Text Scale
```
Ticker/ambient:  9px uppercase, letter-spacing 0.12em, weight 200, JetBrains Mono
Labels:          10px uppercase, letter-spacing 0.16em, weight 500, JetBrains Mono
Body (data):     13px, weight 300, JetBrains Mono
Body (narrative): 14px, weight 400, DM Sans, line-height 1.7
Values/metrics:  14-18px, weight 600, JetBrains Mono
Section heads:   10px uppercase emerald, letter-spacing 0.16em, JetBrains Mono
Page title:      28-32px, weight 700, letter-spacing -0.02em, DM Sans
```

## Color Palette — Dark, Signal-Based
```css
:root {
    --bg: #111113;
    --card: #18181b;
    --border: #27272a;
    --border-hover: #3f3f46;
    --text: #e4e4e7;
    --text-secondary: #71717a;
    --text-dim: #52525b;
    --text-muted: #3f3f46;
    --emerald: #34d399;
    --emerald-dim: rgba(52, 211, 153, 0.15);
    --amber: #fbbf24;
    --amber-dim: rgba(251, 191, 36, 0.1);
    --red: #f87171;
    --red-dim: rgba(248, 113, 113, 0.1);
    --purple: #a78bfa;
    --purple-dim: rgba(167, 139, 250, 0.1);
    --blue: #60a5fa;
    --blue-dim: rgba(96, 165, 250, 0.1);
    --indigo: #818cf8;
    --indigo-dim: rgba(129, 140, 248, 0.1);
}
```

### Color Semantics (strict)
- **Emerald** — active, healthy, primary signal, section labels
- **Amber** — warning, pending, secondary signal
- **Red** — error, critical, attention required
- **Purple** — meta, system, infrastructure
- **Blue** — informational, linked, external reference
- **Indigo** — accent, decorative (sparingly)
- **Never** use color for decoration. Every colored element carries semantic meaning.

## Spacing & Layout — Dense but Breathable
```
Gap between cards:     8px (tight but not suffocating)
Card padding:          16px (compact), 24px (section)
Section padding:       48px vertical
Container max-width:   1080px
Border radius:         2px (sharp intent, not brutalist)
Border:                1px solid var(--border)
```

### Grid Patterns
```
2-column split:    grid-template-columns: 1fr 1fr; gap: 8px;
3-column data:     grid-template-columns: repeat(3, 1fr); gap: 8px;
Sidebar + main:    grid-template-columns: 240px 1fr; gap: 8px;
Dashboard grid:    auto-fit, minmax(280px, 1fr); gap: 8px;
```

## Component Catalog

### Ticker (top-of-page ambient data)
```css
.ticker { border-bottom: 1px solid var(--border); overflow: hidden; background: var(--card); }
.ticker-item { font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-dim); padding: 0 2rem; }
.ticker-item .val { color: var(--emerald); font-weight: 600; font-size: 10px; }
```
Animation: `translateX` scroll, 30s linear infinite. Shows live system state.

### Section Label
```css
.section-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--emerald); margin-bottom: 8px; font-weight: 500; }
.section-label.warn { color: var(--amber); }
.section-label.crit { color: var(--red); }
```

### Data Card
```css
.card { background: var(--card); border: 1px solid var(--border); padding: 16px; border-radius: 2px; }
.card:hover { border-color: var(--border-hover); }
```
Minimal radius (2px). No shadow. Border only. Content density is the point.

### Metric Block
```html
<div class="metric">
    <span class="metric-label">CHANNELS ACTIVE</span>
    <span class="metric-value">42</span>
    <span class="metric-delta positive">+3 since yesterday</span>
</div>
```
```css
.metric-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-dim); }
.metric-value { font-size: 24px; font-weight: 700; color: var(--text); display: block; }
.metric-delta { font-size: 10px; color: var(--emerald); }
.metric-delta.negative { color: var(--red); }
.metric-delta.neutral { color: var(--text-dim); }
```

### Status Indicator
```css
.status { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; }
.status::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--emerald); }
.status.warn::before { background: var(--amber); }
.status.crit::before { background: var(--red); animation: pulse 1.5s ease infinite; }
```

### Table (dense, borderless rows)
```css
.data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.data-table th { font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-dim); text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); font-weight: 400; }
.data-table td { padding: 8px 12px; border-bottom: 1px solid rgba(39, 39, 42, 0.5); color: var(--text-secondary); }
.data-table tr:hover td { color: var(--text); background: rgba(52, 211, 153, 0.02); }
```

### Tag/Badge
```css
.tag { display: inline-block; padding: 2px 8px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; border: 1px solid var(--border); color: var(--text-secondary); }
.tag.emerald { border-color: var(--emerald); color: var(--emerald); background: var(--emerald-dim); }
.tag.amber { border-color: var(--amber); color: var(--amber); background: var(--amber-dim); }
```

### Timeline/Feed Item
```css
.feed-item { padding: 12px 16px; border-bottom: 1px solid var(--border); display: grid; grid-template-columns: 80px 1fr auto; gap: 12px; align-items: baseline; }
.feed-time { font-size: 10px; color: var(--text-dim); font-weight: 400; }
.feed-source { font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; }
```

## Three Modes

### Full Delta (standalone dashboard)
Entire page is Delta. Ticker at top. Dense grid layout. Used for: intel dashboards, a morning brief renderer, a graph explorer, system monitoring.

### Adapted Delta (narrative + data)
Primary content is readable (larger font, more spacing) but data blocks use Delta density. Used for: briefing docs that embed metrics, competitive analysis with data tables.

### Partial Delta (data embed)
Single Delta component (metric block, data table, status grid) embedded in another aesthetic. Used for: adding a live-data section to a Tailwind or plain HTML page.

## Emerald Particle Background (Signature Element)
Fixed canvas behind all content. Subtle emerald network effect — communicates "live system."
```
- Position: fixed, z-index 0, pointer-events none, full viewport
- Particle count: ~60 (scaled by viewport area / 25000, max 60)
- Particle color: rgba(52, 211, 153, 0.05-0.25) — emerald at low opacity
- Connection lines: rgba(52, 211, 153, 0.04) max, 120px threshold
- Movement: 0.2px/frame max velocity — barely perceptible drift
- Particle size: 0.4-1.6px radius
- Content z-index must be above 0 (use relative positioning)
```
This is the ONE decorative element in Delta. It provides depth without competing with data.

## Anti-Patterns (NEVER in Delta)
- Rounded corners > 4px (2px is the max for cards, 4px absolute ceiling)
- Shadows (flat borders only)
- Gradients on backgrounds (solid colors only)
- Sans-serif in data regions (DM Sans allowed only for narrative paragraphs)
- Padding > 24px on data cards (density is the point)
- Hero images, illustrations, stock photos, AI imagery
- Gap > 12px between adjacent data cards (8px default, 12px max)
- Color without semantic meaning
- font-size > 32px anywhere (this is not a marketing page)
- Particles in any color OTHER than emerald (this is a brand signature)

## Page Layouts

### Intelligence Dashboard
```
┌─────────────────────────────────────────────────────┐
│ TICKER: live metrics scrolling                       │
├─────────────────────────────────────────────────────┤
│ HEADER: title + timestamp + status indicators        │
├───────────────────────┬─────────────────────────────┤
│ METRIC GRID (3-4 col) │                             │
├───────────────────────┤  FEED (timeline of events)  │
│ CATEGORY BREAKDOWN    │                             │
├───────────────────────┤                             │
│ STATUS TABLE          │                             │
└───────────────────────┴─────────────────────────────┘
```

### Channel Digest
```
┌─────────────────────────────────────────────────────┐
│ TICKER: channel activity summary                     │
├─────────────────────────────────────────────────────┤
│ SECTION: COMPETITIVE INTEL  [emerald label]          │
│ ┌─────┐┌─────┐┌─────┐                              │
│ │card ││card ││card │  ← 5px gap, dense             │
│ └─────┘└─────┘└─────┘                              │
├─────────────────────────────────────────────────────┤
│ SECTION: AI & TOOLING  [emerald label]               │
│ feed items...                                        │
├─────────────────────────────────────────────────────┤
│ SECTION: ACCOUNTS  [amber label — action needed]     │
│ table of signals                                     │
└─────────────────────────────────────────────────────┘
```

## Implementation Notes
- Single-file HTML (embedded CSS + JS, no external deps beyond Google Fonts CDN)
- No Tailwind CDN — write raw CSS with the custom properties above
- Canvas/SVG for charts if needed — never Chart.js or heavy libs
- IntersectionObserver for scroll-triggered number counting only
- No animation beyond ticker scroll and status pulse
- Print/PDF: flip to white bg, dark text — `@media print` override required

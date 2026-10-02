# TailwindCSS & UI Design Rules (opt-in)

> Opt-in rule. It is not installed by `setup.sh`. Copy it to `~/.claude/rules/` when you build standalone HTML demos or web pages with Tailwind. Rules in that folder load into every session, so skip it if you rarely build web UI. It covers Tailwind and plain HTML. If your UI framework ships its own design system, follow that instead of Tailwind.

## Design Philosophy
Build distinctive, production-grade interfaces. Every UI should look like a professional design team built it — not a bootstrap template with default spacing. Interactive HTML demos follow these principles.

## Shadow Hierarchy (5 Levels)
Use shadows consistently to communicate depth and interaction:
```
Level 0: shadow-none        — flat elements, inline content
Level 1: shadow-sm          — cards at rest, subtle separation
Level 2: shadow-md          — cards on hover, dropdowns
Level 3: shadow-lg          — modals, popovers, floating elements
Level 4: shadow-xl          — hero cards, primary CTAs, toast notifications
Level 5: shadow-2xl         — full-screen overlays, critical alerts
```

## Layout & Spacing System
- Use consistent spacing scale: 4px base (p-1, p-2, p-4, p-6, p-8, p-12, p-16)
- Prefer `gap` over margins for flex/grid layouts
- Content max-width: `max-w-7xl` for page content, `max-w-3xl` for readable text
- Card padding: `p-6` minimum, `p-8` for hero cards
- Section spacing: `py-16` to `py-24` between major sections
- Never use arbitrary pixel values when a Tailwind token exists

## Responsive Patterns
- Mobile-first: start with `sm:` and build up
- Breakpoints: `sm` (640), `md` (768), `lg` (1024), `xl` (1280), `2xl` (1536)
- Navigation: hamburger on mobile, horizontal on `lg+`
- Grid columns: 1 on mobile → 2 on `md` → 3-4 on `lg`
- Font scaling: `text-sm` mobile → `text-base` desktop for body, `text-2xl` → `text-4xl` for headings
- Touch targets: minimum `h-10 w-10` (40px) for interactive elements on mobile

## Color & Theming
- Build from a single brand color
- Dark mode: use `dark:` variant classes, prefer dark navy (`#0F172A` to `#1E293B`) over pure black
- Accent colors: derive from brand — lighter for badges, darker for backgrounds
- Text contrast: `text-gray-900` on light, `text-gray-100` on dark — minimum 4.5:1 ratio
- Status colors: green (success), amber (warning), red (error), blue (info) — never for decoration
- Neutral fallback: `#2D3748` / `#F7FAFC` — never a vendor's brand color unless the page is for that vendor

## Typography
- Heading hierarchy: one `text-4xl font-bold` per page, then `text-2xl`, `text-xl`, `text-lg`
- Body text: `text-base leading-relaxed` for paragraphs, `text-sm` for supporting content
- Font weight variation creates visual interest: `font-light` for labels, `font-semibold` for emphasis, `font-bold` for headings
- Letter spacing: `tracking-tight` for large headings, default for body
- Line height: `leading-relaxed` (1.625) for body text, `leading-tight` (1.25) for headings
- Monospace: `font-mono text-sm` for code, data values, IDs

## Interactive States
Every interactive element needs ALL of these states:
```
default   → base styling
hover     → `hover:` — subtle lift, color shift, or shadow increase
focus     → `focus:ring-2 focus:ring-offset-2 focus:ring-brand` — visible focus ring
active    → `active:scale-95` or `active:` color darken — tactile press feedback
disabled  → `disabled:opacity-50 disabled:cursor-not-allowed` — clearly non-interactive
loading   → skeleton pulse or spinner — never freeze the UI
```

## Animation & Transitions
- Default transition: `transition-all duration-200 ease-in-out`
- Hover lifts: `hover:-translate-y-1 hover:shadow-lg transition-all duration-200`
- Scroll-triggered: IntersectionObserver + CSS transforms, NOT JS-driven animation
- Page load: stagger card entry with `animation-delay` (50ms increments)
- Avoid: jank, layout shift, animations >400ms, animations that block interaction
- Respect `prefers-reduced-motion`: wrap animations in `motion-safe:` or `motion-reduce:` variants

## Card Patterns
Cards are the primary content container for demos and dashboards:
```html
<!-- Standard card -->
<div class="rounded-xl bg-white dark:bg-slate-800 shadow-sm hover:shadow-md 
            transition-all duration-200 p-6 border border-gray-100 dark:border-slate-700">

<!-- Hero/featured card -->
<div class="rounded-2xl bg-gradient-to-br from-brand-50 to-brand-100 
            dark:from-brand-900/20 dark:to-brand-800/20 shadow-lg p-8">

<!-- Interactive card -->
<div class="rounded-xl bg-white dark:bg-slate-800 shadow-sm 
            hover:shadow-lg hover:-translate-y-1 cursor-pointer 
            transition-all duration-200 p-6 group">
```

## Component Patterns

### Buttons
```
Primary:   bg-brand-600 text-white hover:bg-brand-700 shadow-sm
Secondary: bg-white border border-gray-300 text-gray-700 hover:bg-gray-50
Ghost:     text-brand-600 hover:bg-brand-50
Danger:    bg-red-600 text-white hover:bg-red-700
```

### Input Fields
- `rounded-lg border border-gray-300 px-4 py-2.5 focus:ring-2 focus:ring-brand-500 focus:border-transparent`
- Labels: `text-sm font-medium text-gray-700 mb-1.5`
- Helper text: `text-xs text-gray-500 mt-1`
- Error state: `border-red-500 focus:ring-red-500` + `text-xs text-red-600 mt-1`

### Navigation
- Sticky header: `sticky top-0 z-50 backdrop-blur-lg bg-white/80 dark:bg-slate-900/80`
- Active link: underline or filled pill, not just bold
- Breadcrumbs: `text-sm text-gray-500` with `>` or `/` separator

## Anti-Patterns (NEVER do these)
- Default gray backgrounds with no visual hierarchy
- Cards with identical sizes, spacing, and no visual weight difference
- Button soup: more than 2 button styles visible at once
- Rainbow gradients or neon colors (looks amateur)
- Borders everywhere — use shadows and background fills for separation
- `!important` overrides — fix the specificity instead
- Inline styles when a Tailwind class exists
- Generic placeholder content ("Lorem ipsum", "Click here", "Learn more")
- Stock photos or AI-generated imagery as backgrounds (solid colors read as more polished than generated art)
- Animations that fire continuously — animate on entry or interaction only

## Accessibility (Non-negotiable)
- All interactive elements: keyboard accessible (tab order, enter/space activation)
- ARIA labels on icon-only buttons: `aria-label="Close menu"`
- Form inputs: associated `<label>` elements (not just placeholder text)
- Color is not the only indicator — add icons or text alongside color-coded status
- Focus visible: never `outline-none` without a replacement focus indicator
- Screen reader text: `sr-only` class for context that's visual-only
- Minimum contrast ratios: 4.5:1 for normal text, 3:1 for large text

## HTML Demo Specific (static hosting)
For self-contained interactive HTML demos (a good default demo format):
- Single-file: embedded CSS + JS, no external deps beyond Google Fonts + CDN Tailwind
- Dark navy theme (`bg-slate-900`) with accent colors as default aesthetic
- Scroll-triggered animations via IntersectionObserver
- Particle/canvas backgrounds for hero sections (subtle, performance-conscious)
- Counter animations for metrics: `requestAnimationFrame` with easing
- Card-based layouts with hover interactions
- Chat bubble mockups, phone notification mockups, timeline progressions
- Host it on any static host; GitHub Pages in your own account works (`<your-handle>/<project-name>`)

# DESIGN_SPEC — SAA-C03 study site UI ("Quiet Blueprint")

Canvas with every screen: https://claude.ai/artifact/CP2e4zgbYN3T75c1jZFNPk (private; 16 artboards, listed in §13).
This file is the source of truth. Where the canvas and this file differ, follow this file.

Sample numbers on the canvas (scores, counts, dates) are placeholder data. `[YOUR EXAM DATE]` and `[EST. COST]` are
placeholders the content or settings must fill.

---

## 1. Look

**Name: Quiet Blueprint.** A cool "drafting paper" ground (`#F4F6F8`), graphite ink text, white working surfaces and one
cobalt accent (`#2F4FD8`). Small uppercase JetBrains Mono labels ("PART 2", "SLIDES 93–117", "EXAM TIP") act like the
callouts on an engineering drawing, and the knowledge map is drawn as dashed cluster frames on a dot grid with straight,
right-angled arrows. Body text is Atkinson Hyperlegible Next, a face built for letter recognition, set at 17 px / 1.65 with a
72-character measure so long sessions stay easy on the eyes. Headings use Bricolage Grotesque for some warmth. There are no
gradient washes, no left-stripe cards and no emoji. Colour is used for meaning (status, category, callout type), and every
colour that has to be told apart also differs in lightness, in its icon or in its text label. Dark mode is a true dark
graphite (`#0E1217`) with a periwinkle accent (`#8B9EFF`), not an inverted light theme.

---

## 2. Fonts

All three fonts are self-hosted through Fontsource (offline). The packages are already in `package.json`.

| Role | Family (CSS name) | Package | Import (in `src/main.tsx`) |
|---|---|---|---|
| Display (h1–h4, big numbers, flashcard text) | `'Bricolage Grotesque Variable'` (opsz 12–96, wght 200–800) | `@fontsource-variable/bricolage-grotesque` | `import '@fontsource-variable/bricolage-grotesque/opsz.css';` |
| Body / UI | `'Atkinson Hyperlegible Next'` | `@fontsource/atkinson-hyperlegible-next` | `import '@fontsource/atkinson-hyperlegible-next/400.css';` `…/400-italic.css` `…/500.css` `…/600.css` `…/700.css` |
| Mono (labels, code, timer, counts, kbd) | `'JetBrains Mono'` | `@fontsource/jetbrains-mono` | `import '@fontsource/jetbrains-mono/400.css';` `…/500.css` `…/600.css` |

Set `font-optical-sizing: auto` on display text so Bricolage picks the right optical size per font size.

```css
:root {
  --font-display: 'Bricolage Grotesque Variable', 'Bricolage Grotesque', 'Segoe UI', system-ui, sans-serif;
  --font-body: 'Atkinson Hyperlegible Next', 'Atkinson Hyperlegible', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace;
}
```

### Type scale (base 16 px)

| Token | Font | Size / line-height | Weight | Letter-spacing | Use |
|---|---|---|---|---|---|
| `--type-display` | display | 52px (3.25rem) / 1 | 700 | -0.02em | score in the results dial |
| `--type-number` | display | 32px (2rem) / 1.1 | 700 | -0.02em | stat tile values; `font-variant-numeric: tabular-nums` |
| `--type-section-num` | display | 40px (2.5rem) / 1 | 700 | -0.02em | big "06" before the lesson h1, colour `--accent` |
| h1 | display | 34px (2.125rem) / 1.2 | 700 | -0.015em | page title; `text-wrap: balance` |
| h2 | display | 24px (1.5rem) / 1.25 | 600 | -0.01em | lesson section headings; 20px in card headers (map) |
| h3 | display | 20px (1.25rem) / 1.35 | 600 | 0 | card titles |
| h4 | display | 18px (1.125rem) / 1.35 | 600 | 0 | lab step titles, navigator heading |
| body-lesson | body | 17px (1.0625rem) / 1.65 | 400 | 0 | lesson paragraphs, scenario text; `max-width: 72ch` |
| body | body | 16px (1rem) / 1.6 | 400 | 0 | callout body, key concepts, explanations |
| ui | body | 15px (0.9375rem) / 1.5 | 400–600 | 0 | buttons, nav, tables, lists |
| small | body | 14px (0.875rem) / 1.5 | 400–600 | 0 | sidebar items, captions under figures, TOC |
| caption | body | 13px (0.8125rem) / 1.45 | 400–600 | 0 | meta text, legends, hints |
| label | mono | 12px (0.75rem) / 16px | 500 (600 in callouts) | 0.06em, `text-transform: uppercase` | annotation labels; 11px in dense places (map bands, phone) |
| code | mono | 14px (0.875rem) / 1.65 | 400 | 0 | code blocks, inline code (13px on phone) |
| kbd | mono | 12px / 16px | 400 | 0 | keyboard hints |
| timer | mono | 24px (1.5rem) / 1 | 600 | 0.02em | exam countdown; tabular numbers |

Phone (< 768px): h1 26px / 1.2, h2 21px / 1.25, h3 18px, section number 28px, body-lesson stays 17px, code 13px.

Rules: never set body copy below 13px; no all-caps except the mono labels; weights used are 400, 500, 600, 700 only.

---

## 3. Colour tokens

Theme switching: `<html data-theme="light|dark">`. An inline script in `index.html` sets it before first paint from
`localStorage.theme`, else from `matchMedia('(prefers-color-scheme: dark)')`. The toggle in the top bar writes
`localStorage.theme`. Also set `color-scheme` so native controls and scrollbars match.

```css
:root {
  color-scheme: light;

  /* Ground and surfaces */
  --bg: #F4F6F8;
  --surface: #FFFFFF;
  --surface-2: #EDF1F5;            /* table header, track, hover, inset */
  --surface-3: #F7F9FB;            /* zebra rows, figure header, quiet panels */
  --border: #D5DCE3;
  --border-strong: #B3BECA;        /* secondary buttons, map nodes */
  --control-border: #7D8996;       /* checkbox/radio outline, empty progress dot (3.5:1 on white) */

  /* Text */
  --text: #121820;                 /* 16:1 on --bg */
  --text-muted: #4D5966;           /* 6.6:1 on --bg */
  --text-subtle: #626E7B;          /* 4.8:1 on --bg, 5.2:1 on white: captions */

  /* Accent */
  --accent: #2F4FD8;               /* 6.5:1 with white */
  --accent-hover: #2541BA;
  --accent-pressed: #1F369C;
  --accent-soft: #E7ECFD;
  --accent-soft-border: #BAC6F6;
  --accent-ink: #2440B8;           /* accent text on --accent-soft and on surfaces, 7:1 */
  --accent-contrast: #FFFFFF;      /* text/icons on --accent */
  --focus-ring: #2F4FD8;

  /* Status */
  --success: #1D7A4C;  --success-soft: #E5F4EB;  --success-border: #9FD3B4;  --success-ink: #17603C;
  --danger: #BF3328;   --danger-soft: #FCEBE9;   --danger-border: #F0B7B0;   --danger-ink: #9C271E;
  --danger-hover: #A52B21;  --on-danger: #FFFFFF;
  --warning: #8F5600;  --warning-soft: #FCF2DF;  --warning-border: #E9CB8F;  --warning-ink: #6F4300;
  --info: #0E6E80;     --info-soft: #E2F3F6;     --info-border: #A3D5DE;

  /* Search highlight, overlays, elevation */
  --mark-bg: #FDE7A6;  --mark-text: #121820;
  --scrim: rgba(14, 18, 23, 0.45);
  --shadow-1: 0 1px 2px rgba(18, 24, 32, 0.06), 0 1px 1px rgba(18, 24, 32, 0.04);
  --shadow-2: 0 6px 16px -4px rgba(18, 24, 32, 0.12), 0 2px 4px rgba(18, 24, 32, 0.05);
  --shadow-3: 0 24px 56px -12px rgba(18, 24, 32, 0.30), 0 4px 12px rgba(18, 24, 32, 0.08);

  /* Callouts: bg / border / icon / icon tile / title */
  --callout-tip-bg: #EEF1FE;     --callout-tip-border: #C9D2F8;     --callout-tip-icon: #3346C2;     --callout-tip-icon-bg: #DCE3FC;     --callout-tip-title: #2A3AA3;
  --callout-trap-bg: #FDF0EE;    --callout-trap-border: #F1C6BF;    --callout-trap-icon: #BF3328;    --callout-trap-icon-bg: #F9DCD7;    --callout-trap-title: #9C271E;
  --callout-note-bg: #F1F4F7;    --callout-note-border: #D5DCE3;    --callout-note-icon: #4D5966;    --callout-note-icon-bg: #E2E8EE;    --callout-note-title: #2D3640;
  --callout-updated-bg: #EAF6F2; --callout-updated-border: #B5DECF; --callout-updated-icon: #0C7A63; --callout-updated-icon-bg: #D2EEE4; --callout-updated-title: #0A5C4B;
  --callout-verify-bg: #FCF4E3;  --callout-verify-border: #EBD3A0;  --callout-verify-icon: #8F5600;  --callout-verify-icon-bg: #F6E4BE;  --callout-verify-title: #6F4300;

  /* Badges and chips: bg / text / border */
  --badge-updated-bg: #D2EEE4;  --badge-updated-text: #0A5C4B;  --badge-updated-border: #B5DECF;
  --badge-verify-bg: #F6E4BE;   --badge-verify-text: #6F4300;   --badge-verify-border: #EBD3A0;
  --badge-free-bg: #E5F4EB;     --badge-free-text: #17603C;     --badge-free-border: #9FD3B4;
  --badge-notfree-bg: #FCEBE9;  --badge-notfree-text: #9C271E;  --badge-notfree-border: #F0B7B0;
  --badge-neutral-bg: #EDF1F5;  --badge-neutral-text: #4D5966;  --badge-neutral-border: #D5DCE3;
  --badge-accent-bg: #E7ECFD;   --badge-accent-text: #2440B8;   --badge-accent-border: #BAC6F6;
  /* Pass = free colours, Fail = notfree colours */

  /* Quiz option states */
  --quiz-selected-bg: var(--accent-soft);   --quiz-selected-border: var(--accent);
  --quiz-correct-bg: var(--success-soft);   --quiz-correct-border: var(--success);
  --quiz-incorrect-bg: var(--danger-soft);  --quiz-incorrect-border: var(--danger);
  --quiz-disabled-bg: var(--surface);       --quiz-disabled-border: var(--border);

  /* Exam navigator cells: bg / text / border */
  --nav-answered-bg: #E7ECFD;    --nav-answered-text: #2440B8;   --nav-answered-border: #BAC6F6;
  --nav-flagged-bg: #FCF2DF;     --nav-flagged-text: #6F4300;    --nav-flagged-border: #C98A1B;
  --nav-current-bg: #2F4FD8;     --nav-current-text: #FFFFFF;    --nav-current-border: #2F4FD8;
  --nav-unanswered-bg: #FFFFFF;  --nav-unanswered-text: #626E7B; --nav-unanswered-border: #D5DCE3;

  /* Code */
  --code-bg: #F1F4F8;  --code-border: #D5DCE3;  --code-header-bg: #E8EDF2;  --code-text: #1A2230;
  --code-comment: #5E6A77;  --code-command: #2E44B8;  --code-flag: #A1361F;  --code-string: #1A6E44;  --code-prompt: #626E7B;

  /* Knowledge map: category colours (dark tier ~L0.09, mid ~L0.16, light ~L0.26; all >= 3:1 on white) */
  --cat-compute: #C24A14;      /* mid   */
  --cat-storage: #43A047;      /* light */
  --cat-databases: #3346C2;    /* dark  */
  --cat-networking: #9047C7;   /* mid   */
  --cat-security: #A3223B;     /* dark  */
  --cat-integration: #E0559A;  /* light */
  --cat-analytics: #0A5F66;    /* dark  */
  --cat-ml: #2B93C9;           /* light */
  --cat-monitoring: #B08900;   /* light */
  --cat-migration: #6A7480;    /* mid   */
  --map-dot: #D9DFE6;  --map-band-border: #C3CCD6;  --map-band-bg: #F9FAFC;  --map-node-border: #B3BECA;  --map-edge: #7D8996;

  /* Exam domains */
  --domain-secure: #3346C2;  --domain-resilient: #0E6E80;  --domain-performance: #7339B0;  --domain-cost: #8A6200;
}

:root[data-theme="dark"] {
  color-scheme: dark;

  --bg: #0E1217;
  --surface: #151A21;
  --surface-2: #1C232C;
  --surface-3: #181E26;
  --border: #2A333E;
  --border-strong: #3B4652;
  --control-border: #6B7785;       /* 3.8:1 on --surface */

  --text: #E4E9EE;                 /* 15:1 on --bg */
  --text-muted: #A5B0BC;           /* 8:1 */
  --text-subtle: #8A96A3;          /* 5.5:1 on --surface */

  --accent: #8B9EFF;               /* 6.9:1 on --surface */
  --accent-hover: #A3B3FF;
  --accent-pressed: #7A8EF2;
  --accent-soft: #1E2547;
  --accent-soft-border: #3A4790;
  --accent-ink: #B4C1FF;
  --accent-contrast: #0B1020;      /* text on --accent, 7.7:1 */
  --focus-ring: #8B9EFF;

  --success: #5BC98A;  --success-soft: #13281D;  --success-border: #2E6B48;  --success-ink: #8EE0AE;
  --danger: #FF8A7D;   --danger-soft: #2D1614;   --danger-border: #7A2F28;   --danger-ink: #FFB3A9;
  --danger-hover: #FFA397;  --on-danger: #1A0B09;
  --warning: #F0B95A;  --warning-soft: #2A2010;  --warning-border: #6E5322;  --warning-ink: #F7D18E;
  --info: #5CC6D8;     --info-soft: #10262B;     --info-border: #275E68;

  --mark-bg: #5A4612;  --mark-text: #FFF1C7;
  --scrim: rgba(0, 0, 0, 0.60);
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.50);
  --shadow-2: 0 8px 20px -6px rgba(0, 0, 0, 0.60), 0 2px 4px rgba(0, 0, 0, 0.40);
  --shadow-3: 0 28px 64px -12px rgba(0, 0, 0, 0.75), 0 0 0 1px #2A333E;

  --callout-tip-bg: #191F3D;     --callout-tip-border: #33407F;     --callout-tip-icon: #9AA9FF;     --callout-tip-icon-bg: #262F5C;     --callout-tip-title: #BAC5FF;
  --callout-trap-bg: #2B1614;    --callout-trap-border: #6B2D27;    --callout-trap-icon: #FF8A7D;    --callout-trap-icon-bg: #45201C;    --callout-trap-title: #FFB3A9;
  --callout-note-bg: #1A2029;    --callout-note-border: #333D49;    --callout-note-icon: #A5B0BC;    --callout-note-icon-bg: #262E39;    --callout-note-title: #D5DCE3;
  --callout-updated-bg: #0F2823; --callout-updated-border: #1F5C4F; --callout-updated-icon: #5ED3B4; --callout-updated-icon-bg: #163B33; --callout-updated-title: #93E6CF;
  --callout-verify-bg: #2A2110;  --callout-verify-border: #6A5121;  --callout-verify-icon: #F0B95A;  --callout-verify-icon-bg: #3E3015;  --callout-verify-title: #F7D18E;

  --badge-updated-bg: #163B33;  --badge-updated-text: #93E6CF;  --badge-updated-border: #1F5C4F;
  --badge-verify-bg: #3E3015;   --badge-verify-text: #F7D18E;   --badge-verify-border: #6A5121;
  --badge-free-bg: #13281D;     --badge-free-text: #8EE0AE;     --badge-free-border: #2E6B48;
  --badge-notfree-bg: #2D1614;  --badge-notfree-text: #FFB3A9;  --badge-notfree-border: #7A2F28;
  --badge-neutral-bg: #1C232C;  --badge-neutral-text: #A5B0BC;  --badge-neutral-border: #2A333E;
  --badge-accent-bg: #1E2547;   --badge-accent-text: #B4C1FF;   --badge-accent-border: #3A4790;

  --nav-answered-bg: #1E2547;    --nav-answered-text: #B4C1FF;   --nav-answered-border: #3A4790;
  --nav-flagged-bg: #2A2110;     --nav-flagged-text: #F7D18E;    --nav-flagged-border: #C99A3E;
  --nav-current-bg: #8B9EFF;     --nav-current-text: #0B1020;    --nav-current-border: #8B9EFF;
  --nav-unanswered-bg: #151A21;  --nav-unanswered-text: #8A96A3; --nav-unanswered-border: #2A333E;

  --code-bg: #0B0F14;  --code-border: #2A333E;  --code-header-bg: #141A21;  --code-text: #DDE4EB;
  --code-comment: #8A96A3;  --code-command: #9AA9FF;  --code-flag: #F2A27A;  --code-string: #8EE0AE;  --code-prompt: #8A96A3;

  --cat-compute: #F07A3A;      /* mid   */
  --cat-storage: #7BD07F;      /* light */
  --cat-databases: #5F74E0;    /* dark  */
  --cat-networking: #B27CEB;   /* mid   */
  --cat-security: #E0475F;     /* dark  */
  --cat-integration: #F59AC8;  /* light */
  --cat-analytics: #178C94;    /* dark  */
  --cat-ml: #6CC4F0;           /* light */
  --cat-monitoring: #E9C24A;   /* light */
  --cat-migration: #99A3AF;    /* mid   */
  --map-dot: #232B35;  --map-band-border: #36414D;  --map-band-bg: #171D25;  --map-node-border: #3B4652;  --map-edge: #6B7785;

  --domain-secure: #9AA8FF;  --domain-resilient: #4CC3D9;  --domain-performance: #C6A0F3;  --domain-cost: #E0B13C;
}
```

The quiz-state aliases (`--quiz-*`) are defined once in `:root` with `var()` and follow the theme automatically.

Contrast: all text pairs above are WCAG AA (4.5:1) or better; caption grey (`--text-subtle`) is the lowest at 4.8:1 (light)
and 5.5:1 (dark). Category, domain and progress colours are graphics and meet 3:1 against `--surface` in both themes.

---

## 4. Spacing, radii, elevation, borders, layers, motion

```css
:root {
  /* Spacing (4px base; 2/6/10/14 exist for fine alignment) */
  --space-0-5: 2px;  --space-1: 4px;  --space-1-5: 6px;  --space-2: 8px;  --space-2-5: 10px;
  --space-3: 12px;   --space-3-5: 14px; --space-4: 16px; --space-5: 20px; --space-6: 24px;
  --space-7: 28px;   --space-8: 32px;   --space-9: 36px; --space-10: 40px; --space-12: 48px;
  --space-14: 56px;  --space-16: 64px;

  /* Radii */
  --radius-xs: 4px;    /* map edge labels */
  --radius-sm: 6px;    /* badges, kbd, checkbox, inline code */
  --radius-md: 8px;    /* map nodes, exam navigator cells, logo tile */
  --radius-ctl: 10px;  /* buttons, inputs, sidebar items, search trigger */
  --radius-lg: 12px;   /* callouts, tables, code blocks, quiz options, segmented control */
  --radius-xl: 14px;   /* cards, stat tiles, figure, lab step, cleanup */
  --radius-2xl: 16px;  /* search palette */
  --radius-3xl: 20px;  /* flashcard, dialogs */
  --radius-pill: 999px;

  /* Borders */
  --border-w: 1px;          /* default for every container */
  --border-w-state: 2px;    /* quiz correct/incorrect/selected, cleanup box, Not Free Tier banner, map hover */
  /* Map cluster frames: 1px dashed var(--map-band-border) */

  /* Layers */
  --z-sticky-toc: 5;
  --z-tabs: 10;
  --z-topbar: 30;
  --z-popover: 40;        /* map hover card, menus */
  --z-flyout: 45;         /* collapsed-rail flyout */
  --z-drawer-scrim: 50;
  --z-drawer: 60;
  --z-dialog-scrim: 70;
  --z-dialog: 80;         /* submit exam, figure expand */
  --z-palette: 90;        /* command palette (+ its own scrim) */
  --z-toast: 100;

  /* Motion */
  --dur-fast: 120ms;      /* colour/background hover, focus */
  --dur-base: 180ms;      /* chevrons, tabs indicator, small reveals */
  --dur-slow: 280ms;      /* drawer slide, progress fill, dialog in */
  --dur-flip: 450ms;      /* flashcard flip */
  --ease-out: cubic-bezier(0.2, 0, 0, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

Reduced motion specifics: the flashcard flip becomes an opacity cross-fade of 120ms (handled in JS: skip the rotate
class), the drawer appears without sliding, progress bars render at their value without animating, the map zoom buttons
jump instead of easing.

Elevation use: `--shadow-1` cards and tiles at rest; `--shadow-2` flashcard, hovered map node, selected segment;
`--shadow-3` popovers, hover card, palette, dialogs, drawer.

Focus: every interactive element gets `outline: 2px solid var(--focus-ring); outline-offset: 2px` on `:focus-visible`.
Inside scroll containers (sidebar, palette list) use `outline-offset: -2px` so the ring is not clipped.

Target size: every interactive element has a hit area of at least 44 × 44px. Compact visuals (filter pills 32px, `sm`
buttons 36px) extend their hit area with `::before { content: ''; position: absolute; inset: -6px 0; }` on a
`position: relative` element.

---

## 5. Layout and breakpoints

| Element | Value |
|---|---|
| Top bar height | 60px (desktop), 56px (< 768px); `position: sticky; top: 0` |
| Sidebar expanded | 288px, sticky under the top bar, own scroll (`height: calc(100dvh - 60px); overflow-y: auto`) |
| Sidebar collapsed rail | 72px (768–1023px) |
| Drawer (phone) | 320px, `max-width: 86vw` |
| Main padding | `clamp(16px, 3vw, 40px)` left/right; 32px top on pages, 28px above the section header |
| Lesson container | `max-width: 1080px`, centred; article `max-width: 760px`; TOC `flex: 1 1 220px; max-width: 240px`; gap 48px |
| Lesson paragraphs | `max-width: 72ch` |
| Dashboard / weak areas / results | fluid, `max-width: 1360px` (weak areas content 1160px) |
| Exam page | no sidebar; content `max-width: 1240px`; question column `max-width: 820px`; navigator 300–344px |
| Section tab bar | sticky at `top: 60px` (below the top bar), background `--bg` |
| TOC / lab progress panel | `position: sticky; top: 72px` (60 + 12) |

| Width | What changes |
|---|---|
| ≥ 1200px (xl) | Sidebar 288px + content + right TOC (lesson) / progress panel (lab) / multi-select inset (quiz). |
| 1024–1199px (lg) | TOC hidden; an "On this page" disclosure button (secondary, md) sits under the section chips. Lab progress panel and quiz inset move below the main column. |
| 768–1023px (md) | Sidebar collapses to the 72px rail. Exam navigator wraps below the question. Results/weak-area grids go to one column where they no longer fit (auto-fit). |
| < 768px (sm) | Sidebar becomes the off-canvas drawer opened by the hamburger. Top bar 56px: hamburger, brand, search icon button, theme button (settings moves into the drawer footer). Tabs scroll horizontally and bleed to the screen edges. Tables keep their min-width inside a scroll box with a sticky first column and a "Swipe the table sideways" hint. Lesson gets a bottom action bar (Prev · Mark as read · Next). Flashcard rating buttons sit in a bottom bar. The search palette opens as a full-screen sheet. The exam navigator becomes a "Questions 21/65" button that opens a bottom sheet. The knowledge map card gets a Map / List switch, List by default. |
| < 480px (xs) | Stat tiles 2 per row (handled by `repeat(auto-fit, minmax(min(160px, 100%), 1fr))`); dialog buttons stack full width. |

Grids use `repeat(auto-fit, minmax(min(<min>px, 100%), 1fr))` so they collapse without media queries: stat tiles 160,
continue/parts row 400, results rows 380, weak-area lists 320, lab meta 200, prev/next 260.

Skip link: first focusable element, "Skip to content", hidden until focused, then fixed at top-left 8px, primary button style.
Landmarks: `header`, `nav[aria-label="Course"]`, `main`, `aside` for TOC.

---

## 6. App shell components

### Top bar
- Height 60, `--surface`, bottom border `--border`, padding `0 12px 0 20px`, gap 16, items centred.
- Brand: logo tile 30×30 (`--accent`, radius 8, white 3-node glyph, see §12) + "SAA-C03 Study" (display 17px/700, -0.01em). The brand is a link to Home, min-height 44.
- Search trigger: a `<button>` styled as a field, `flex: 1`, `max-width: 520px`, height 44, radius 10, bg `--surface-2`, border `--border`, padding `0 8px 0 14px`, gap 10: Search icon 18 `--text-muted`, placeholder "Search lessons, cards, questions, labs" (15px `--text-subtle`, ellipsis), kbd "Ctrl" + "K" (show "⌘" + "K" on macOS). Hover: border `--border-strong`. Opens the palette. Global shortcuts: Ctrl/Cmd+K and "/" (when focus is not in a text field).
- Right: icon buttons 44×44 (radius 10, transparent, icon 20 `--text-muted`, hover bg `--surface-2`): theme toggle (Moon in light with `aria-label="Switch to dark mode"`, Sun in dark), Settings (SlidersHorizontal).

### Sidebar
- Container: bg `--surface`, right border `--border`, padding `16px 12px 32px`, gap 20 between the two groups.
- Primary nav (4 items): Home (House), Review flashcards (Layers, count badge), Weak areas (Target), Exam simulation (Timer).
  - Item `<a>`: min-height 44, padding `0 12px`, radius 10, gap 12, icon 20 `--text-muted`, label 15/500 `--text`.
  - Hover: bg `--surface-2`. Active (`aria-current="page"`): bg `--accent-soft`, icon and label `--accent-ink`, weight 600.
  - Count badge: mono 12/20, weight 600, padding `0 8px`, pill, bg `--accent`, text `--accent-contrast`. Hidden when 0.
- Course header row: label "COURSE" (mono label) left, "9 of 36 read" (13px `--text-subtle`) right; padding `0 10px 6px 12px`.
- Part header: `<button aria-expanded>` full width, min-height 48, padding `4px 10px 4px 8px`, radius 10, gap 10:
  ChevronDown/ChevronRight 16 (stroke 2, `--text-muted`, rotates 90° in `--dur-base`), a two-line label ("PART 2" mono
  11/14 0.06em `--text-subtle`; part name 14/20 700 `--text`), "5/6" mono 12 `--text-muted`, progress ring 18px.
  Hover: bg `--surface-2`. Expansion state per part is saved in localStorage; the part that holds the current section
  opens automatically.
- Section item `<a>`: min-height 44, padding `0 10px 0 34px`, radius 10, gap 10: progress dot 16, number mono 12
  `--text-subtle` (fixed width 18, zero-padded "06"), title 14/1.35 with one-line ellipsis (full title in `title` attr).
  Hover: bg `--surface-2`. Active: bg `--accent-soft`, number and title `--accent-ink`, title 600.
- Progress dot (16px SVG, each with `role="img"` and an aria-label):
  - Done: filled circle r 7.5 `--success` + check path (stroke 1.8, colour `--surface`).
  - In progress: ring r 6.75 stroke 1.5 `--accent` + right half-disc filled `--accent`.
  - Not started: ring r 6.75 stroke 1.5 `--control-border`.
  - A section is Done when "Mark as read" was pressed; In progress after it was opened or any of its cards/quiz/lab was used.
- Progress ring (part header): 18px, stroke 2.5, track `--border`, value `--accent`, `--success` when the part is
  complete, starts at 12 o'clock, round caps.
- Collapsed rail (768–1023px): 72px wide; primary nav as 44×44 icon buttons with tooltips; parts as 44×44 buttons
  showing "P1"…"P9" (mono 13/600) inside a 28px progress ring. Click/Enter opens a flyout (288px, `--surface`, `--shadow-3`,
  radius 14, `--z-flyout`) beside the rail with that part's section items; Esc closes and returns focus.
- Drawer (< 768px): opened by the hamburger. Panel 320px (`max-width: 86vw`), `--surface`, `--shadow-3`, slides in from
  the left (`transform: translateX(-100%)` → 0, `--dur-slow`, `--ease-out`) over `--scrim`. Header 56px: logo 26 + brand
  + close button 44 (X). Then a progress block (padding 14 16, bottom border): "Course 27% complete" 13/600 + "9 of 36
  read" + 6px bar. Then the same nav and course list. Focus is trapped inside; Esc, scrim click or choosing a section
  closes it; focus returns to the hamburger.

### Section header (lesson, flashcards, quiz, lab)
- Stack, gap 12, padding-top 28: mono label "PART 2 · COMPUTE & SCALING"; row (wraps, space-between, gap 16) with the
  section number (`--type-section-num`, `--accent`, `aria-hidden`) + h1, and the "Mark as read" button (secondary md,
  CircleCheck icon; after marking: label "Read", icon filled `--success`, `aria-pressed="true"`, click again to undo);
  then chips: slide range (mono neutral chip, Presentation icon, "Slides 93–117"), estimated time (neutral, Clock,
  "25 min"), status (accent chip, "In progress · 60% read").

### Tabs (Lesson / Flashcards / Quiz / Lab)
- `role="tablist"`, sticky at `top: 60px`, `z-index: var(--z-tabs)`, bg `--bg`, bottom border `--border`, gap 4,
  `overflow-x: auto`. Each tab is a link-like `<button role="tab" aria-selected>` (route `/section/:id/:tab`).
- Tab: min-height 48, padding `0 14px`, gap 8, icon 18 (BookOpen, Layers, CircleQuestionMark, FlaskConical), label 15.
  Inactive: `--text-muted`, 500. Hover: `--text`. Active: `--accent-ink`, 600, 2px bottom border `--accent`
  (`margin-bottom: -1px` so it sits on the bar line). The indicator slides between tabs in `--dur-base`.
- Count pill: mono 12/20 600, padding `0 7px`, pill; inactive bg `--surface-2` / text `--text-muted`; active bg
  `--accent-soft` / text `--accent-ink`. The Lab tab shows "1" or is hidden when the section has no lab.
- Keyboard: Left/Right move focus and select (roving tabindex), Home/End. Phone: the bar bleeds to the screen edges
  (`margin: 0 -16px; padding: 0 16px`), `scroll-snap-type: x proximity`, scrollbar hidden; the active tab scrolls into view.

### Buttons
| Size | Height | Padding | Font | Icon |
|---|---|---|---|---|
| sm | 36 (hit area 44) | 0 12 | 14/600 | 16 |
| md (default) | 44 | 0 16 | 15/600 | 18 |
| lg | 52 | 0 22 | 16/600 | 18 |

Common: radius 10, gap 8, body font, line-height 1.2, `white-space: nowrap`, 1px border. Icon-only buttons are square
(44×44) and need `aria-label`. A keyboard hint (`<kbd>`) may follow the label with 4px extra gap.

| Variant | Rest | Hover | Active | Disabled |
|---|---|---|---|---|
| primary | bg `--accent`, text `--accent-contrast`, border `--accent` | bg/border `--accent-hover` | bg/border `--accent-pressed` | bg `--surface-2`, text `--text-subtle`, border `--border` |
| secondary | bg `--surface`, text `--text`, border `--border-strong` | bg `--surface-2` | bg `--surface-2`, border `--control-border` | same as above |
| ghost | transparent, text `--text`, border transparent | bg `--surface-2` | bg `--surface-2`, border `--border` | text `--text-subtle` |
| danger | bg `--danger`, text `--on-danger`, border `--danger` | bg/border `--danger-hover` | bg/border `--danger-hover` | same as above |

Disabled uses `aria-disabled="true"` (not the `disabled` attribute) so the button stays focusable and can explain why
it is unavailable; `cursor: not-allowed`; clicks do nothing. Transitions: background/border/colour `--dur-fast`.

### Segmented control (deck selector, Console / AWS CLI, weak-area filter)
- `role="radiogroup"` with `role="radio" aria-checked` buttons. Container: inline-flex, padding 3, gap 3, bg
  `--surface-2`, border `--border`, radius 12. Option: min-height 44, padding `0 14px`, radius 9, gap 8, 14px, optional
  icon 16. Selected: bg `--surface`, border `--border`, text `--text` 600, `--shadow-1`. Unselected: transparent, text
  `--text-muted` 500; hover text `--text`. Arrow keys move the selection.
- Console / AWS CLI: icons Monitor / Terminal. The choice is remembered in localStorage and applies to every lab.

### Chips and badges
- **Chip** (status/meta, not interactive): height 28, padding `0 10px`, pill, 1px border, 13/600, icon 14 stroke 2,
  gap 6. Kinds use the badge token sets: neutral, accent, free (Free Tier eligible, CircleCheck), notfree (Not Free
  Tier, OctagonAlert), updated, verify, pass (= free colours + Check), fail (= notfree colours + X). The slide range
  chip uses the mono font at 12px.
- **Badge** (inline in text and table cells): height 22, padding `0 8px`, radius 6, 1px border, 12/700, letter-spacing
  0.01em, icon 12 stroke 2.25, `vertical-align: middle`. Variants: "Updated" (updated colours, RefreshCw),
  "Needs verification" (verify colours, ShieldQuestionMark), "Hard ×3" (verify colours, no icon).
- **Difficulty**: neutral chip with SignalLow / SignalMedium / SignalHigh icon and the word Easy / Medium / Hard.
  Deliberately not colour-coded.
- **Domain**: in a quiz question, an accent chip with the full domain name ("Design Resilient Architectures").
  In results and charts, a 10×10 square (radius 3) in the domain colour next to the name.
- **Section-state chip** (flashcards): New = accent, Due = verify, Learned = free.

### Callouts
- `<aside aria-label="Exam tip">` (etc.): flex, gap 14, `align-items: flex-start`, padding `16px 20px 18px 16px`,
  radius 12, **1px border on all four sides** in `--callout-<type>-border`, bg `--callout-<type>-bg`. No side stripe.
- Icon tile 32×32, radius 8, bg `--callout-<type>-icon-bg`, icon 18 stroke 2 in `--callout-<type>-icon`.
- Content column: gap 6, padding-top 4. Title row (wraps, gap 8 / 12), then body 16/1.6 `--text`.

| Type | Icon | Title row |
|---|---|---|
| Exam tip | Lightbulb | mono label "EXAM TIP" 12/16 600 0.06em in `--callout-tip-title` |
| Common trap | TriangleAlert | mono label "COMMON TRAP" in `--callout-trap-title` |
| Note | Info | mono label "NOTE" in `--callout-note-title` |
| Updated | RefreshCw | "Updated" badge + meta "Checked 2026-09-28" (13px `--text-muted`) |
| Needs verification | ShieldQuestionMark | "Needs verification" badge + meta "Open item" |

- Updated callout body: one sentence on what changed, then a two-row grid (`grid-template-columns: auto 1fr`, gap 6/12,
  15/1.5): "SLIDES" mono label (`--text-muted`) → the old statement in `--text-muted`; "NOW" mono label
  (`--callout-updated-title`) → the current statement in `--text`. Then a source link (ExternalLink 14, 14/600,
  `--accent-ink`, min-height 32, opens docs.aws.amazon.com in a new tab).
- Needs-verification body: what could not be confirmed and the instruction "Check before you rely on it". The "Needs
  verification" items are also listed on the Settings page (count) so they can be found again.
- Authoring syntax (remark-directive): `:::tip`, `:::trap`, `:::note`, `:::updated{checked="2026-09-28" slides="…" now="…" source="https://docs.aws.amazon.com/…"}`, `:::verify`. Inline badges: `:badge[Updated]{type=updated}`.

### Tables
- Wrapper: `role="region"`, `aria-label="<caption>, scrolls sideways"`, `tabindex="0"`, `overflow-x: auto`, 1px border
  `--border`, radius 12, bg `--surface`. Table: `width: 100%`, `min-width: 640px` (572px on phone),
  `border-collapse: collapse`.
- Column header `th[scope=col]`: padding `12px 16px` (10 12 on phone), 14/700 `--text`, bg `--surface-2`, bottom
  border `--border`, `white-space: nowrap`.
- Row header `th[scope=row]` (first column): 15/700 `--text` (14 on phone). Cells: 15/1.5, padding `12px 16px`,
  `vertical-align: top`, top border `--border`.
- Zebra: even body rows bg `--surface-3`, odd rows `--surface`. Sticky cells take the row's bg.
- Yes/No cells: Check (`--success`) or X (`--danger`), 16px stroke 2.5, always with the word ("Yes", "No, data is lost").
- Inline badges (Updated, Needs verification) may sit in any cell after the text.
- Phone (< 768px): first column `position: sticky; left: 0; z-index: 1; width: 112px; min-width: 112px;
  border-right: 1px solid var(--border)`; other columns `min-width: 150px`. Under the table: hint row (ArrowRight 14 +
  "Swipe the table sideways to compare", 13px `--text-subtle`), shown only when the table overflows.

### Figure / diagram frame
- `<figure>`: margin 0, bg `--surface`, 1px border, radius 14, `overflow: hidden`.
- Header bar: padding `6px 8px 6px 16px`, bg `--surface-3`, bottom border; mono label "DIAGRAM · FLOWCHART" (diagram
  type from the Mermaid source) + "Expand" ghost md button (Maximize2) with `aria-label="Expand diagram to full screen"`.
- Body: padding `24px 24px 20px`, `overflow-x: auto`; the rendered Mermaid SVG is centred, `max-width: none`,
  inner wrapper `min-width: max-content` so wide diagrams scroll instead of shrinking below legibility.
- `<figcaption>`: padding `12px 16px 14px`, top border, 14/1.5 `--text-muted`, starts with bold "Figure N." in `--text`.
- Expand: dialog (`--z-dialog`, scrim) filling the viewport minus 24px, radius 20, the SVG fitted to the box, toolbar
  with zoom out / percentage / zoom in / fit (same as the map), close button; Esc closes.
- Mermaid renders with the theme in §10 and re-renders when the theme changes. While rendering, show a
  `--surface-2` block 200px high; on a syntax error, show the source in a code block with a "Diagram could not be drawn"
  note in a Note callout.

---

## 7. Learning components

### Flashcard
- Card: `<button>` (whole card flips), min-height 380 (desktop; on phone it fills the free height), padding `28px 32px`
  (phone `22px 20px`), radius 20, 1px border, bg `--surface`, `--shadow-2`, column, gap 16, text-align left.
  `aria-label` states the side: "Flashcard, question side. Press Space to show the answer."
- Head: mono label "06 · EC2 INSTANCE STORAGE" + state chip (New / Due / Learned).
- Front: question centred, display 26/1.35 600 -0.01em, `text-wrap: balance`; below, "Show answer" primary lg with kbd
  "Space".
- Back: the question again (15/1.5 `--text-muted`) + 1px divider; the short answer (display 26/1.3 700); the explanation
  (body-lesson 17/1.65); footer hint 13px `--text-subtle` "Click the card or press Space to flip back".
- Flip: wrapper `perspective: 1200px`; inner `transform-style: preserve-3d; transition: transform var(--dur-flip)
  var(--ease-out)`; back face `transform: rotateY(180deg)`; both faces `backface-visibility: hidden`. Reduced motion:
  cross-fade (opacity, 120ms).
- Rating (shown only after the flip): two equal buttons in a row (gap 12), `flex: 1 1 0`, min-height 64, padding
  `10px 16px`, radius 12 (14 on phone), bg `--surface`, border `--border-strong`, text-align left:
  icon 22 stroke 2 + title 16/700 + interval 13 `--text-subtle` + kbd.
  - Hard: RotateCcw in `--warning`, "Again in 10 min", key 1.
  - Easy: Check in `--success`, "Next in 4 days", key 2.
  - The interval text comes from the scheduler. Hover: bg `--surface-2`. Pressed: border `--control-border`.
- Toolbar above the card: deck selector (segmented: "This section · 18" / "All due · 24") and counts chips (New 6 ·
  Due 9 · Learned 3). Session progress row: mono "7 / 20" 14/600 + 8px bar + "13 left in this session" 13 subtle.
- Hint box under the cards: padding `12px 16px`, radius 12, bg `--info-soft`, border `--info-border`, Info 18 `--info`,
  15px text: "**Hard cards return sooner:** later in this session and again tomorrow. Easy cards wait longer each time."
- Keys: Space flip, 1 Hard, 2 Easy (only after the flip), Esc back to the lesson.

### Quiz option (single and multi-select)
- Container: radius 12, `overflow: hidden`, border and bg by state (below).
- Row is a `<label>`: flex, gap 14, padding `14px 16px`, min-height 56, `cursor: pointer`. Contents: the real `<input
  type="radio|checkbox">` visually hidden over the indicator; indicator 24px; letter mono 14/24 600 `--text-muted`;
  option text 16/1.5; trailing status chip.
- Indicator: radio = circle with 2px ring; checkbox = 24px square, radius 6.

| State | Container | Indicator | Text | Chip |
|---|---|---|---|---|
| default | bg `--surface`, 1px `--border-strong` | 2px ring `--control-border`, fill `--surface` | `--text` | – |
| hover | bg `--surface-3`, 1px `--control-border` | same | same | – |
| selected | bg `--quiz-selected-bg`, 2px `--quiz-selected-border` | 2px ring `--accent` + 12px dot `--accent` (checkbox: filled `--accent` + check) | `--text` | – |
| correct | bg `--quiz-correct-bg`, 2px `--quiz-correct-border` | filled `--success` + Check 16 (stroke 3, `--surface`) | `--text` | "Correct answer" (free, Check); if it was also chosen: "Your answer · correct" |
| incorrect (chosen) | bg `--quiz-incorrect-bg`, 2px `--quiz-incorrect-border` | filled `--danger` + X 16 | `--text` | "Your answer" (notfree, X) |
| disabled (not chosen, wrong, after answering) | bg `--quiz-disabled-bg`, 1px `--quiz-disabled-border` | 2px ring `--border-strong`, fill `--surface-2` | `--text-muted` | – |

- Focus: `:focus-visible` on the hidden input draws the focus ring around the whole option container (`:has()` or a
  wrapper class).
- After answering, inputs get `aria-disabled="true"` and **every** option shows an explanation block: top border (state
  border for correct/incorrect, `--border` otherwise), padding `12px 16px 14px 92px` (aligned to the option text),
  column gap 4: mono label "WHY IT'S RIGHT" (`--success-ink`) or "WHY IT'S WRONG" (`--danger-ink` for the chosen wrong
  option, `--text-subtle` for the others), then 15/1.6 text.
- Result banner above the options (`role="status"`): flex, gap 12, padding `12px 16px`, radius 12. Wrong: bg
  `--danger-soft`, border `--danger-border`, X 20 `--danger`, "**Not quite.** The correct answer is **B**. Read why
  each option is right or wrong." Right: success soft/border, Check, "**Correct.** …".
- Question card: card padding `22px 24px`; chips (domain, difficulty); scenario in body-lesson (72ch); the ask in
  17/1.6 700 ("Which solution … LEAST operational overhead?").
- Quiz header row: "Question 4 / 12" mono 14/600; 8px bar; "Score **2 / 3** correct"; mode chip (Section quiz / Mixed
  review, CircleQuestionMark).
- Multi-select: accent chip "Choose TWO" (ListChecks) above the options; checkboxes; footer row with "2 of 2 selected"
  (13 subtle) and "Check answer" (primary, `aria-disabled` until exactly N are chosen). Choosing more than N is blocked
  and the counter turns `--danger-ink` with "Choose only 2".
- Actions: "Previous" ghost (ArrowLeft) and "Next question" primary (ArrowRight + kbd Enter). Keys: 1–4 or A–D select,
  Enter checks then goes next.

### Exam simulation
- Exam mode hides the sidebar and the search. Header (min-height 68, padding `10px 20px`, `--surface`, bottom border,
  wraps): brand tile + "Exam simulation" (display 17/700) + caption "SAA-C03 practice · 65 questions · 130 minutes".
- **Timer pill** `role="timer"`: height 48, padding `0 16px`, radius 12, gap 10, bg `--surface-2`, border `--border`;
  Timer icon 20; time `MM:SS` in the "timer" type style (§2); caption "left of 130:00" 13 subtle.
  - Warning at ≤ 10:00: bg `--warning-soft`, border `--warning-border`, time `--warning-ink`.
  - Critical at ≤ 5:00: bg `--danger-soft`, border `--danger`, time `--danger-ink`.
  - Screen reader: `aria-live="polite"` announcements only at 30, 10, 5 and 1 minute(s) left (not every second).
  - At 0:00 the exam submits itself and shows the results.
- Right side: "Question 23 / 65" mono 14/600 `--text-muted`; "Flag for review" secondary (Flag) with `aria-pressed`;
  pressed state: bg `--warning-soft`, border `--nav-flagged-border`, text `--warning-ink`, flag icon filled; "Submit
  exam" primary.
- Question card: label "QUESTION 23 OF 65" + "Choose ONE"/"Choose TWO"; options in default/selected states only, no
  feedback and no domain chip during the exam.
- Footer: "Previous" secondary, "Flag for review" ghost, "Next" primary. Keys: N next, P previous, F flag, 1–4 select.
- **Navigator panel** (`aside`, sticky top 84): padding `18px 20px`, radius 14, `--surface`, border, `--shadow-1`, gap
  16. Head: "Questions" (h4) + "21 of 65 answered" + 6px bar. Grid `repeat(6, minmax(0, 1fr))`, gap 8.
  - Cell `<button>`: height 44, radius 8, 1px border, mono 14/600, `aria-label="Question 9, unanswered, flagged"`.
  - Answered: `--nav-answered-*`. Unanswered: `--nav-unanswered-*`. Flagged: `--nav-flagged-*` plus Flag icon 11px
    (stroke 2.5, `--warning`) in the top-right corner (3px inset); flagged wins over answered visually, the label says
    both. Current: `--nav-current-*` + `box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent)` and
    `aria-current="step"`. Hover: border `--control-border`.
  - Legend (2×2 grid): 16px swatch (radius 4) + name + count (mono): Answered, Flagged, Current, Unanswered.
  - "Review flagged (3)" secondary, full width (filters the navigator to flagged questions).
- **Submit dialog** (`role="dialog" aria-modal="true"`): width `min(540px, 100%)`, padding 24, radius 20, `--surface`,
  border, `--shadow-3`, over `--scrim`. Title "Submit the exam?" (display 24/700) + close icon button. Body 16/1.6:
  "**44 questions are unanswered** and 3 are flagged for review. Unanswered questions count as wrong. You cannot change
  answers after you submit." 2×2 summary tiles (padding `12px 14px`, radius 10, `--surface-3`, border; label 13 muted;
  value mono 22/600; Flagged value `--warning-ink`, Unanswered value `--danger-ink`). Actions right-aligned, wrapping:
  "Review flagged (3)" secondary, "Keep working" ghost (initial focus), "Submit exam" primary. Esc = Keep working.
  With nothing unanswered, the body reads "All 65 questions are answered."

### Results
- Header: mono label "EXAM SIMULATION · ATTEMPT 3", h1 "Results", meta 15 muted ("Finished 2026-10-02 · 112 of 130
  minutes used · 49 of 65 correct"); actions "Retake exam" secondary (RotateCcw), "Review wrong answers (16)" primary.
- **Score dial**: 240×240 SVG; 270° arc starting at 135° (lower left) clockwise; radius 88, stroke 16, round caps;
  track `--surface-2`; value arc `--success` when ≥ 720, else `--danger`; pass tick at 720 (angle 135° + 0.72 × 270°)
  drawn from radius 70 to 106, stroke 3, `--text`; label "720" mono 12/600 at radius 118. Centre (HTML over the SVG):
  score `--type-display` tabular, "of 1000" mono 13 muted, Pass chip (pass colours + Check) or Fail chip (notfree + X).
  The SVG has `role="img" aria-label="Score 734 of 1000, pass mark 720"`.
- Beside the dial: h3 "You passed, 14 points above the line" / "Not yet, 32 points below the line"; 2×2 stat tiles
  (Correct, Pass mark, Time used, Previous best); disclaimer 13 subtle: "Practice estimate. The real exam scales scores
  from 100 to 1000 and includes unscored questions." Practice score = `100 + round(900 × correct / total)`.
- **By exam domain** card: one row per domain, separated by 1px lines, padding 12/0: 10px domain square + domain name
  15/600 + mono neutral chip "30% of exam"; then a 10px bar in the domain colour + "16/20 · 80%" mono 13 muted (width
  92, right-aligned). Domains and weights: Design Secure Architectures 30%, Design Resilient Architectures 26%, Design
  High-Performing Architectures 24%, Design Cost-Optimized Architectures 20%.
- **By section** card: weakest first; each row is a link (min-height 44, top border): grid `28px 1fr minmax(60px, 120px)
  44px` → number mono 12 subtle, name 14 (ellipsis), 6px bar, "2/5" mono 13. Bar colour: < 50% `--danger`, 50–79%
  `--warning`, ≥ 80% `--success` (the numbers carry the meaning; colour is a second cue).
- **Review wrong answers**: rows (links, min-height 64, top border, gap 14): "Q8" mono 13/600 muted (width 36); stem
  15/1.45 clamped to 2 lines; meta 13 subtle "Design Resilient Architectures · You chose **B** · correct **D**" (B in
  `--danger-ink`, D in `--success-ink`); ChevronRight 18. "See all 16" link in the card header. Opening one shows the
  question in the answered quiz state.

### Weak areas
- Header: h1 "Weak areas" + 16/1.6 muted description; "Practice all (23)" primary lg (Play).
- Tools row: segmented filter "All · 23 / Questions · 14 / Flashcards · 9"; sort button "Weakest first" (secondary,
  Funnel + ChevronDown; options Weakest first, Most missed, Section order).
- Section group card (padding `20px 24px`, gap 18):
  - Head (wraps, gap 12/16): number tile 48×48 (radius 12, `--surface-2`, display 20/700); title h3 + chips "4 missed
    questions" (notfree, CircleQuestionMark) and "3 hard cards" (verify, Layers); sparkline + accuracy; "Practice these
    (7)" primary (Play).
  - Sparkline: 96×32 SVG, polyline stroke 2 `--accent`, round joins, end dot r 3 `--accent`, dashed reference line at
    72% (`--border`, dash 3 3), y range 0–100%, last 6 sessions; `role="img"` with a text alternative ("Accuracy trend,
    last 6 sessions: 40 to 58 percent"). Next to it: accuracy mono 16/600 and delta 12 subtle ("+18 pts").
  - Body: two columns (`auto-fit, minmax(min(320px, 100%), 1fr)`, gap 8/32): "QUESTIONS YOU KEEP MISSING" list (stem
    15/1.45; meta 13 subtle "Missed 3 of 4 · last seen 2 days ago") and "CARDS YOU RATE HARD" list (front text 15/1.45 +
    "Hard ×3" badge). Items separated by 1px lines, padding 10/0. Items are links to the question/card.
- Collapsed group: `<button aria-expanded="false">` min-height 72, number tile + title (display 20/600) + counts +
  ChevronDown.
- Rules: a question is listed when missed ≥ 2 times in its last 4 attempts and leaves after 2 correct answers in a row.
  A card is listed when rated Hard ≥ 2 times in its last 5 reviews and leaves after 2 Easy ratings in a row.
- Empty state: Target icon 32 `--text-subtle`, h3 "No weak areas yet", 15px muted "Answer some quiz questions and review
  flashcards; anything you keep missing shows up here."

### Lab
- **Header**: row (wraps, gap 10/12): mono label "LAB 06", Free Tier chip or Not Free Tier chip, neutral chip "Console
  + CLI" (Terminal). Title h2 at 28px. Meta tiles grid (auto-fit min 200, gap 12): tile padding `14px 16px`, radius 12,
  `--surface`, border; icon 20 `--accent`; mono label (OBJECTIVE / ESTIMATED TIME / ESTIMATED COST); value 15/1.45.
- **Not Free Tier banner** (only when the lab costs money; placed between the title and the meta tiles):
  `role="alert"`, flex, gap 16, padding `18px 20px`, radius 14, **2px border `--danger`**, bg `--danger-soft`. Icon tile
  40×40 radius 10 bg `--danger` with OctagonAlert 22 in `--surface`. Title display 19/700 `--danger-ink` "Not Free
  Tier: this lab costs money". Body 16/1.6: what is billed and the expected cost. A required checkbox (danger style)
  "I understand the cost and will run the cleanup at the end." Then "Show steps" primary (`aria-disabled` until the box
  is checked) and "Pricing page" ghost (ExternalLink). Steps stay collapsed until acknowledged; the acknowledgement is
  saved per lab.
- **Prerequisites**: h3 + bulleted list 16/1.6 (padding-left 22, gap 6), inline code allowed.
- **Steps**: h3 "Steps" + "Show steps for" (14 muted) + Console/AWS CLI segmented control on the same row (wraps).
  Ordered list, gap 12. Step card `<li>`: padding `16px 20px`, radius 14, `--surface`, border, gap 12.
  - Head is a disclosure `<button aria-expanded>` (min-height 44, gap 14): number circle 32 (open: bg `--accent`, text
    `--accent-contrast`, mono 14/600; done: bg `--success` + Check 16; closed: bg `--surface-2`, text `--text-muted`),
    title h4, chevron 18.
  - Body (padding-left 46, gap 14): instruction text 16/1.65; code block; "What to verify" box.
  - "What to verify" box: flex, gap 12, padding `12px 16px`, radius 12, bg `--success-soft`, border `--success-border`;
    CircleCheck 20 `--success`; mono label "WHAT TO VERIFY" `--success-ink`; text 15/1.6 with inline code.
  - Console variant shows numbered console instructions with the exact menu path in bold ("**EC2 › Volumes › Create
    volume**") instead of the code block.
- **Cleanup** (always visible, after the steps): `<section aria-labelledby>`, padding `20px 22px`, radius 14, **2px
  border `--danger`**, bg `--danger-soft`, gap 14. Head: icon tile 36 radius 10 bg `--danger` with Trash 20 in
  `--surface`; title display 20/700 `--danger-ink` "Cleanup · required"; sub 14 `--text` "Delete everything you created
  so nothing keeps billing." Then the cleanup code block and a checklist with danger checkboxes (the last item checks
  that nothing is left).
- **Mark lab complete**: row card (padding `18px 20px`, radius 14): primary lg with CircleCheck, `aria-disabled` until
  every cleanup item is checked; helper 14 muted "Finish the cleanup checklist (1 of 4 done) to complete this lab."
  When done: label "Lab complete", success chip, and the lab counts on the dashboard.
- **Progress panel** (right, sticky top 72, `flex: 1 1 240px; max-width: 280px`, padding `16px 18px`, radius 14): mono
  "YOUR PROGRESS" + "2 / 6"; 6px bar; checklist (Prerequisites ready, each step, Cleanup done (danger box)).
  Checklist state is saved per lab in localStorage.

### Checklist item
- `<label>`: flex, `align-items: flex-start`, gap 12, min-height 44, padding `10px 0`, `position: relative`.
- Real `<input type="checkbox">` absolutely positioned over the visual box (22×22, `opacity: 0`).
- Visual box 22×22, radius 6: unchecked bg `--surface` + 2px `--control-border`; checked bg `--accent` + Check 16
  (stroke 3, `--accent-contrast`). Cleanup items use `--danger` fill with a `--surface` check.
- Text 15/22 `--text`; optional sub-line 13 subtle. Progress items that are done get `text-decoration: line-through` and
  `--text-muted`. Focus ring on the box (`input:focus-visible + .box`).

### Code block
- Wrapper: 1px `--code-border`, radius 12, bg `--code-bg`, `overflow: hidden`.
- Header: min-height 44, padding `0 4px 0 14px`, bg `--code-header-bg`, bottom border; mono label 11px "AWS CLI · BASH"
  (`--text-muted`); Copy button (ghost, min-height 44, padding `0 12px`, radius 8, Copy 16 + "Copy" 13/600 `--text-muted`,
  `aria-label="Copy command"`). After copy: Check icon + "Copied" in `--success-ink` for 2 s, announced via an
  `aria-live="polite"` region.
- `<pre>`: margin 0, padding `14px 16px`, `overflow-x: auto`, mono 14/1.65, `--code-text`, `tab-size: 2`.
- Token colours: prompt `$ ` `--code-prompt` with `user-select: none` (never copied); command (`aws ec2
  create-volume`) `--code-command`; flags (`--size`) `--code-flag`; strings `--code-string`; comments `--code-comment`;
  values `--code-text`. Line continuation `\` stays `--code-text`.
- Copy copies the command text without prompts and without the `#` comment lines.
- Inline code: mono 14px, padding `1px 6px`, radius 6, bg `--code-bg`, 1px `--code-border`.

### Stat tile, progress bar, progress ring
- Stat tile: min-height 124, padding `16px 18px`, radius 14, `--surface`, border, `--shadow-1`, column gap 6: label
  13/600 muted + icon 18 subtle (top right); value `--type-number` with optional suffix 15/500 subtle (" / 36"); sub
  line 13 subtle. The "Course complete" tile shows a 44px ring (stroke 6, track `--surface-2`) beside "27%" instead of
  the icon. Dashboard tiles, in order: Course complete, Lessons read, Flashcards due, Average quiz score, Labs
  completed, Best exam score.
- Progress bar: `role="progressbar"` with `aria-valuenow/min/max` and `aria-label`; track `--surface-2`, pill radius,
  height 6 (compact) / 8 (default) / 10 (results); fill `--accent` (complete: `--success`; domain bars: domain colour);
  width transition `--dur-slow`.
- Progress ring: SVG, starts at 12 o'clock, round caps; 18px / stroke 2.5 (sidebar), 44px / stroke 6 (dashboard).

### Dashboard cards
- "Continue where you left off": mono label; 64×64 number tile (radius 12, `--accent-soft`, `--accent-ink`, display
  28/700) + title h3 22px + meta 14 muted; 8px bar + "60% read" mono 13; next-up row (padding `12px 14px`, radius 10,
  `--surface-3`, border, ArrowRight 16 accent, "Next up: **…**"); buttons "Resume lesson" primary (Play) and "12 cards
  due here" secondary (Layers).
- "Progress by part": h3 + "sections read" caption; rows grid `minmax(0,1fr) minmax(72px,160px) 36px`, gap 12,
  min-height 30: "P1" mono 12 subtle + part name 14 (ellipsis), 6px bar, "2/2" mono 12 right-aligned.

---

## 8. Search palette
- Opens with Ctrl/Cmd+K, "/" or the top-bar trigger. `role="dialog" aria-modal="true" aria-label="Search"`, width
  `min(680px, 100% - 32px)`, top offset 88px, radius 16, `--surface`, border, `--shadow-3`, over `--scrim`
  (`--z-palette`). Phone: full-screen sheet (inset 0, radius 0).
- Input row: min-height 60, padding `0 16px`, gap 12, bottom border; Search 22 (stroke 2, `--accent`); input 18px,
  no border, transparent; kbd "Esc". The input is a combobox (`role="combobox" aria-expanded aria-controls
  aria-activedescendant`). Debounce 80ms; MiniSearch with prefix + fuzzy (0.2) over title, body and tags.
- Filter pills row: padding `10px 16px`, gap 6, bottom border, scrolls sideways. Pill `<button aria-pressed>`: height
  32 (44 hit area), padding `0 12px`, pill, 13/600. Off: bg `--surface`, border `--border`, text `--text-muted`. On:
  bg `--accent-soft`, border `--accent-soft-border`, text `--accent-ink`. Labels carry counts ("Lessons 3").
- Results `role="listbox"`: padding `6px 8px 10px`, `max-height: min(560px, 60vh)`, scrolls. Groups in this order:
  Lessons, Flashcards, Quiz questions, Labs; each with a mono label + count (padding `10px 12px 4px`); max 5 per group
  plus "Show all N".
- Option `role="option"`: min-height 60, padding `8px 12px`, radius 10, gap 14: icon tile 36 (radius 9, bg
  `--surface-2`, border, icon 18 `--text-muted`: BookOpen / Layers / CircleQuestionMark / FlaskConical); title 15/600
  and snippet 13 `--text-muted`, each one line with ellipsis; right meta: section number mono 12 subtle.
  Active (`aria-selected="true"`): bg `--accent-soft`, icon tile bg `--surface` with `--accent-ink` icon, meta replaced
  by "Open" + kbd Enter in `--accent-ink`. Hover sets active.
- Match highlight: `<mark>` bg `--mark-bg`, text `--mark-text`, radius 3, padding `0 2px`, on every matched term in the
  title and the snippet. Snippets are ±60 characters around the first match, with "…" at cut ends.
- Footer: padding `10px 16px`, top border, bg `--surface-3`, 13px muted: "↑ ↓ move · Enter open · Tab next group · Esc
  close" with kbd keys.
- Keys: ↑/↓ move (wraps), Enter opens (lesson scrolls to the matching heading; card opens in the flashcard tab; question
  opens in the quiz tab; lab opens the lab tab), Tab / Shift+Tab jump between groups, Esc closes and restores focus.
- Empty query: show "Recent" (last 5 opened items). No results: "No matches for "<query>". Try a service name like S3
  or a term like failover." in 15px muted, centred, padding 32.

---

## 9. Knowledge map

Implementation: one React component with an HTML layer for nodes, labels and the hover card, and one SVG layer for the
edges, both inside a transformed "world" div. Pan and zoom with `d3-zoom` (already installed) on the viewport. The layout
is deterministic (no force simulation), so the map looks the same on every visit.

- **Card**: `<section aria-label="Knowledge map">`, `--surface`, border, radius 14, `--shadow-1`, `overflow: hidden`.
  Header (padding `16px 20px`, bottom border, wraps): Map icon 22 `--accent`, h2 at 20px "Knowledge map", caption 13
  subtle "40 services in 10 categories · hover a service to see what it connects to"; controls: "All categories"
  secondary (Funnel + ChevronDown, opens a menu of 10 category checkboxes) and the zoom group.
- **Zoom group**: `role="group" aria-label="Zoom"`, border `--border-strong`, radius 10, `overflow: hidden`, bg
  `--surface`: Minus (44×44) | zoom % (mono 13 muted, min-width 60) | Plus (44×44) | Maximize "Fit to view" (44×44),
  1px `--border` dividers. Zoom steps 50, 75, 100, 125, 150, 200%. Ctrl+wheel / pinch zoom, drag to pan, keys + − 0
  when the map has focus.
- **Viewport**: `overflow: hidden` (pan instead of scroll), height 612px at 100% on desktop, background `--surface` with
  a dot grid `background-image: radial-gradient(var(--map-dot) 1px, transparent 1.4px); background-size: 16px 16px`
  (the dots move with pan/zoom).
- **Footer legend**: padding `14px 20px`, top border, wrap row gap 10/18: 10×10 square (radius 3) in the category colour
  + name 13 muted, for all 10 categories; right-aligned note 13 subtle "Arrow = relationship · click a service to open
  its lesson".

### Geometry (world coordinates at 100%)
- 10 cluster frames in 2 rows × 5 columns. Frame width 160; column x = 20 + 216 × col (56px gutters); row 1 top 56,
  row 2 top 362 (88px gap between rows). Frame: 1px dashed `--map-band-border`, radius 12, bg `--map-band-bg`.
- Row 1 order: Networking, Compute, Storage, Analytics, Databases. Row 2: Security & Identity, Integration, Monitoring &
  Mgmt, Machine Learning, Migration. (Neighbours were chosen so the most common relations are straight lines.)
- Frame label: 8×8 category square + mono 11/16 600 uppercase 0.05em `--text-muted`, 12px from the frame's left edge;
  inside the top of row-1 frames (y + 10) and the bottom of row-2 frames, so vertical edges can enter through the gap.
- Slots: nodes 136×34 at x = frame x + 12; row 1 node y = 96 + 44 × slot; row 2 node y = 374 + 44 × slot. Frame height =
  40 + 44 × n − 10 + 12 (218 for 4 slots). More than 6 services in a category: the frame grows and the row below moves
  down by the same amount.
- Service data lives in `content/services.json`: `{ id, name, short, category, slot, description, lessons: [sectionId],
  edges: [{ to, label }] }`. Fallback slot = order in the file.

### Nodes
- `<button>` with `aria-label` = full name: 136×34, radius 8, bg `--surface`, 1px `--map-node-border`, padding `0 8px`,
  gap 7; category square 10×10 radius 3; short label (body 13/600 `--text`, one line, ellipsis).
- Hover / focus: 2px `--accent` border, `--shadow-2`, raised above others. Connected neighbours: 2px `--accent` border.
  Selected (click or Enter): same as hover, hover card pinned, "Open lesson" link focused. Double-click opens the lesson.
- Filtered-out categories: nodes and their edges at `opacity: 0.25`, not focusable.
- Optional "Focus mode" setting: on hover, fade every node and edge that is not connected to 40%.

### Edges
- Drawn in one SVG layer, `stroke: var(--map-edge)`, width 1.5, round caps/joins, filled arrowhead marker 5×5 at the
  target end; only horizontal and vertical segments (right angles, 8px corner radius allowed).
- Routing: same slot row, neighbouring columns → straight horizontal line between the facing node edges (2px short of
  the target). Bottom slot of a row-1 frame to top slot of the row-2 frame in the same column → straight vertical line.
  Anything else: leave the source on the side facing the target, run into the nearest gutter (column gutter centre or
  the 88px row gap centre), travel along gutters, enter the target from the facing side.
- Label: body 12/16 500 `--text-muted` on a `--surface` background (radius 4, padding `0 4px`), at the midpoint of the
  longest segment: above a horizontal segment (top = y − 28) or right of a vertical one (left = x + 12, centred
  vertically). If more than 16 edges are visible, labels show only for edges touching the hovered/selected node.
- Highlighted edge (touches the hovered/selected node): stroke `--accent`, width 2; label `--accent-ink`, 700.

### Hover card
- `role="tooltip"` (pinned on click: `role="dialog"` non-modal), width 196–240, padding `12px 14px 14px`, radius 12,
  `--surface`, border, `--shadow-3`, column gap 6: category row (8px square + mono 11 label), full name 15/1.3 700,
  one-sentence description 13/1.45 muted, relations (ArrowRight 14 `--accent` + "routes to **EC2**", one line each),
  1px divider, lesson link 13/600 `--accent-ink` ("07 Elastic Load Balancing"), counts 12 subtle ("18 cards · 9
  questions").
- Placement: below-right of the node with a 10px offset, flipped to stay inside the viewport; appears after 150ms hover
  or immediately on keyboard focus; Esc hides it.

### Keyboard and phone
- The map is one tab stop (`role="application"` is not used); inside it, arrow keys move between nodes by grid
  position, Enter selects, Esc clears. A visually hidden list of all services and relations follows the map for screen
  readers.
- Phone: the header adds a Map / List segmented control (List by default). List view: categories as collapsible groups,
  each service a row (category square, name, relations as text "routes to EC2"), tapping opens the lesson.

---

## 10. Mermaid theme

Use `theme: 'base'` (themeVariables need real hex values, so keep these objects in TypeScript next to the CSS tokens)
and re-initialise + re-render all diagrams when the theme changes.

```ts
// src/lib/mermaidTheme.ts
export const mermaidLight = {
  theme: 'base',
  fontFamily: "'Atkinson Hyperlegible Next', 'Segoe UI', system-ui, sans-serif",
  flowchart: { curve: 'linear', htmlLabels: true, padding: 12, nodeSpacing: 48, rankSpacing: 56 },
  sequence: { mirrorActors: false, actorMargin: 48 },
  themeVariables: {
    darkMode: false,
    fontFamily: "'Atkinson Hyperlegible Next', 'Segoe UI', system-ui, sans-serif",
    fontSize: '15px',
    background: '#FFFFFF',
    primaryColor: '#FFFFFF',        primaryBorderColor: '#B3BECA', primaryTextColor: '#121820',
    secondaryColor: '#E7ECFD',      secondaryBorderColor: '#BAC6F6', secondaryTextColor: '#121820',
    tertiaryColor: '#F9FAFC',       tertiaryBorderColor: '#C3CCD6', tertiaryTextColor: '#4D5966',
    mainBkg: '#FFFFFF',  nodeBorder: '#B3BECA',  nodeTextColor: '#121820',
    lineColor: '#4D5966', textColor: '#121820', titleColor: '#121820',
    clusterBkg: '#F9FAFC', clusterBorder: '#C3CCD6',
    edgeLabelBackground: '#FFFFFF',
    noteBkgColor: '#FCF2DF', noteBorderColor: '#E9CB8F', noteTextColor: '#121820',
    actorBkg: '#FFFFFF', actorBorder: '#B3BECA', actorTextColor: '#121820', actorLineColor: '#7D8996',
    signalColor: '#4D5966', signalTextColor: '#121820',
    labelBoxBkgColor: '#EDF1F5', labelBoxBorderColor: '#B3BECA', labelTextColor: '#121820', loopTextColor: '#4D5966',
    activationBkgColor: '#E7ECFD', activationBorderColor: '#2F4FD8', sequenceNumberColor: '#FFFFFF',
    errorBkgColor: '#FCEBE9', errorTextColor: '#9C271E',
  },
  themeCSS: `
    .cluster-label, .cluster-label span { font-family: 'JetBrains Mono', monospace; font-size: 11px;
      letter-spacing: .05em; text-transform: uppercase; fill: #4D5966; color: #4D5966; }
    .edgeLabel, .edgeLabel p { font-size: 13px; color: #4D5966; background: #FFFFFF; }
    .node rect, .node polygon, .node circle { rx: 10px; ry: 10px; stroke-width: 1px; }
    .cluster rect { stroke-dasharray: 4 3; rx: 12px; ry: 12px; }
    .flowchart-link { stroke-width: 1.5px; }
  `,
} as const;

export const mermaidDark = {
  ...mermaidLight,
  themeVariables: {
    ...mermaidLight.themeVariables,
    darkMode: true,
    background: '#151A21',
    primaryColor: '#1C232C',        primaryBorderColor: '#3B4652', primaryTextColor: '#E4E9EE',
    secondaryColor: '#1E2547',      secondaryBorderColor: '#3A4790', secondaryTextColor: '#E4E9EE',
    tertiaryColor: '#171D25',       tertiaryBorderColor: '#36414D', tertiaryTextColor: '#A5B0BC',
    mainBkg: '#1C232C',  nodeBorder: '#3B4652',  nodeTextColor: '#E4E9EE',
    lineColor: '#A5B0BC', textColor: '#E4E9EE', titleColor: '#E4E9EE',
    clusterBkg: '#171D25', clusterBorder: '#36414D',
    edgeLabelBackground: '#151A21',
    noteBkgColor: '#2A2110', noteBorderColor: '#6E5322', noteTextColor: '#E4E9EE',
    actorBkg: '#1C232C', actorBorder: '#3B4652', actorTextColor: '#E4E9EE', actorLineColor: '#6B7785',
    signalColor: '#A5B0BC', signalTextColor: '#E4E9EE',
    labelBoxBkgColor: '#1C232C', labelBoxBorderColor: '#3B4652', labelTextColor: '#E4E9EE', loopTextColor: '#A5B0BC',
    activationBkgColor: '#1E2547', activationBorderColor: '#8B9EFF', sequenceNumberColor: '#0B1020',
    errorBkgColor: '#2D1614', errorTextColor: '#FFB3A9',
  },
  themeCSS: mermaidLight.themeCSS
    .replaceAll('#4D5966', '#A5B0BC')
    .replace('background: #FFFFFF', 'background: #151A21'),
} as const;
```

Optional class definitions authors may use inside diagrams (append to each diagram at render time):

```
classDef accent fill:#E7ECFD,stroke:#2F4FD8,color:#121820;        %% light
classDef warn fill:#FCF2DF,stroke:#C98A1B,color:#121820;
classDef bad fill:#FCEBE9,stroke:#BF3328,color:#121820;
%% dark equivalents: accent fill:#1E2547,stroke:#8B9EFF,color:#E4E9EE; warn fill:#2A2110,stroke:#C99A3E; bad fill:#2D1614,stroke:#FF8A7D
```

---

## 11. Accessibility checklist (applies to every screen)

- Text contrast ≥ 4.5:1 (all token pairs in §3 pass in both themes); graphics and control borders ≥ 3:1.
- Status is never colour alone: correct/incorrect also have icons and the words "Correct answer" / "Your answer"; progress
  dots have aria-labels; bars show numbers; navigator cells have full aria-labels.
- Real elements only: `<button>`, `<a href>`, `<input>` + `<label>`; no click handlers on divs.
- Visible focus ring everywhere (§4); dialogs, drawer and palette trap focus and restore it on close.
- Keyboard shortcuts are listed in Settings › Keyboard and can be turned off (single-key shortcuts must be disableable).
- `prefers-reduced-motion` honoured (§4). Body text never below 13px; lesson text 17px; zoom to 200% without loss.
- Live regions: quiz result (`role="status"`), copy confirmation, timer thresholds, "Saved" toasts.

---

## 12. Icons

Use `lucide-react` (ISC licence, already installed, v1.x names below were checked against the installed package).
Default size 18 in buttons, 20 in navigation, 16 in compact rows, 14 in chips; `strokeWidth={1.75}` for UI icons, 2 for
status icons in tiles, 2.5–3 for 11–16px status glyphs (checks, flags). Icons are `aria-hidden` unless they are the only
content of a control (then the control gets `aria-label`).

| Use | lucide-react name |
|---|---|
| Search, palette | `Search` |
| Theme toggle | `Moon` (in light mode) / `Sun` (in dark mode) |
| Settings | `SlidersHorizontal` |
| Expand/collapse, next/back | `ChevronDown`, `ChevronRight`, `ChevronLeft` |
| Home | `House` |
| Flashcards, review | `Layers` |
| Weak areas, objective | `Target` |
| Exam simulation, timer | `Timer` |
| Lesson tab | `BookOpen` |
| Quiz tab, question | `CircleQuestionMark` |
| Lab tab | `FlaskConical` |
| Correct, done, Easy | `Check` |
| Wrong, close | `X` |
| Mark as read, verify box, Free Tier, complete | `CircleCheck` |
| Estimated time | `Clock` |
| Slide range | `Presentation` |
| Expand diagram | `Maximize2` |
| Fit map to view | `Maximize` |
| Exam tip | `Lightbulb` |
| Common trap | `TriangleAlert` |
| Note, hint | `Info` |
| Updated | `RefreshCw` |
| Needs verification | `ShieldQuestionMark` |
| Flag for review | `Flag` |
| Copy code | `Copy` |
| AWS CLI | `Terminal` |
| Console | `Monitor` |
| Previous / next, relation | `ArrowLeft`, `ArrowRight` |
| Phone menu | `Menu` |
| Zoom in / out | `Plus`, `Minus` |
| Hard (again soon), retake | `RotateCcw` |
| Estimated cost | `DollarSign` |
| Not Free Tier | `OctagonAlert` |
| Trend | `TrendingUp` |
| Cleanup | `Trash` |
| Enter hint | `CornerDownLeft` |
| Knowledge map | `Map` (import as `Map as MapIcon` to avoid shadowing the JS `Map`) |
| Resume, practice | `Play` |
| External docs link | `ExternalLink` |
| Choose TWO | `ListChecks` |
| Filter, sort | `Funnel` |
| Best exam score | `Award` |
| Difficulty | `SignalLow`, `SignalMedium`, `SignalHigh` |
| Results chart | `ChartColumn` |

Logo (inline SVG, not from lucide), drawn in `--accent-contrast` on a 30×30 `--accent` tile with radius 8:

```html
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/>
  <path d="M8.5 6h7M7.2 8.2l3.6 7.6M16.8 8.2l-3.6 7.6"/>
</svg>
```

---

## 13. Artboards on the canvas

| Canvas row | Artboard | Shows |
|---|---|---|
| Desktop — light | Home | Sidebar (Parts 1–2 open), top bar, dashboard tiles, continue card, progress by part, knowledge map with ALB hovered (highlighted edge + hover card), legend, zoom controls |
| | Lesson | Section header, sticky tabs, summary, key concepts, exam tip, diagram figure, comparison table with inline Updated badge, trap, note, Updated callout (slides vs now), Needs-verification callout, prev/next, On-this-page TOC + section progress |
| | Flashcards tab | Deck selector, New/Due/Learned counts, session progress, front and back states side by side, Hard/Easy with key hints, hint box |
| | Quiz tab — answered | Chosen wrong (D), correct (B), explanation under every option, result banner, score/progress; "Choose TWO" checkbox inset |
| | Lab tab | Lab header with Free Tier chip and meta tiles, prerequisites, steps with Console/AWS CLI control, CLI code with Copy, What-to-verify, cleanup (red), disabled Mark lab complete, progress checklist |
| | Lab header — Not Free Tier | The warning-banner variant with acknowledgement checkbox |
| | Exam simulation | Timer 87:12, Question 23/65, Flag, Submit, navigator grid with all four states and legend |
| | Exam — submit dialog | Dialog over the exam with the 2×2 summary |
| | Exam results | Score dial (734, pass line 720), domain breakdown, by-section bars, review wrong answers |
| | Weak areas | Grouped sections with sparklines, missed questions, hard cards, Practice buttons, a collapsed group |
| | Search palette | Overlay with filter pills, grouped results, highlighted matches, active row, key hints |
| Dark mode | Home — dark, Lesson — dark | Same content in the dark tokens (callouts and table included) |
| Phone | Phone — lesson | 390×844: hamburger top bar, scrollable tabs, table in a scroll box with sticky first column, bottom action bar |
| | Phone — course drawer | Drawer open over the lesson with scrim |
| | Phone — flashcards, dark | Flipped card, progress, counts, Hard/Easy in the bottom bar |

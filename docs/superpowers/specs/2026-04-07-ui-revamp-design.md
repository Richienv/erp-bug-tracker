# UI Revamp Design — ERP Bug Tracker
**Date:** 2026-04-07  
**Status:** Approved

---

## Overview

A full visual overhaul of `bug_tracker.html` to a clean, minimal, professional aesthetic inspired by Notion and Claude/Anthropic's design language. The app remains a single HTML file with embedded CSS and JS. No frameworks, no build step.

---

## Color & Typography

### Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#faf9f7` | Page background (warm off-white) |
| `--surface` | `#f2f0ec` | Row hover, card backgrounds |
| `--border` | `#e8e5df` | All borders and dividers |
| `--text` | `#1a1a1a` | Primary body text |
| `--muted` | `#8c8a85` | Labels, secondary info |
| `--accent` | `#d97706` | Buttons, active states (Anthropic orange) |
| `--accent-light` | `#fef3c7` | Accent tint backgrounds |
| `--white` | `#ffffff` | Modal, side panel backgrounds |

### Status badge colors (light-mode only)

| Status | Text | Background |
|---|---|---|
| Open | `#dc2626` | `#fff1f1` |
| In Progress | `#d97706` | `#fffbeb` |
| Fixed | `#2563eb` | `#eff6ff` |
| Verified | `#16a34a` | `#f0fdf4` |
| Closed | `#6b7280` | `#f5f5f5` |

### Fonts

- **Body:** `Inter` (Google Fonts) — 14px base, weights 400/500/600
- **IDs / monospace:** `JetBrains Mono` — used only for bug IDs (ERP-001 etc.)

---

## Layout

Single-column layout. No sidebar. Everything lives in a top nav + table + optional side panel.

```
┌──────────────────────────────────────────────────────────────┐
│  ERP Bugs   [All 12][Open 4][In Progress 2][Fixed 3]...  [+ New Bug] │
├──────────────────────────────────────────────────────────────┤
│  [Search...]                              [Module ▾]         │
├──────────────────────────────────────────────────────────────┤
│  ID        Title / Module               Status   Reporter  Date │
│  ──────────────────────────────────────────────────────────  │
│  ERP-001   Invoice limit not enforced   Open     Richie    Apr 7 │
│  ERP-002   COA sort broken              Fixed    Darren    Apr 6 │
└──────────────────────────────────────────────────────────────┘
                                    ┌─────────────────────────┐
                                    │  ERP-001                │
                                    │  Invoice limit not…     │
                                    │                         │
                                    │  Description            │
                                    │  Fix notes              │
                                    │  Verified by / Notes    │
                                    │  Screenshots            │
                                    │  ─────────────────────  │
                                    │  [→ In Progress] [Edit] │
                                    └─────────────────────────┘
```

---

## Components

### Top Nav

- Left: `ERP Bugs` wordmark — Inter 600, `--text`
- Center-left: Filter tabs — `All · Open · In Progress · Fixed · Verified · Closed`. Each tab shows a count pill. Active tab has `--accent` underline and text.
- Right: Search input (icon + placeholder, focuses with bottom border only), Module dropdown, `+ New Bug` button (accent orange, rounded)

### Bug Table

- Full-width, no outer border or card
- Header row: uppercase 11px labels, `--muted` color
- Each row: `1px` bottom border (`--border`), no left/right borders, no box-shadow
- Hover: background transitions to `--surface`
- Columns: ID (mono, muted) · Title + module subtitle · Status badge · Reporter · Date · paperclip icon if screenshots exist
- Click anywhere on row → opens side panel

### Side Panel

- `420px` wide, fixed right, full viewport height
- Background: `--white` (`#fff`)
- Left border: `1px solid --border`
- Backdrop: `rgba(0,0,0,0.15)` covering the rest of the page, click to dismiss
- Slides in with a `transform: translateX` transition (200ms ease)
- Sections (top to bottom):
  1. Bug ID (mono, muted) + close `×` button
  2. Title (18px, 600)
  3. Module badge (small pill)
  4. `Description` section
  5. `Fix notes` section
  6. `Verified by` + `Notes` (if present)
  7. Screenshots grid (before/after, if present)
  8. Pinned bottom action bar: `→ Mark "[next status]"` · `Edit` · `Delete`

### New / Edit Modal

- Centered overlay, `560px` wide
- Background: `#fff`, `border-radius: 12px`
- Shadow: `0 8px 32px rgba(0,0,0,0.12)` — single clean shadow, no border
- Form fields: warm gray labels (uppercase 11px), clean inputs with bottom-border-only focus
- Actions: `Cancel` (ghost) · `Save Bug` (accent orange) — right-aligned

### Delete Confirmation

- Inline within the side panel action bar — expands to a small inline confirm row
- No separate modal needed

---

## Removed from Current Design

| Removed | Reason |
|---|---|
| Left sidebar | Replaced by top nav filter tabs |
| Stats row (5 counters) | Counts moved into nav filter tabs |
| Inline row expand | Replaced by side panel |
| `img-pill` screenshot indicator | Replaced by subtle paperclip icon on row |
| IBM Plex fonts | Replaced by Inter + JetBrains Mono |
| Dark theme variables | Full light-only theme |

---

## What Stays the Same

- All JS logic (storage, filtering, sorting, form handling) — untouched
- `window.storage` API for persistence
- `BUGS_KEY`, data shape, bug ID format (`ERP-XXX`)
- All form fields and module list
- Lightbox for full-screen image view

---

## File Structure

No changes to file structure. The entire revamp is applied to `bug_tracker.html` in-place.

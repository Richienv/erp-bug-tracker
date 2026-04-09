# Reporter Page Redesign — Design Document

**Date:** 2026-04-09
**Status:** Approved
**Author:** Richie + Claude

## Problem

The reporter page currently shows the bug report form inline on the dashboard, taking up most of the screen. Reporters only see their own bugs, so they can't tell if someone else already reported the same issue — leading to duplicate reports. There's no way to see all bugs at a glance or switch between view modes.

## Goals

1. Show all bugs from all reporters by default (prevent duplicates)
2. Move the report form into a modal popup (triggered by "+ Report Bug" button)
3. Add list view (default) and kanban board view toggle
4. Add filters: reporter, module, search text

## Layout

The main area becomes a bug browser with a toolbar, replacing the always-visible form:

```
┌─── Sidebar (unchanged) ───┐  ┌─── Main Area ──────────────────────────────┐
│ ERP Feedback               │  │                                            │
│                            │  │  Hey Darren                                │
│ OVERVIEW                   │  │  Report a bug or check status              │
│  Dashboard (active)        │  │                                            │
│                            │  │  ┌─ Toolbar ─────────────────────────────┐ │
│ REPORTS                    │  │  │ [+ Report Bug]  [List|Kanban]         │ │
│  Open          3           │  │  │                                       │ │
│  Needs verify  1           │  │  │ Filter: [All reporters ▼] [Module ▼]  │ │
│  Verified      2           │  │  │ Search: [Search bugs...]              │ │
│  All bugs      7           │  │  └───────────────────────────────────────┘ │
│                            │  │                                            │
│ MODULE PROGRESS            │  │  ┌─ Bug List / Kanban ───────────────────┐ │
│  Keuangan        0%        │  │  │ (all bugs from all reporters)         │ │
│  Inventori     100%        │  │  └───────────────────────────────────────┘ │
│                            │  │                                            │
│ TOOLS                      │  └────────────────────────────────────────────┘
│  Fixer view →              │
│                            │
│ Darren / Reporter          │
└────────────────────────────┘
```

## Report Bug Modal

Clicking "+ Report Bug" opens a centered modal overlay with the exact same form as today:

- Same fields: title, steps to reproduce (chips builder), module, category, screenshot
- Same validation: all fields mandatory
- Backdrop blur + click-outside or Escape to dismiss
- After submit: modal closes, new bug appears in list/kanban instantly
- No changes to form logic — just wrapped in a modal

## List View (Default)

Compact table rows showing all bugs from all reporters, newest first:

| Bug ID | Title | Module | Reporter | Status | Time |
|---|---|---|---|---|---|
| ERP-042 | Invoice save button broke | Keuangan | Darren | Open | 2h ago |
| ERP-041 | Stock count mismatch | Inventori | Raymond | Fixed | 1d ago |

- Clicking a row expands it (same expand behavior as today — screenshot, fix notes, verify panel for Fixed bugs)
- Status shown as colored pill with dot
- Reporter name visible on every row

## Kanban View

Columns by status: Open | In Progress | Fixed | Verified | Closed

Each card shows: bug_id, title (truncated), module tag, reporter name, time ago.

- Columns scroll vertically if many bugs
- Clicking a card expands detail (same as list row click)
- Cards are read-only — reporters don't drag to change status

## Filters

- **Reporter dropdown**: "All reporters" (default) / Richie / Darren / Raymond
- **Module dropdown**: "All modules" (default) / Keuangan / Inventori / Penjualan / etc.
- **Search input**: filters by title text, live as you type
- Filters apply to both list and kanban views
- Sidebar nav items (Open, Needs verify, Verified, All bugs) still work as status filters and combine with toolbar filters

## Data Loading

Currently the page loads only the logged-in reporter's bugs (`myBugs`) plus all bugs for module progress (`allBugs`). The redesign uses `allBugs` as the primary data source for the list/kanban. The sidebar badges (Open, Needs verify, etc.) still count only the logged-in reporter's bugs.

## What Stays the Same

- Sidebar structure and navigation
- Login flow
- Bug expand/collapse behavior and verify panel
- Module progress section
- Realtime updates via Supabase
- All form validation and submission logic
- Lightbox for screenshots
- Toast notifications

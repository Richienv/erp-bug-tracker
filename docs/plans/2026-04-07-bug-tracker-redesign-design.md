# ERP Bug Tracker Redesign — Apple-Airy Light Theme

**Date:** 2026-04-07
**Status:** Approved

## Overview

Redesign the ERP Bug Tracker from a dark developer-tool aesthetic to an Apple-inspired light/airy design. Split into two role-based views with real-time sync via Supabase.

## Architecture

- **Single-page app** deployed to its own URL (Vercel)
- **Supabase Postgres** for shared state + **Supabase Realtime** for WebSocket-based live updates
- **Supabase Storage** for screenshot uploads
- **Two views:** `/report` (reporters) and `/fix` (fixer)
- **Identity:** localStorage name picker (Richie/Darren/Raymond), not access control

## Design System

- **Theme:** Light, white backgrounds, #f5f5f7 section backgrounds
- **Font:** Inter / -apple-system fallback
- **Accent:** Apple blue #007AFF
- **Cards:** White bg, 1px border (#E5E5EA) + subtle shadow, 14px border-radius
- **Spacing:** Generous whitespace, centered content columns
- **Animations:** Smooth 200-300ms transitions, no flashy effects

## Reporter View (`/report`)

### Identity
First visit: centered name picker with three tappable cards (Richie/Darren/Raymond). Saved to localStorage. Greeting at top: "Hey Darren" (tappable to switch).

### Capture Form (always visible)
Centered column, max-width 640px, 24px horizontal padding on mobile.

Fields:
1. **Title** -- Large input, 18px, placeholder "What went wrong?"
2. **Module** -- Tappable pill opens grouped bottom sheet (mobile) / popover (desktop)
   - Finance: Invoice, COA, Journal, AR Aging, AP Aging, Bank Recon, Petty Cash, Debit Note, Credit Note, Credit Limit
   - Operations: Inventory, Purchase, Sales
   - Other: HR, Settings, Dashboard, Auth
3. **Screenshot** -- Drop zone (160px desktop, 120px mobile). Accepts drag-drop, Cmd+V paste, tap for file picker. One screenshot per report, clearly communicated. Shows thumbnail + X to remove after capture.
4. **Submit** -- Full-width, Apple blue (#007AFF), "Report Bug". Disabled until title filled.

No severity field (Richie triages). No description field (screenshot carries context).

### "Your Bugs" Feed
- Reverse-chronological cards showing reporter's own bugs
- Card: title (bold 15px), module tag, status badge (colored dot + text), relative timestamp, screenshot thumbnail (40px)
- Tap to expand: full screenshot + Richie's fix notes (read-only)
- Real-time status changes: smooth badge color transition (200ms)

### Edge States
- **Empty feed:** Bug+checkmark icon, "No bugs reported yet" + encouraging subtext
- **After submit:** Optimistic insert, fade-in card, form clears
- **Network failure:** Orange "Not synced" indicator on card, retry button, non-blocking toast, 3x auto-retry with exponential backoff

## Fixer View (`/fix`)

### Layout
Full-viewport, no page scroll. Three zones:
- **Left rail** (240px, collapsible to 48px icon strip): Stats + filters
- **Board** (flex:1): Kanban columns
- **Detail panel** (400px, slides from right): Expanded bug view on card click

### Left Rail
Stats as tappable metric rows (Open/In Progress/Fixed/Verified counts). Filters below: search input, module dropdown, reporter pills, severity pills. Additive AND logic. Active filters as removable chips.

### Kanban Board
Four columns: Open | In Progress | Fixed | Verified (no Closed column -- accessible via filter).

Card (compact, ~120px):
- Bug ID (monospace) + relative time
- Title (14px semi-bold, 2-line clamp)
- Module tag pill + severity dot (color-coded circle, tappable to cycle inline)
- Screenshot thumbnail (32x28px) bottom-right if exists
- Reporter name (12px muted) bottom-left

### Drag-and-Drop
- **Desktop:** HTML drag-and-drop. Column highlights on hover.
- **Mobile:** Long-press (300ms) opens move sheet with four status pills. One tap to move. Card lifts on long-press (scale 1.02 + shadow).

### Detail Panel (400px, right side)
- Header: Bug ID + status badge + X close
- Title: inline-editable, auto-save on blur
- Metadata: reporter, module, created date, severity (tappable dot)
- Screenshot: full-width, max-height 300px, click for lightbox. Hidden if none.
- Status stepper: horizontal bar (Open -> In Progress -> Fixed -> Verified -> Closed). Click any step. Backward movement shows "Reopen?" confirmation.
- Fix Notes: textarea, auto-saves 1s after last keystroke (debounced). "Saved" indicator.
- Verified By: dropdown, auto-save on change
- Notes/Links: single-line input, auto-save on blur
- Delete: ghost red button with inline confirmation

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| N | Focus search |
| [ | Toggle rail |
| Escape | Close detail panel |
| 1-4 | Filter to column |
| 0 | Clear filters |
| Up/Down | Navigate cards |
| Enter | Open detail panel |
| Right | Move card to next status |
| ? | Show shortcut overlay |

### Real-Time
Same Supabase channel. New bugs animate into Open column. Card/panel update live. Fix notes conflict resolution: last writer wins with debounce window.

### Edge States
- **Empty board:** "No open bugs. Nice work." with checkmark icon
- **Empty column:** Dashed-border drop zone
- **Network loss:** Top banner "Offline -- changes will sync when reconnected." Optimistic local updates, flush on reconnect.

## Supabase Schema

```sql
-- bugs table
id          uuid primary key default gen_random_uuid()
bug_id      text unique not null        -- ERP-001 format
title       text not null
module      text
status      text default 'Open'         -- Open, In Progress, Fixed, Verified, Closed
severity    text default 'Medium'       -- Critical, High, Medium, Low
reporter    text not null
screenshot_url text
fix_notes   text
verified_by text
notes       text
created_at  timestamptz default now()
resolved_at timestamptz
updated_at  timestamptz default now()
```

## Tech Stack
- Single HTML file or minimal Vite app (TBD in implementation plan)
- Supabase JS client (CDN)
- Vanilla JS or lightweight framework
- Deploy to Vercel

## Notes
- Identity is localStorage, not access control. Anyone can switch names. Fine for 3-person internal team.
- One screenshot per report, clearly communicated in drop zone.
- No description field on reporter side -- screenshot is context.
- Severity is fixer-only triage.

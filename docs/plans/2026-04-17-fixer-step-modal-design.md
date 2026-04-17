# Fixer Step Modal — Design

**Date:** 2026-04-17
**Status:** Approved, implementing
**Affected files:** `fixer/index.html`

## Problem

Fixer's right-hand sidebar detail pane exposes every control at once: status pills, screenshot, fix notes, Verified By dropdown, Notes/Links, Delete. Updating progress takes too many clicks and the page feels cluttered.

## Solution

Replace the sidebar detail pane with a centered **step modal** that shows only what the fixer should do *next* for the clicked bug. The modal chains through the workflow — clicking the action re-renders the same modal with the next step's body, so going Open → In Progress → Fixed happens in one surface.

## Picks (A/A/A/A)

1. **One modal per click, next step only.** No destination picker. The current status dictates the body.
2. **Read-only for blocked states.** Fixed/Verified/Closed show a "waiting" card, no action buttons. Fixer is blocked there anyway.
3. **Three-dot menu for escape hatches.** Edit notes · Revert status · Delete bug live behind `⋯` in the modal header. Hidden by default.
4. **Full context at top, action at bottom.** Title, meta, reporter screenshot, reporter notes always visible. Action card below.

## Per-status body

| Status | Body | Primary action |
|---|---|---|
| Open | "Not started yet." | **Start working** → `status=In Progress`, re-render |
| In Progress | Fix screenshot dropzone + fix notes textarea | **Submit fix** → upload + `status=Fixed` + `fix_notes` + `fix_screenshot_url`, re-render |
| Fixed | "Waiting for *[reporter]* to verify · Sent [ago]" + fix screenshot thumb + fix notes | *(read-only)* |
| Verified | "Verified by *[reporter]* · [ago]" | *(read-only)* |
| Closed | "Closed [ago]" | *(read-only)* |

## Modal shell

~560px fixed width, centered, scrim backdrop. Escape/✕ closes. Reuses the existing `.fix-modal` CSS family.

## Escape hatches (⋯ menu)

- **Edit notes** — inline prompt to update `fix_notes`
- **Revert to previous status** — decrement status one step (Fixed→In Progress, In Progress→Open); no-op on Open
- **Delete bug** — confirm + remove row

## Sidebar removal

The right-hand detail pane DOM stays but `display:none`. The main area becomes full-width kanban. Card click opens step modal.

## Out of scope

- No realtime optimistic UI for step transitions — `renderDetail` equivalent just re-queries and re-renders the modal.
- No keyboard shortcuts (Enter to advance) this round.
- Notes/Links field and Verified By dropdown absorb into the ⋯ menu or are deferred.
- No changes to reporter view, daemon, or monitor.

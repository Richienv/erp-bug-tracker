# Verify Inbox + Fixer Attach UX — Design

**Date:** 2026-04-17
**Status:** Approved, ready for implementation plan
**Affected files:** `reporter/index.html`, `fixer/index.html`

## Problem

Two pain points surfaced after the recent declutter:

1. **Verify is buried.** Reporters must tap a bug row to expand a panel before they can verify a fix. "Fixed but unverified" bugs pile up because the action isn't in front of them.
2. **Attaching the fix screenshot is not obvious.** The fixer modal has drop/paste/click all working, but the 120px drop zone is easy to miss and users don't realise paste is supported.

## Solution

Two coordinated changes, scoped to the frontend only.

### Reporter — "Verify inbox" strip

A compact strip at the top of the dashboard that lists every bug the current user reported and that is currently `Fixed` — i.e., waiting on their verification.

- One card per bug: before/after thumbnail pair, title, fixer note, ✓ Verify and ↩ Reopen actions.
- Visible on all views except the sidebar's `needs-verify` view (to avoid duplication) and hidden when the queue is empty.
- Verify/Reopen are optimistic with a 6-second undo toast. Reopen asks for an optional "what's still wrong" note and clears `fix_notes`.
- Thumbnails open the existing lightbox. Clicking the card body expands it to show full-size before/after + full notes.
- Narrow viewport (<640px): thumbnails stack above the text block.
- Session-scoped "× dismiss all" hides the strip until next load; does not verify anything.

### Fixer — easier attach

Three small additions inside the fix modal:

- **Whole-modal drop target.** The full modal body becomes a drop zone with a translucent green overlay on `dragover`. The visible 120px zone stays as the click affordance.
- **Clipboard-paste banner.** On modal open, if `navigator.clipboard.read()` reports an image MIME, show a one-line banner with a Paste button that attaches the clipboard image.
- **Triple-hint row.** Replace the single-line hint with three pills: `⇧ Drop   ⌘V Paste   ⬆ Browse`.

All three are additive — the existing drop/paste/click handlers remain.

## Architecture

Single-file static HTML apps, inline CSS + JS. No new modules, no new dependencies, no backend changes.

### Data flow — reporter verify

`allBugs` (the existing in-memory array, populated by `loadBugs()`) remains the single source of truth. A new `renderVerifyInbox()` runs on every `renderBugs()` tick, filters `allBugs` by `status === 'Fixed' && reporter === currentName`, and writes cards to a new `#verify-inbox` element. No new state store.

Verify/reopen use optimistic UI:

1. Card gets `.verifying` class → slide+fade out (200ms)
2. `pendingVerifies` map stores previous status for undo
3. 6-second undo toast
4. Supabase update runs in the background
5. On error: revert optimistic hide + toast "Couldn't verify — try again"
6. On undo: reverse the Supabase update

### Data flow — fixer attach

On fix modal open:

```js
if (navigator.clipboard?.read && window.isSecureContext) {
  try {
    const items = await navigator.clipboard.read();
    const hasImage = items.some(i => i.types.some(t => t.startsWith('image/')));
    if (hasImage) showBanner();
  } catch { /* permission denied — silent */ }
}
```

Modal-wide drop listeners wrap the existing upload-zone handlers; both call the existing `handleFixFile(blob)`.

## Error handling

| Case | Handling |
|---|---|
| Supabase update fails | Revert optimistic hide, clear `pendingVerifies`, toast "Couldn't verify — try again" |
| Undo + close tab within 6s | `beforeunload` flushes pending undos; applied Verified state stays |
| Two tabs both verify | Second update is a no-op (status already Verified), no user-facing error |
| Clipboard permission denied | Banner silently skipped; Cmd+V listener still works |
| Clipboard contains non-image | `hasImage === false`, no banner |
| Drop non-image on fix modal | Existing `handleFixFile` guard + toast "Please drop an image" |
| Queue card status changes via another client | Next render removes it; mid-reopen prompt text lost (accepted, rare) |
| Empty queue | Strip `display: none` — no "All caught up" message |

## Out of scope

- No realtime Supabase subscription for this round — verify/reopen refreshes locally, next natural `loadBugs()` syncs.
- No browser push / notifications.
- No schema changes.
- No changes to daemon, monitor page, report modal, sidebar, kanban, or fixer list.
- No changes to the rest of the fix modal (message box, submit flow).

## Verification plan

Manual, across two browsers.

**Reporter**

1. Seed a bug, have fixer submit a fix → strip appears with before/after thumbs + note.
2. ✓ Verify → card fades out, toast appears, Supabase row is `Verified`.
3. Undo within 6s → card returns, status reverts to `Fixed`.
4. ↩ Reopen → prompt appears → confirm → status `Open`, `fix_notes` cleared.
5. Thumbnail click → lightbox opens.
6. Sidebar's "Needs verify" view → strip hidden.
7. Clear queue → strip fades out.
8. Narrow viewport (<640px) → thumbs stack above text.
9. Offline → verify fails gracefully with toast.

**Fixer**

10. Open fix modal with clipboard image → banner appears; Paste → attaches.
11. Open fix modal without clipboard image → no banner.
12. Drag file anywhere on modal body → green overlay → drop → attached.
13. Drag over → leave → overlay dismissed without flicker.
14. Cmd+V still attaches images regardless of banner.

**JS parse sanity:** `new Function(scriptContent)` on both files.

## Browser support notes

Clipboard image read (`navigator.clipboard.read()`) needs: secure context, user gesture, permission grant. Safari iOS usually returns a denied permission → banner simply doesn't appear. All other input paths (drop, paste, click) remain functional.

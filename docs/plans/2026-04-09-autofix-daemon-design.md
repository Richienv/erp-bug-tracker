# Auto-Fix Daemon — Design Document

**Date:** 2026-04-09
**Status:** Approved
**Author:** Richie + Claude

## Problem

When a bug is reported in the ERP Bug Tracker, Richie (the fixer) must manually:
1. Receive ntfy notification
2. Open the fixer view in a browser
3. Copy bug details
4. Open terminal, cd into ERP repo
5. Paste into Claude Code
6. Wait for fix, review, commit, push
7. Go back to fixer view, mark as Fixed

That's ~8 manual steps between "notification" and "fix reviewed." The goal is to reduce it to:

```
Reporter submits bug → daemon auto-fixes → Richie gets PR link → reviews → merges
```

## Solution: Local Daemon (Option A)

A Node.js script (`daemon.mjs`) runs on Richie's Mac. It subscribes to Supabase Realtime and watches for new bug inserts. When one arrives, it spawns Claude Code CLI against the ERP repo, creates a branch, fixes the bug, pushes, opens a PR, and notifies Richie with the PR link.

### Why this approach

- Claude Code gets full local filesystem access — can read every file, run tests, inspect Prisma schema
- The ERP repo's `CLAUDE.md` and `AGENTS.md` are respected natively
- No cloud infrastructure needed (no GitHub Actions, no Vercel functions)
- The repo already has `origin/claude/*` branches — this workflow is proven
- ~120 lines of code, single file
- Richie's Mac is on during work hours when bugs are reported

### Alternatives considered

- **GitHub Actions + Claude Code CLI** — always-on, but auth is complex, runner has no local env (.env, database), 4 moving parts. Better for team scale, not needed yet.
- **Manual one-command trigger (`npm run fix ERP-042`)** — lighter, but not zero-touch. Built as a fallback since the daemon uses the same code path.

## Architecture

```
Bug submitted ──> Supabase Realtime (websocket)
                         |
                  daemon.mjs on Mac
                         |
        +----------------+----------------+
        v                v                v
  git branch      Claude Code CLI    Update Supabase
  fix/ERP-042     --dir /ERP-System  status -> "In Progress"
                         |
                   Reads CLAUDE.md
                   Finds module code
                   Makes the fix
                         |
                  +------+------+
                  v             v
             git push      gh pr create
                               |
                  +------------+---------------+
                  v                            v
           Update Supabase              ntfy -> Richie
           pr_url + notes               "PR ready: ERP-042"
                                               |
                                        Richie reviews PR
                                        Merges if good
```

## File Structure

```
Bug-Tracker/
  daemon.mjs          <- main file (~120 lines)
  package.json         <- add @supabase/supabase-js, new scripts
  reporter/            <- (unchanged)
  fixer/               <- (minor: add "Review PR" button when pr_url exists)
  shared/              <- (unchanged)
```

### Entry Points

- `npm run daemon` — background watcher, auto-processes every new bug
- `npm run fix -- ERP-042` — manual trigger for one specific bug (same code path, no Realtime)

## Prompt Template

The daemon builds this prompt from the Supabase bug record and passes it to Claude Code via `claude -p`:

```
Fix bug {bug_id} in the ERP system.

## Bug Report
- **Bug ID:** {bug_id}
- **Title:** {title}
- **Module:** {module}
- **Sub-module:** {submodule}
- **Category:** {category}
- **Reporter:** {reporter}
- **Reported at:** {created_at}

## Steps to Reproduce
{steps}
(This is exactly what the reporter did and what went wrong.
 Follow these steps to understand the bug before fixing.)

## Screenshot
{screenshot_url}
(Open this image — it shows exactly what the reporter saw.)

## Where to Look
The module "{module}" maps to: app/{module_dir}/
Related server actions: actions/workflow-actions.ts
Related components: components/
Database schema: prisma/schema.prisma

Category "{category}" suggests:
{category_hint}

## How to Fix
1. Reproduce the issue by tracing the code path described in steps above
2. Identify the root cause — read the relevant page, component, or action
3. Make the minimal fix that resolves exactly this bug
4. Verify your fix addresses the steps to reproduce
5. Commit with message: fix({module_slug}): {description} [{bug_id}]

## Rules
- Fix ONLY this bug — do not refactor, improve, or touch unrelated code
- Do not add new features or change UI styling
- Do not modify files outside the affected module unless absolutely necessary
- If the fix requires a Prisma schema change, generate the migration too
```

### Category Hints

| Category | Hint |
|---|---|
| Button/action not working | Check onClick handlers, form actions, and server action calls. Likely a broken event handler or missing/incorrect action binding. |
| Missing data | Check data fetching in the page's server component or useQuery calls. Verify the Prisma query includes the right relations and filters. |
| Missing feature | Check if the feature exists in a related module that can be referenced. Build minimal implementation following existing patterns. |
| Form not submitting | Check the form's action, validation schema (zod), and the server action it calls. Look for missing fields or validation mismatches. |
| Validation error | Check the zod schema and form validation logic. Compare expected vs actual field types. |
| UI/display issue | Check the component's JSX and Tailwind classes. Compare against NB design system in CLAUDE.md. |
| Performance | Check for missing Prisma indexes, N+1 queries, or large unbounded selects. |
| Crash/error | Check the server component or action for unhandled errors. Look at the error boundary. Check for null/undefined access on data that might not exist. |
| Other | Investigate broadly — read the page component, related actions, and schema. |

### Module Directory Mapping

| Bug Tracker Module | ERP Directory |
|---|---|
| Keuangan | `app/finance/` |
| Inventori | `app/inventory/` |
| Penjualan & CRM | `app/sales/` |
| Pengadaan | `app/procurement/` |
| Manufaktur | `app/manufacturing/` |
| SDM | `app/hcm/` |
| Dokumen | `app/documents/` |

## Queue & Processing

### Sequential processing

One bug at a time. Claude Code operates on the working tree — two concurrent fixes would conflict. Bugs queue in an array and process back-to-back (~2-5 min each).

### Catch-up on restart

When the daemon starts, it queries Supabase for any bugs with status "Open" that don't have a `pr_url`. These are bugs reported while the daemon was down — they enter the queue automatically.

### Stuck bug recovery

On startup, the daemon also checks for bugs that are "In Progress" but have no `pr_url` — these are stuck from a crashed run. It:
1. Sends an ntfy alert listing the stuck bugs
2. Resets their status to "Open" so they re-enter the queue
3. Cleans up any orphaned branches (`fix/ERP-*` with no corresponding PR)

### Error handling

If Claude Code fails (non-zero exit, timeout after 10 minutes, crash):
- Bug status stays "In Progress" is **not** retried automatically (prevents infinite retry loops)
- ntfy sends: "Auto-fix failed for {bug_id} — manual fix needed"
- Orphaned branch is cleaned up (`git checkout main && git branch -D fix/...`)
- Daemon moves to next bug in queue

Wait — correction per stuck bug recovery: on next daemon restart, stuck bugs (In Progress, no pr_url) get reset to Open and re-queued. So a single failure doesn't permanently block a bug.

## Supabase Changes

One new column on the `bugs` table:

```sql
ALTER TABLE bugs ADD COLUMN IF NOT EXISTS pr_url text;
```

No other schema changes needed.

## Notifications (ntfy)

Three notification types, all sent to topic `erp-bugs-richiekidnovell`:

| Event | Title | Body | Priority | Click Action |
|---|---|---|---|---|
| Bug submitted | Bug from {reporter} | {module} — "{title}" | high | — |
| PR ready | PR ready: {bug_id} | {title} — tap to review | urgent | `view, Review PR, {pr_url}` |
| Auto-fix failed | Fix failed: {bug_id} | Manual fix needed | high | — |
| Stuck bugs on startup | {n} stuck bugs reset | {bug_ids} re-queued | default | — |

The "PR ready" notification uses ntfy's `Actions` header for native tap-to-open on mobile.

## Fixer View Changes

When a bug has a `pr_url`, the fixer view shows a clickable "Review PR" button that opens the GitHub PR directly. This replaces the current workflow of manually finding the right branch.

## CLI Invocation

```bash
claude -p "{prompt}" \
  --dir "/Volumes/Extreme SSD/ERP-System/erp-system" \
  --dangerously-skip-permissions
```

- `-p` — non-interactive prompt mode (headless)
- `--dir` — points to the ERP repo
- `--dangerously-skip-permissions` — required for headless file editing; safe because every change goes through PR review

## What Stays the Same

- Reporter flow: unchanged — they submit bugs the same way
- Verification flow: unchanged — reporter still verifies after fixer marks Fixed
- Manual fixing: still works — daemon skips bugs already "In Progress" or "Fixed"
- The fixer can still use the copy-to-Claude-Code workflow for complex bugs

## Dependencies

- `@supabase/supabase-js` (already in bug-tracker)
- Claude Code CLI (`claude` — already installed at `/Users/richiekidnovell/.local/bin/claude`)
- GitHub CLI (`gh` — for PR creation)
- Node.js (already installed)
- ntfy.sh (already configured)

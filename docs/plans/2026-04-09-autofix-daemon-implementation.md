# Auto-Fix Daemon Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local Node.js daemon that watches for new bug reports in Supabase, spawns Claude Code to auto-fix them in the ERP repo, creates GitHub PRs, and notifies Richie via ntfy.

**Architecture:** Single-file daemon (`daemon.mjs`) subscribes to Supabase Realtime. On new bug INSERT, it queues the bug, then sequentially: creates a git branch, spawns `claude -p` with a structured prompt, pushes the branch, opens a PR via `gh`, updates Supabase with the PR URL, and sends an ntfy notification. Manual mode (`npm run fix -- ERP-042`) uses the same pipeline for a single bug.

**Tech Stack:** Node.js (ESM), `@supabase/supabase-js`, Claude Code CLI (`claude -p`), GitHub CLI (`gh`), ntfy.sh HTTP API, child_process.execFile.

**Design doc:** `docs/plans/2026-04-09-autofix-daemon-design.md`

---

### Task 1: Install Prerequisites

**Files:**
- Modify: `package.json`

**Step 1: Install GitHub CLI**

Run:
```bash
brew install gh
```

Then authenticate:
```bash
gh auth login
```

Choose: GitHub.com → HTTPS → Login with browser.
Expected: `gh auth status` shows "Logged in to github.com as Richienv"

**Step 2: Install @supabase/supabase-js**

Run:
```bash
cd "/Volumes/Extreme SSD/Bug-Tracker"
npm install @supabase/supabase-js
```

Expected: `@supabase/supabase-js` appears in `package.json` dependencies.

**Step 3: Add scripts to package.json**

Change `package.json` `"type"` from `"commonjs"` to keep it, but add the two new scripts. The `.mjs` extension handles ESM regardless of package type (proven by existing `setup-db.mjs`).

```json
{
  "scripts": {
    "dev": "npx serve . -l 3000",
    "build": "echo 'Static site — no build step'",
    "test": "echo \"Error: no test specified\" && exit 1",
    "daemon": "node daemon.mjs",
    "fix": "node daemon.mjs"
  }
}
```

Both scripts point to the same file — `daemon.mjs` checks `process.argv` to determine mode.

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add daemon dependencies and scripts"
```

---

### Task 2: Add `pr_url` column to Supabase

**Files:**
- Modify: `setup-db.mjs` (add the ALTER TABLE statement for reference)

**Step 1: Run the migration directly**

The project uses Supabase directly (no migration framework). Run via the existing postgres connection in `setup-db.mjs`'s style, or use the Supabase dashboard.

Simplest approach — add a one-off script call at the bottom of `setup-db.mjs`:

Add this statement to the `statements` array in `setup-db.mjs`:

```js
// pr_url column for auto-fix daemon
`ALTER TABLE bugs ADD COLUMN IF NOT EXISTS pr_url text`,
```

Then run:
```bash
cd "/Volumes/Extreme SSD/Bug-Tracker"
node setup-db.mjs
```

Expected: `OK: ALTER TABLE bugs ADD COLUMN IF NOT EXISTS pr_url text` in output.

**Step 2: Commit**

```bash
git add setup-db.mjs
git commit -m "chore: add pr_url column to bugs table"
```

---

### Task 3: Build the daemon core — prompt builder & mappings

**Files:**
- Create: `daemon.mjs`

This task builds the data layer only — the module mapping, category hints, and prompt template function. No I/O yet.

**Step 1: Create `daemon.mjs` with constants and `buildPrompt(bug)`**

```js
#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/* ── Config ── */
const SUPABASE_URL  = 'https://vzonandspicspfjjatjm.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6b25hbmRzcGljc3BmamphdGptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1NDY4OTMsImV4cCI6MjA5MTEyMjg5M30.A_CtpuJQ4pJTOlYIP6hMDp3eHiQqjNP8M24NNhLLXqQ';
const ERP_DIR       = '/Volumes/Extreme SSD/ERP-System/erp-system';
const NTFY_TOPIC    = 'erp-bugs-richiekidnovell';
const CLAUDE_BIN    = '/Users/richiekidnovell/.local/bin/claude';
const FIX_TIMEOUT   = 10 * 60 * 1000; // 10 minutes

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── Module Mapping ── */
const MODULE_MAP = {
  'Keuangan':        { dir: 'app/finance/',        slug: 'finance' },
  'Inventori':       { dir: 'app/inventory/',       slug: 'inventory' },
  'Penjualan & CRM': { dir: 'app/sales/',           slug: 'sales' },
  'Penjualan':       { dir: 'app/sales/',           slug: 'sales' },
  'Pengadaan':       { dir: 'app/procurement/',      slug: 'procurement' },
  'Manufaktur':      { dir: 'app/manufacturing/',    slug: 'manufacturing' },
  'SDM':             { dir: 'app/hcm/',              slug: 'hcm' },
  'Dokumen':         { dir: 'app/documents/',         slug: 'documents' },
};

/* ── Category Hints ── */
const CATEGORY_HINTS = {
  'Button/action':   'Check onClick handlers, form actions, and server action calls. Likely a broken event handler or missing/incorrect action binding.',
  'Missing data':    'Check data fetching in the page\'s server component or useQuery calls. Verify the Prisma query includes the right relations and filters.',
  'Missing feature': 'Check if the feature exists in a related module that can be referenced. Build minimal implementation following existing patterns.',
  'Form':            'Check the form\'s action, validation schema (zod), and the server action it calls. Look for missing fields or validation mismatches.',
  'Validation':      'Check the zod schema and form validation logic. Compare expected vs actual field types.',
  'UI':              'Check the component\'s JSX and Tailwind classes. Compare against NB design system in CLAUDE.md.',
  'Performance':     'Check for missing Prisma indexes, N+1 queries, or large unbounded selects.',
  'Crash':           'Check the server component or action for unhandled errors. Look at the error boundary. Check for null/undefined access on data that might not exist.',
  'Other':           'Investigate broadly — read the page component, related actions, and schema.',
};

function getCategoryHint(category) {
  if (!category) return CATEGORY_HINTS['Other'];
  for (const [key, hint] of Object.entries(CATEGORY_HINTS)) {
    if (category.startsWith(key)) return hint;
  }
  return CATEGORY_HINTS['Other'];
}

function getModuleInfo(moduleStr) {
  if (!moduleStr) return { dir: 'app/', slug: 'general' };
  const top = moduleStr.split(' / ')[0].trim();
  return MODULE_MAP[top] || { dir: 'app/', slug: top.toLowerCase() };
}

function slugify(str, maxWords = 5) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
    .split(/\s+/).slice(0, maxWords).join('-');
}

/* ── Parse bug notes into structured fields ── */
function parseBugNotes(notes) {
  if (!notes) return { category: null, steps: null };
  const lines = notes.split('\n');
  let category = null, steps = null;
  for (const line of lines) {
    if (line.startsWith('Category: ')) category = line.slice('Category: '.length);
    if (line.startsWith('Steps: '))    steps = line.slice('Steps: '.length);
  }
  return { category, steps };
}

/* ── Prompt Builder ── */
function buildPrompt(bug) {
  const { category, steps } = parseBugNotes(bug.notes);
  const mod = getModuleInfo(bug.module);
  const submodule = bug.module?.includes(' / ')
    ? bug.module.split(' / ').slice(1).join(' / ')
    : null;
  const hint = getCategoryHint(category);

  return `Fix bug ${bug.bug_id} in the ERP system.

## Bug Report
- **Bug ID:** ${bug.bug_id}
- **Title:** ${bug.title}
- **Module:** ${bug.module || 'Unknown'}
- **Sub-module:** ${submodule || 'N/A'}
- **Category:** ${category || 'Not specified'}
- **Reporter:** ${bug.reporter}
- **Reported at:** ${bug.created_at}

## Steps to Reproduce
${steps || 'No steps provided — investigate based on title and module.'}
(This is exactly what the reporter did and what went wrong.
 Follow these steps to understand the bug before fixing.)

## Screenshot
${bug.screenshot_url || 'No screenshot provided.'}
${bug.screenshot_url ? '(Open this image — it shows exactly what the reporter saw.)' : ''}

## Where to Look
The module "${bug.module || 'Unknown'}" maps to: ${mod.dir}
Related server actions: actions/workflow-actions.ts
Related components: components/
Database schema: prisma/schema.prisma

Category "${category || 'Other'}" suggests:
${hint}

## How to Fix
1. Reproduce the issue by tracing the code path described in steps above
2. Identify the root cause — read the relevant page, component, or action
3. Make the minimal fix that resolves exactly this bug
4. Verify your fix addresses the steps to reproduce
5. Commit with message: fix(${mod.slug}): brief description [${bug.bug_id}]

## Rules
- Fix ONLY this bug — do not refactor, improve, or touch unrelated code
- Do not add new features or change UI styling
- Do not modify files outside the affected module unless absolutely necessary
- If the fix requires a Prisma schema change, generate the migration too`;
}
```

**Step 2: Verify the prompt builder works**

Add a temporary test at the bottom of `daemon.mjs`:

```js
// Temporary test — remove after verifying
const testBug = {
  bug_id: 'ERP-001', title: 'Invoice save button does nothing',
  module: 'Keuangan / Invoicing', reporter: 'Darren',
  notes: 'Category: Button/action\nSteps: Tried to click — save button. Nothing happened. Expected: invoice should be saved.',
  screenshot_url: 'https://example.com/screenshot.png',
  created_at: '2026-04-09T10:00:00Z',
};
console.log(buildPrompt(testBug));
```

Run:
```bash
node daemon.mjs
```

Expected: A well-formed prompt with module mapped to `app/finance/`, category hint about onClick handlers, and all fields filled.

**Step 3: Remove the test, commit**

Remove the temporary test block, then:
```bash
git add daemon.mjs
git commit -m "feat(daemon): prompt builder with module mapping and category hints"
```

---

### Task 4: Build the fix pipeline — git, Claude Code, PR

**Files:**
- Modify: `daemon.mjs`

This task adds the functions that do the actual work: create branch, run Claude Code, push, create PR, update Supabase, notify.

**Step 1: Add the ntfy helper**

Add after the `buildPrompt` function:

```js
/* ── ntfy Notification ── */
async function notify(title, body, priority = 'high', actions = null) {
  const headers = {
    'Title': title,
    'Priority': priority,
    'Tags': 'bug',
  };
  if (actions) headers['Actions'] = actions;

  try {
    await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: 'POST', headers, body,
    });
  } catch (_) { /* silent */ }
}
```

**Step 2: Add the git helpers**

```js
/* ── Git Helpers ── */
async function git(...args) {
  const { stdout } = await execFileAsync('git', args, { cwd: ERP_DIR });
  return stdout.trim();
}

async function cleanupBranch(branch) {
  try { await git('checkout', 'main'); } catch (_) {}
  try { await git('branch', '-D', branch); } catch (_) {}
}
```

**Step 3: Add the core `fixBug(bug)` function**

```js
/* ── Fix Pipeline ── */
async function fixBug(bug) {
  const branch = `fix/${bug.bug_id}-${slugify(bug.title)}`;
  const prompt = buildPrompt(bug);

  console.log(`\n[daemon] Processing ${bug.bug_id}: ${bug.title}`);
  console.log(`[daemon] Branch: ${branch}`);

  // 1. Mark as In Progress
  await sb.from('bugs').update({ status: 'In Progress' }).eq('id', bug.id);

  // 2. Create branch from main
  try {
    await git('checkout', 'main');
    await git('pull', 'origin', 'main');
    await git('checkout', '-b', branch);
  } catch (err) {
    console.error(`[daemon] Git branch failed:`, err.message);
    await notify(`Fix failed: ${bug.bug_id}`, 'Could not create branch — manual fix needed');
    await cleanupBranch(branch);
    return false;
  }

  // 3. Run Claude Code
  console.log(`[daemon] Spawning Claude Code...`);
  try {
    const { stdout, stderr } = await execFileAsync(
      CLAUDE_BIN,
      ['-p', prompt, '--dangerously-skip-permissions'],
      {
        cwd: ERP_DIR,
        timeout: FIX_TIMEOUT,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'daemon' },
      }
    );
    console.log(`[daemon] Claude Code finished. Output length: ${stdout.length}`);
    if (stderr) console.log(`[daemon] stderr: ${stderr.slice(0, 500)}`);
  } catch (err) {
    console.error(`[daemon] Claude Code failed:`, err.message);
    await notify(`Fix failed: ${bug.bug_id}`, `${bug.title}\nClaude Code error — manual fix needed`);
    await cleanupBranch(branch);
    return false;
  }

  // 4. Check if Claude made any changes
  const diff = await git('diff', '--stat');
  const staged = await git('diff', '--staged', '--stat');
  if (!diff && !staged) {
    console.log(`[daemon] No changes made by Claude Code.`);
    await notify(`Fix failed: ${bug.bug_id}`, `${bug.title}\nClaude made no changes — manual fix needed`);
    await cleanupBranch(branch);
    return false;
  }

  // 5. Push branch
  try {
    await git('push', '-u', 'origin', branch);
  } catch (err) {
    console.error(`[daemon] Push failed:`, err.message);
    await notify(`Fix failed: ${bug.bug_id}`, `${bug.title}\nPush failed — manual fix needed`);
    await cleanupBranch(branch);
    return false;
  }

  // 6. Create PR
  let prUrl = '';
  try {
    const prTitle = `fix(${getModuleInfo(bug.module).slug}): ${bug.title} [${bug.bug_id}]`;
    const prBody = `Auto-fix for **${bug.bug_id}** — reported by ${bug.reporter}.\n\n**Module:** ${bug.module || 'Unknown'}\n**Category:** ${parseBugNotes(bug.notes).category || 'N/A'}\n**Steps:** ${parseBugNotes(bug.notes).steps || 'N/A'}\n\n---\n_Generated by auto-fix daemon_`;

    const { stdout } = await execFileAsync('gh', [
      'pr', 'create',
      '--title', prTitle,
      '--body', prBody,
      '--base', 'main',
      '--head', branch,
    ], { cwd: ERP_DIR });
    prUrl = stdout.trim();
    console.log(`[daemon] PR created: ${prUrl}`);
  } catch (err) {
    console.error(`[daemon] PR creation failed:`, err.message);
    prUrl = `https://github.com/Richienv/ERP/compare/${branch}`;
    console.log(`[daemon] Fallback compare URL: ${prUrl}`);
  }

  // 7. Update Supabase with PR link
  await sb.from('bugs').update({ pr_url: prUrl }).eq('id', bug.id);

  // 8. Notify Richie
  await notify(
    `PR ready: ${bug.bug_id}`,
    `${bug.title} — tap to review`,
    'urgent',
    `view, Review PR, ${prUrl}`
  );

  // 9. Return to main
  try { await git('checkout', 'main'); } catch (_) {}

  console.log(`[daemon] Done with ${bug.bug_id}`);
  return true;
}
```

**Step 4: Commit**

```bash
git add daemon.mjs
git commit -m "feat(daemon): fix pipeline — git, claude code, PR, ntfy"
```

---

### Task 5: Build the queue and Realtime watcher

**Files:**
- Modify: `daemon.mjs`

**Step 1: Add the queue processor**

```js
/* ── Queue ── */
const queue = [];
let processing = false;

function enqueue(bug) {
  if (queue.some(b => b.id === bug.id)) return;
  queue.push(bug);
  console.log(`[daemon] Queued ${bug.bug_id}: ${bug.title} (${queue.length} in queue)`);
  processNext();
}

async function processNext() {
  if (processing || queue.length === 0) return;
  processing = true;

  const bug = queue.shift();
  try {
    await fixBug(bug);
  } catch (err) {
    console.error(`[daemon] Unexpected error processing ${bug.bug_id}:`, err);
    await notify(`Fix failed: ${bug.bug_id}`, `Unexpected error — manual fix needed`);
  }

  processing = false;
  processNext(); // process next in queue
}
```

**Step 2: Add startup recovery and catch-up**

```js
/* ── Startup ── */
async function recoverStuckBugs() {
  const { data: stuck } = await sb.from('bugs')
    .select('*')
    .eq('status', 'In Progress')
    .is('pr_url', null);

  if (stuck && stuck.length > 0) {
    console.log(`[daemon] Found ${stuck.length} stuck bug(s) — resetting to Open`);
    const ids = stuck.map(b => b.bug_id).join(', ');
    for (const bug of stuck) {
      await sb.from('bugs').update({ status: 'Open' }).eq('id', bug.id);
    }
    await notify(
      `${stuck.length} stuck bug(s) reset`,
      `${ids} re-queued after daemon restart`,
      'default'
    );
  }
}

async function catchUpOpenBugs() {
  const { data: open } = await sb.from('bugs')
    .select('*')
    .eq('status', 'Open')
    .is('pr_url', null)
    .order('created_at', { ascending: true });

  if (open && open.length > 0) {
    console.log(`[daemon] Catching up on ${open.length} open bug(s)`);
    for (const bug of open) {
      enqueue(bug);
    }
  }
}
```

**Step 3: Add Realtime subscription and main entry point**

```js
/* ── Realtime ── */
function startWatching() {
  const channel = sb.channel('daemon-bugs')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'bugs',
    }, (payload) => {
      const bug = payload.new;
      console.log(`[daemon] New bug received: ${bug.bug_id}`);
      enqueue(bug);
    })
    .subscribe((status) => {
      console.log(`[daemon] Realtime status: ${status}`);
    });

  return channel;
}

/* ── Manual Mode ── */
async function fixSingleBug(bugId) {
  // Accept "ERP-042" or just "042"
  const normalized = bugId.startsWith('ERP-') ? bugId : `ERP-${bugId.padStart(3, '0')}`;

  const { data: bug, error } = await sb.from('bugs')
    .select('*')
    .eq('bug_id', normalized)
    .single();

  if (error || !bug) {
    console.error(`[fix] Bug ${normalized} not found.`);
    process.exit(1);
  }

  console.log(`[fix] Found: ${bug.bug_id} — ${bug.title}`);
  const ok = await fixBug(bug);
  process.exit(ok ? 0 : 1);
}

/* ── Entry Point ── */
async function main() {
  const args = process.argv.slice(2);

  // Manual mode: npm run fix -- ERP-042
  if (args.length > 0) {
    await fixSingleBug(args[0]);
    return;
  }

  // Daemon mode
  console.log('[daemon] Starting auto-fix daemon...');
  console.log(`[daemon] ERP dir: ${ERP_DIR}`);
  console.log(`[daemon] ntfy topic: ${NTFY_TOPIC}`);

  await recoverStuckBugs();
  await catchUpOpenBugs();
  startWatching();

  console.log('[daemon] Watching for new bugs...\n');
}

main().catch(err => {
  console.error('[daemon] Fatal error:', err);
  process.exit(1);
});
```

**Step 4: Commit**

```bash
git add daemon.mjs
git commit -m "feat(daemon): queue, realtime watcher, catch-up, manual mode"
```

---

### Task 6: Update fixer view — "Review PR" button

**Files:**
- Modify: `fixer/index.html`

**Step 1: Find the bug detail/card rendering in fixer view**

Read `fixer/index.html` and locate where bug details are rendered — look for the status pill or the detail panel. The PR button goes next to or below the status display.

**Step 2: Add the PR button**

When rendering a bug card, check if `bug.pr_url` exists. If so, render:

```html
<a href="${bug.pr_url}" target="_blank" rel="noopener"
   class="pr-link-btn"
   style="display:inline-flex; align-items:center; gap:5px; font-size:12px; padding:5px 12px; background:var(--blue-bg); color:var(--blue-text); border:0.5px solid var(--blue); border-radius:var(--radius-md); text-decoration:none; font-weight:500; cursor:pointer;">
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="5" cy="4" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="11" cy="4" r="2"/>
    <path d="M5 6v4M11 6c0 3-6 3-6 6"/>
  </svg>
  Review PR
</a>
```

This needs to be added in the bug row or detail panel rendering function. The exact insertion point depends on the fixer HTML structure — read it first, then insert.

**Step 3: Commit**

```bash
git add fixer/index.html
git commit -m "feat(fixer): show Review PR button when auto-fix creates a PR"
```

---

### Task 7: End-to-end test

**No files changed — manual verification.**

**Step 1: Start the daemon**

```bash
cd "/Volumes/Extreme SSD/Bug-Tracker"
npm run daemon
```

Expected: Console shows:
```
[daemon] Starting auto-fix daemon...
[daemon] ERP dir: /Volumes/Extreme SSD/ERP-System/erp-system
[daemon] ntfy topic: erp-bugs-richiekidnovell
[daemon] Watching for new bugs...
```

**Step 2: Submit a test bug**

Open the reporter view at `localhost:3000/reporter` (or the Vercel URL). Submit a bug:
- Title: "Test — Invoice save button shows no confirmation"
- Steps: Select "click" chip, type "save button on invoice form", select "nothing happened", expected: "should show success toast"
- Module: Keuangan → Invoicing
- Category: Button/action not working
- Screenshot: attach any image

**Step 3: Watch the daemon**

Expected console output:
```
[daemon] New bug received: ERP-XXX
[daemon] Queued ERP-XXX: Test — Invoice save button shows no confirmation (1 in queue)
[daemon] Processing ERP-XXX: Test — Invoice save button shows no confirmation
[daemon] Branch: fix/ERP-XXX-test-invoice-save-button-shows
[daemon] Spawning Claude Code...
[daemon] Claude Code finished. Output length: XXXX
[daemon] PR created: https://github.com/Richienv/ERP/pull/XX
[daemon] Done with ERP-XXX
```

**Step 4: Verify ntfy notification**

Expected: Phone receives "PR ready: ERP-XXX" with tap-to-open action opening the GitHub PR.

**Step 5: Verify Supabase update**

Check the bug in the fixer view — it should show "In Progress" status and a "Review PR" button linking to the GitHub PR.

**Step 6: Verify manual mode**

```bash
npm run fix -- ERP-XXX
```

Expected: Same pipeline runs for that specific bug, then exits.

**Step 7: Clean up test**

- Close the test PR on GitHub without merging
- Delete the test branch
- Delete the test bug from Supabase (or mark as Closed)

---

## Summary

| Task | What | Commit message |
|---|---|---|
| 1 | Install gh, @supabase/supabase-js, add scripts | `chore: add daemon dependencies and scripts` |
| 2 | Add pr_url column to Supabase | `chore: add pr_url column to bugs table` |
| 3 | Prompt builder, module map, category hints | `feat(daemon): prompt builder with module mapping and category hints` |
| 4 | Fix pipeline — git, Claude Code, PR, ntfy | `feat(daemon): fix pipeline — git, claude code, PR, ntfy` |
| 5 | Queue, Realtime watcher, catch-up, manual mode | `feat(daemon): queue, realtime watcher, catch-up, manual mode` |
| 6 | Fixer view "Review PR" button | `feat(fixer): show Review PR button when auto-fix creates a PR` |
| 7 | End-to-end manual test | (no commit — verification only) |

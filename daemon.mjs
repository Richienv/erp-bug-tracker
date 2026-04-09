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

/* ── Event Logger ── */
async function logEvent(bugId, event, message) {
  console.log(`[daemon] [${event}] ${bugId ? bugId + ': ' : ''}${message}`);
  try {
    await sb.from('daemon_logs').insert({ bug_id: bugId || null, event, message });
  } catch (_) { /* best-effort */ }
}

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

/* ── Git Helpers ── */
async function git(...args) {
  const { stdout } = await execFileAsync('git', args, { cwd: ERP_DIR });
  return stdout.trim();
}

async function cleanupBranch(branch) {
  try { await git('checkout', 'main'); } catch (_) {}
  try { await git('branch', '-D', branch); } catch (_) {}
}

/* ── Fix Pipeline ── */
async function fixBug(bug) {
  const branch = `fix/${bug.bug_id}-${slugify(bug.title)}`;
  const prompt = buildPrompt(bug);

  await logEvent(bug.bug_id, 'processing', `Starting fix: ${bug.title} → branch ${branch}`);

  // 1. Mark as In Progress
  await sb.from('bugs').update({ status: 'In Progress' }).eq('id', bug.id);

  // 2. Create branch from main
  try {
    await git('checkout', 'main');
    await git('pull', 'origin', 'main');
    await git('checkout', '-b', branch);
  } catch (err) {
    await logEvent(bug.bug_id, 'failed', `Git branch failed: ${err.message}`);
    await notify(`Fix failed: ${bug.bug_id}`, `${bug.title}\nBranch error: ${err.message.split('\n')[0]}`);
    await sb.from('bugs').update({ status: 'Open' }).eq('id', bug.id);
    await cleanupBranch(branch);
    return false;
  }

  // 3. Run Claude Code
  await logEvent(bug.bug_id, 'claude_start', 'Spawning Claude Code...');
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
    await logEvent(bug.bug_id, 'claude_done', `Claude Code finished (${stdout.length} chars output)`);
    if (stderr) console.log(`[daemon] stderr: ${stderr.slice(0, 500)}`);
  } catch (err) {
    await logEvent(bug.bug_id, 'failed', `Claude Code error: ${err.message.slice(0, 200)}`);
    await notify(`Fix failed: ${bug.bug_id}`, `${bug.title}\nClaude Code error: ${err.message.split('\n')[0]}`);
    await sb.from('bugs').update({ status: 'Open' }).eq('id', bug.id);
    await cleanupBranch(branch);
    return false;
  }

  // 4. Stage any unstaged changes Claude left behind
  try { await git('add', '-A'); } catch (_) {}
  const uncommitted = await git('diff', '--staged', '--stat');
  if (uncommitted) {
    try {
      await git('commit', '-m', `fix(${getModuleInfo(bug.module).slug}): ${bug.title} [${bug.bug_id}]`);
    } catch (_) {}
  }

  // 5. Check if branch has actual commits ahead of main
  const commits = await git('log', 'main..HEAD', '--oneline');
  if (!commits) {
    await logEvent(bug.bug_id, 'failed', 'Claude made no changes (no commits ahead of main)');
    await notify(`Fix failed: ${bug.bug_id}`, `${bug.title}\nClaude made no changes — manual fix needed`);
    await sb.from('bugs').update({ status: 'Open' }).eq('id', bug.id);
    await cleanupBranch(branch);
    return false;
  }
  await logEvent(bug.bug_id, 'changes_found', `${commits.split('\n').length} commit(s) on branch`);

  // 6. Verify the build passes before pushing
  await logEvent(bug.bug_id, 'verifying', 'Running build check...');
  try {
    await execFileAsync('npx', ['next', 'build'], {
      cwd: ERP_DIR,
      timeout: 5 * 60 * 1000, // 5 min build timeout
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    });
    await logEvent(bug.bug_id, 'verified', 'Build passed');
  } catch (err) {
    const buildErr = (err.stderr || err.message || '').slice(-300);
    await logEvent(bug.bug_id, 'failed', `Build failed: ${buildErr}`);
    await notify(`Fix failed: ${bug.bug_id}`, `${bug.title}\nBuild failed — fix broke something`);
    await sb.from('bugs').update({ status: 'Open' }).eq('id', bug.id);
    await cleanupBranch(branch);
    return false;
  }

  // 7. Push branch
  await logEvent(bug.bug_id, 'push', `Pushing branch ${branch}...`);
  try {
    await git('push', '-u', 'origin', branch);
  } catch (err) {
    await logEvent(bug.bug_id, 'failed', `Push failed: ${err.message.slice(0, 200)}`);
    await notify(`Fix failed: ${bug.bug_id}`, `${bug.title}\nPush failed: ${err.message.split('\n')[0]}`);
    await sb.from('bugs').update({ status: 'Open' }).eq('id', bug.id);
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
    await logEvent(bug.bug_id, 'pr_created', `PR created: ${prUrl}`);
  } catch (err) {
    prUrl = `https://github.com/Richienv/ERP/compare/${branch}`;
    await logEvent(bug.bug_id, 'pr_created', `PR via gh failed, fallback: ${prUrl}`);
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

  await logEvent(bug.bug_id, 'done', `Fix complete — PR: ${prUrl}`);
  return true;
}

/* ── Queue (approval-gated) ── */
const pendingBugs = new Map(); // bug_id → bug object
const approvedQueue = [];
let processing = false;

function enqueue(bug) {
  if (pendingBugs.has(bug.bug_id)) return;
  pendingBugs.set(bug.bug_id, bug);
  logEvent(bug.bug_id, 'awaiting_approval', `${bug.title} — waiting for approval`);
  notify(`New bug: ${bug.bug_id}`, `${bug.title}\nOpen /monitor to approve`, 'default');
}

function approveBug(bugId) {
  const bug = pendingBugs.get(bugId);
  if (!bug) {
    logEvent(bugId, 'failed', 'Approved but bug not found in pending list');
    return;
  }
  pendingBugs.delete(bugId);
  approvedQueue.push(bug);
  logEvent(bugId, 'approved', `${bug.title} — queued for fix (${approvedQueue.length} in queue)`);
  processNext();
}

async function processNext() {
  if (processing || approvedQueue.length === 0) return;
  processing = true;

  const bug = approvedQueue.shift();
  try {
    await fixBug(bug);
  } catch (err) {
    await logEvent(bug.bug_id, 'failed', `Unexpected error: ${err.message}`);
    await notify(`Fix failed: ${bug.bug_id}`, `Unexpected error: ${err.message.split('\n')[0]}`);
  }

  processing = false;
  processNext();
}

/* ── Startup ── */
async function recoverStuckBugs() {
  const { data: stuck } = await sb.from('bugs')
    .select('*')
    .eq('status', 'In Progress')
    .is('pr_url', null);

  if (stuck && stuck.length > 0) {
    await logEvent(null, 'recovery', `Found ${stuck.length} stuck bug(s) — resetting to Open`);
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
    await logEvent(null, 'catchup', `Catching up on ${open.length} open bug(s)`);
    for (const bug of open) {
      enqueue(bug);
    }
  }
}

/* ── Realtime ── */
function startWatching() {
  // Watch for new bugs
  sb.channel('daemon-bugs')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'bugs',
    }, (payload) => {
      const bug = payload.new;
      logEvent(bug.bug_id, 'received', `New bug: ${bug.title}`);
      enqueue(bug);
    })
    .subscribe((status) => {
      console.log(`[daemon] Realtime (bugs): ${status}`);
    });

  // Watch for approvals from the monitor page
  sb.channel('daemon-approvals')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'daemon_logs',
    }, (payload) => {
      const log = payload.new;
      if (log.event === 'approved' && log.bug_id) {
        approveBug(log.bug_id);
      }
    })
    .subscribe((status) => {
      console.log(`[daemon] Realtime (approvals): ${status}`);
    });
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
  await logEvent(null, 'startup', `Daemon started — ERP: ${ERP_DIR}`);

  await recoverStuckBugs();
  await catchUpOpenBugs();
  startWatching();

  await logEvent(null, 'watching', 'Watching for new bugs...');
}

main().catch(err => {
  console.error('[daemon] Fatal error:', err);
  process.exit(1);
});

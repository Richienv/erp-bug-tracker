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

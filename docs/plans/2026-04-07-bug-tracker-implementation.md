# ERP Bug Tracker Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the ERP Bug Tracker as two role-based views (reporter + fixer) with Apple-airy design and Supabase real-time sync.

**Architecture:** Two static HTML files (`report/index.html`, `fix/index.html`) sharing a common CSS file and Supabase JS client via CDN. No build step. Deploy as static site to Vercel. Supabase Postgres for data, Supabase Storage for screenshots, Supabase Realtime for live updates.

**Tech Stack:** Vanilla HTML/CSS/JS, Supabase JS v2 (CDN), Vercel static deployment.

**Design doc:** `docs/plans/2026-04-07-bug-tracker-redesign-design.md`

---

### Task 1: Supabase Schema & Config

**Context:** Set up the Supabase project, create the bugs table, storage bucket, and enable realtime. The user has a Supabase account already.

**Step 1: Create the bugs table**

Run this SQL in Supabase SQL Editor:

```sql
create table bugs (
  id uuid primary key default gen_random_uuid(),
  bug_id text unique not null,
  title text not null,
  module text,
  status text not null default 'Open'
    check (status in ('Open','In Progress','Fixed','Verified','Closed')),
  severity text not null default 'Medium'
    check (severity in ('Critical','High','Medium','Low')),
  reporter text not null,
  screenshot_url text,
  fix_notes text,
  verified_by text,
  notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Auto-generate bug_id as ERP-001, ERP-002, etc.
create sequence bug_id_seq start 1;

create or replace function set_bug_id()
returns trigger as $$
begin
  new.bug_id := 'ERP-' || lpad(nextval('bug_id_seq')::text, 3, '0');
  return new;
end;
$$ language plpgsql;

create trigger bug_id_trigger
  before insert on bugs
  for each row execute function set_bug_id();

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger updated_at_trigger
  before update on bugs
  for each row execute function update_updated_at();

-- Enable realtime
alter publication supabase_realtime add table bugs;

-- Index for common queries
create index idx_bugs_status on bugs(status);
create index idx_bugs_reporter on bugs(reporter);
```

**Step 2: Create storage bucket**

Run in SQL Editor:

```sql
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true);

-- Allow public uploads (internal tool, no auth)
create policy "Allow public uploads"
  on storage.objects for insert
  with check (bucket_id = 'screenshots');

create policy "Allow public reads"
  on storage.objects for select
  using (bucket_id = 'screenshots');

create policy "Allow public deletes"
  on storage.objects for delete
  using (bucket_id = 'screenshots');
```

**Step 3: Disable RLS on bugs table (internal tool, no auth)**

```sql
alter table bugs disable row level security;
```

**Step 4: Note your Supabase credentials**

From Supabase dashboard > Settings > API, grab:
- `SUPABASE_URL` (e.g. `https://xxxxx.supabase.co`)
- `SUPABASE_ANON_KEY` (the `anon` / `public` key)

These go in the shared JS config in Task 2.

**Verify:** Table exists in Supabase Table Editor, realtime is enabled (check Database > Replication).

**Commit:** No code files yet, just SQL run in dashboard.

---

### Task 2: Project Structure + Shared Assets

**Files:**
- Create: `shared/styles.css`
- Create: `shared/config.js`
- Create: `vercel.json`

**Step 1: Create project structure**

```bash
mkdir -p report fix shared
```

**Step 2: Create `shared/config.js`**

```javascript
// Supabase client init — shared by both views
// Replace with your actual Supabase credentials
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helpers
function timeAgo(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now - date) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  if (days < 7) return days + 'd ago';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

const MODULES = {
  'Finance': ['Invoice', 'COA', 'Journal', 'AR Aging', 'AP Aging', 'Bank Recon', 'Petty Cash', 'Debit Note', 'Credit Note', 'Credit Limit'],
  'Operations': ['Inventory', 'Purchase', 'Sales'],
  'Other': ['HR', 'Settings', 'Dashboard', 'Auth']
};

const STATUS_COLORS = {
  'Open': { dot: '#FF3B30', bg: '#FFF0EF' },
  'In Progress': { dot: '#FF9500', bg: '#FFF8EE' },
  'Fixed': { dot: '#007AFF', bg: '#EEF4FF' },
  'Verified': { dot: '#34C759', bg: '#EEFBF3' },
  'Closed': { dot: '#8E8E93', bg: '#F2F2F7' }
};

const SEVERITY_COLORS = {
  'Critical': '#FF3B30',
  'High': '#FF9500',
  'Medium': '#FFCC00',
  'Low': '#8E8E93'
};

const REPORTERS = ['Richie', 'Darren', 'Raymond'];
```

**Step 3: Create `shared/styles.css`**

The complete Apple-airy design system. Key tokens:

```css
/* Apple-Airy Design System */
:root {
  --font: -apple-system, 'Inter', 'SF Pro Display', 'Helvetica Neue', sans-serif;
  --font-mono: 'SF Mono', ui-monospace, monospace;

  /* Colors */
  --bg: #FFFFFF;
  --bg-secondary: #F5F5F7;
  --bg-tertiary: #FAFAFA;
  --text-primary: #1D1D1F;
  --text-secondary: #6E6E73;
  --text-tertiary: #AEAEB2;
  --border: #E5E5EA;
  --border-light: #F2F2F7;
  --blue: #007AFF;
  --blue-bg: #EEF4FF;
  --red: #FF3B30;
  --red-bg: #FFF0EF;
  --orange: #FF9500;
  --orange-bg: #FFF8EE;
  --green: #34C759;
  --green-bg: #EEFBF3;
  --gray: #8E8E93;
  --gray-bg: #F2F2F7;
  --yellow: #FFCC00;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.12);
  --radius: 14px;
  --radius-sm: 8px;
  --radius-lg: 20px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font);
  color: var(--text-primary);
  background: var(--bg-secondary);
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

/* Common components */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  font-size: 15px;
  font-weight: 500;
  font-family: var(--font);
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.btn-primary {
  background: var(--blue);
  color: #fff;
}
.btn-primary:hover { background: #0066D6; }
.btn-primary:active { transform: scale(0.98); }
.btn-primary:disabled {
  background: var(--border);
  color: var(--text-tertiary);
  cursor: not-allowed;
  transform: none;
}

.btn-ghost {
  background: none;
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
.btn-ghost:hover { background: var(--bg-secondary); color: var(--text-primary); }

.btn-danger {
  background: none;
  color: var(--red);
  border: 1px solid var(--red-bg);
}
.btn-danger:hover { background: var(--red-bg); }

.btn-sm { padding: 6px 12px; font-size: 13px; }

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  transition: background-color 0.2s ease, color 0.2s ease;
}
.badge::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.card {
  background: var(--bg);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-sm);
  border-radius: var(--radius);
  transition: box-shadow 0.2s ease;
}
.card:hover { box-shadow: var(--shadow-md); }

/* Toast notification */
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%) translateY(100px);
  background: var(--text-primary);
  color: #fff;
  padding: 12px 24px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
  z-index: 1000;
  opacity: 0;
  transition: all 0.3s ease;
  pointer-events: none;
}
.toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.toast.error { background: var(--red); }

/* Lightbox */
.lightbox {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
  cursor: zoom-out;
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
}
.lightbox.show { opacity: 1; pointer-events: auto; }
.lightbox img { max-width: 90vw; max-height: 90vh; border-radius: 12px; }

/* Offline banner */
.offline-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: var(--orange);
  color: #fff;
  text-align: center;
  padding: 8px;
  font-size: 13px;
  font-weight: 500;
  z-index: 999;
  transform: translateY(-100%);
  transition: transform 0.3s ease;
}
.offline-banner.show { transform: translateY(0); }
```

**Step 4: Create `vercel.json`**

```json
{
  "rewrites": [
    { "source": "/report", "destination": "/report/index.html" },
    { "source": "/fix", "destination": "/fix/index.html" },
    { "source": "/", "destination": "/report/index.html" }
  ]
}
```

**Verify:** File structure exists:
```
Bug-Tracker/
  report/
  fix/
  shared/
    styles.css
    config.js
  vercel.json
  docs/plans/...
```

**Commit:**
```bash
git add shared/ vercel.json
git commit -m "feat: project structure, shared design system and Supabase config"
```

---

### Task 3: Reporter View — Identity + Page Shell

**Files:**
- Create: `report/index.html`

**Context:** Build the reporter view page shell with the identity picker (first visit) and the greeting header. The capture form and bug feed will be added in Tasks 4 and 5.

**Implementation details:**

- Page loads with a centered name picker if no identity in localStorage
- Three large tappable cards with names: Richie, Darren, Raymond
- On selection, saves to `localStorage.setItem('reporter-name', name)` and shows the main view
- Main view has greeting at top: "Hey Darren" (tappable to switch identity)
- Centered content column, max-width 640px
- Include Supabase CDN: `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>`
- Include `shared/styles.css` and `shared/config.js`
- Placeholder sections for capture form and bug feed (populated in next tasks)

**Key design:**
- Name picker cards: white, 1px border, shadow-sm, 14px radius, 80px padding, large emoji avatar (optional) + name, hover lifts shadow
- Page background: var(--bg-secondary)
- Content area background: transparent (cards provide the white)
- Greeting: 28px weight-600, text-primary, left-aligned above form

**Verify:** Open `report/index.html` in browser. Name picker shows on first visit. After selecting, greeting appears. Refresh — greeting persists.

**Commit:**
```bash
git add report/index.html
git commit -m "feat: reporter view shell with identity picker"
```

---

### Task 4: Reporter View — Capture Form

**Files:**
- Modify: `report/index.html`

**Context:** Build the always-visible capture form: title input, module bottom sheet, screenshot drop zone, submit button. This is the core of the reporter experience — zero friction.

**Implementation details:**

**Title input:**
- Full-width, 18px font, 16px padding, border: 1px solid var(--border), radius-sm
- Placeholder: "What went wrong?"
- Focus: border-color transitions to var(--blue)

**Module picker:**
- Tappable pill showing "Select module..." in muted text, or selected module
- On tap: opens a modal/bottom sheet with grouped module list
- Groups: Finance (10 items), Operations (3), Other (4) — from MODULES in config.js
- Group headers: 12px uppercase muted, non-tappable
- Module items: 44px tap target, full-width rows, hover highlight
- Tap module: closes sheet, pill updates
- Mobile: sheet slides up from bottom (position: fixed, bottom: 0, border-radius top corners)
- Desktop: positioned popover below the pill

**Screenshot drop zone:**
- 160px tall (120px on mobile), dashed 2px border var(--border), border-radius var(--radius)
- Center text: camera icon + "Drop, paste, or tap to add screenshot"
- Clearly states "1 screenshot per report" as subtext
- Accepts: dragover/drop events, paste (Cmd+V) via document paste listener, click to open file input
- After capture: shows thumbnail filling the zone, X button top-right to remove
- Converts to base64 data URL for preview, uploads to Supabase Storage on submit

**Submit button:**
- Full-width, var(--blue), white text, "Report Bug", 50px height
- Disabled (grayed) until title is non-empty
- On submit: uploads screenshot to Supabase Storage (if any), inserts row into bugs table
- Optimistic: clears form immediately, shows toast "Bug reported"
- On error: shows error toast, does NOT clear form

**Verify:** Fill title, select module, paste a screenshot, submit. Check Supabase table for new row. Check Storage for uploaded image.

**Commit:**
```bash
git add report/index.html
git commit -m "feat: reporter capture form with module picker and screenshot upload"
```

---

### Task 5: Reporter View — Bug Feed + Real-Time

**Files:**
- Modify: `report/index.html`

**Context:** Build the "Your Bugs" feed below the capture form. Cards show the reporter's submitted bugs with live status updates.

**Implementation details:**

**Data loading:**
- On page load: `supabase.from('bugs').select('*').eq('reporter', currentName).order('created_at', { ascending: false })`
- Render cards from result

**Card design:**
- White card, 1px border (#E5E5EA), shadow-sm, 14px radius, 16px padding
- Title: 15px semi-bold
- Module: small gray pill tag
- Status badge: colored dot + text, using STATUS_COLORS from config
- Relative timestamp: right side, muted, using timeAgo()
- Screenshot indicator: 40x40 thumbnail in bottom-right corner if screenshot_url exists
- 8px gap between cards

**Card expand:**
- Tap card: smooth height animation (max-height transition, 300ms ease)
- Expanded content: full screenshot image (if any) + fix_notes from Richie (read-only)
- If no fix_notes: show "No fix notes yet" in muted italic

**Real-time subscription:**
```javascript
supabase.channel('reporter-bugs')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'bugs',
    filter: `reporter=eq.${currentName}`
  }, (payload) => {
    // UPDATE: find card, update badge/content with smooth transition
    // INSERT: prepend card with fade-in (for optimistic reconciliation)
    // DELETE: remove card with fade-out
  })
  .subscribe();
```

**Edge states:**
- Empty feed: centered icon (subtle line-art bug with checkmark), "No bugs reported yet.", subtext "When you report a bug, it'll show up here with live status updates."
- After submit (optimistic): card appears at top with fade-in before Supabase confirms. On confirm, reconcile (usually no visible change). On error, card shows orange "Not synced" dot + "Retry" button.
- Offline: show offline banner at top of page. Cards still render from last loaded state.

**Verify:** Submit a bug. Card appears. Go to Supabase, change status. Card updates live in browser without refresh.

**Commit:**
```bash
git add report/index.html
git commit -m "feat: reporter bug feed with real-time status updates"
```

---

### Task 6: Fixer View — Layout Shell + Left Rail

**Files:**
- Create: `fix/index.html`

**Context:** Build the fixer view three-zone layout: left rail (stats + filters), board area (placeholder), detail panel slot. Desktop-first, full viewport.

**Implementation details:**

**Layout:**
```css
.fixer-shell { display: flex; height: 100vh; overflow: hidden; }
.rail { width: 240px; border-right: 1px solid var(--border); background: var(--bg); display: flex; flex-direction: column; flex-shrink: 0; transition: width 0.25s ease; overflow: hidden; }
.rail.collapsed { width: 48px; }
.board-area { flex: 1; overflow-x: auto; overflow-y: hidden; background: var(--bg-secondary); }
.detail-panel { width: 0; border-left: 1px solid var(--border); background: var(--bg); overflow-y: auto; transition: width 0.25s ease; flex-shrink: 0; }
.detail-panel.open { width: 400px; }
```

**Left rail contents:**

**Stats (top):**
- Four stacked rows: Open (red dot), In Progress (orange), Fixed (blue), Verified (green)
- Each row: colored dot + count (24px mono) + label (14px muted)
- Tappable: click to filter board to that status. Active row gets blue-bg highlight.
- Counts loaded from `supabase.from('bugs').select('status')` and counted client-side

**Filters (below stats):**
- Search input: icon + text field, full rail width
- Module: same grouped dropdown as reporter view
- Reporter pills: All | Richie | Darren | Raymond (horizontal wrap)
- Severity pills: All | Critical | High | Medium | Low
- Active filters: rendered as removable chips below filters. "Clear all" link.

**Collapse:**
- Button at bottom of rail with `[` icon. Collapses to 48px showing only stat count numbers vertically.
- Keyboard shortcut `[` toggles.

**Verify:** Open `fix/index.html`. Rail shows with stats (0 counts until bugs exist). Filters render. Collapse toggle works.

**Commit:**
```bash
git add fix/index.html
git commit -m "feat: fixer view layout shell with stats and filter rail"
```

---

### Task 7: Fixer View — Kanban Board

**Files:**
- Modify: `fix/index.html`

**Context:** Build the four-column kanban board with draggable cards. This is the core of the fixer experience.

**Implementation details:**

**Columns:**
- Four columns: Open | In Progress | Fixed | Verified
- Each column: flex-shrink: 0, width: 280px, full height, vertical scroll
- Column header: status name + count badge (muted), sticky top
- Column body: 8px padding, 6px gap between cards
- Empty column: dashed-border box "Drag bugs here" (or "No bugs with this status" on mobile)

**Card (compact, ~120px):**
```html
<div class="kanban-card" draggable="true" data-id="uuid">
  <div class="card-header">
    <span class="card-id">ERP-014</span>
    <span class="card-time">2h ago</span>
  </div>
  <div class="card-title">Credit limit not enforced on PUT /invoice</div>
  <div class="card-footer">
    <span class="card-module">Finance / Invoice</span>
    <span class="severity-dot" data-severity="High" title="High"></span>
    <span class="card-reporter">Darren</span>
    <img class="card-thumb" src="..." />
  </div>
</div>
```

**Severity dot click:** Cycles Low → Medium → High → Critical → Low. Updates Supabase inline. Dot color changes smoothly.

**Desktop drag-and-drop:**
- `dragstart`: set dataTransfer with bug id, card gets opacity 0.5
- `dragover` on columns: prevent default, add highlight class (blue border + light blue bg)
- `dragleave`: remove highlight
- `drop`: move bug to new status, update Supabase, re-render
- Status is determined by which column receives the drop

**Mobile touch fallback:**
- Long-press (300ms via touchstart/touchend timer): card lifts (scale 1.02, shadow-lg), show move sheet
- Move sheet: fixed bottom, white bg, rounded top corners, four horizontal status pills
- Tap target status: update bug, close sheet
- If touch moves before 300ms: cancel (it's a scroll)

**Data loading:**
```javascript
const { data: bugs } = await supabase.from('bugs')
  .select('*')
  .not('status', 'eq', 'Closed')
  .order('created_at', { ascending: false });
```

Group into columns by status and render.

**Verify:** Create bugs in Supabase (or via reporter view). Cards appear in correct columns. Drag a card from Open to In Progress. Check Supabase row updated.

**Commit:**
```bash
git add fix/index.html
git commit -m "feat: kanban board with drag-and-drop and mobile long-press"
```

---

### Task 8: Fixer View — Detail Panel

**Files:**
- Modify: `fix/index.html`

**Context:** Build the right-side detail panel that slides open when a card is clicked. All fields are inline-editable with auto-save.

**Implementation details:**

**Open/close:**
- Click a card (not long-press): panel slides in from right (width 0 → 400px, 250ms ease)
- Board area shrinks to accommodate
- `Escape` key closes panel
- X button in panel header closes
- Clicking a different card switches content

**Panel contents (top to bottom):**

**Header:** Bug ID (monospace) + status badge (left), X close button (right)

**Title:** 18px, semi-bold. Click to edit (contenteditable or swap to input). Auto-save on blur via `supabase.from('bugs').update({ title }).eq('id', bugId)`.

**Metadata row:** Reporter (read-only) | Module tag | Created date (formatted) | Severity dot (tappable, same cycle behavior)

**Screenshot:**
- If screenshot_url: full-width `<img>`, max-height 300px, object-fit contain, click opens lightbox
- If no screenshot: section hidden entirely (no empty placeholder)

**Status stepper:**
```html
<div class="status-stepper">
  <button class="step active">Open</button>
  <span class="step-line"></span>
  <button class="step">In Progress</button>
  <span class="step-line"></span>
  <button class="step">Fixed</button>
  <span class="step-line"></span>
  <button class="step">Verified</button>
  <span class="step-line"></span>
  <button class="step">Closed</button>
</div>
```
- Current status and all prior steps are filled (blue)
- Click any step: updates status. Moving backward shows a small popover "Reopen? This moves the bug back to [status]." with Confirm/Cancel.
- Auto-saves to Supabase on click

**Fix Notes:**
- Textarea, 120px min-height, placeholder "What did you change? File, function, what..."
- Auto-save 1 second after last keystroke (debounced):
```javascript
let saveTimer;
fixNotesEl.addEventListener('input', () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await supabase.from('bugs').update({ fix_notes: fixNotesEl.value }).eq('id', bugId);
    showSavedIndicator(); // small "Saved" text fades in beside label, fades out after 1.5s
  }, 1000);
});
```

**Verified By:** Dropdown (— | Richie | Darren | Raymond). Auto-save on change.

**Notes/Links:** Single-line input. Auto-save on blur.

**Delete:** Ghost red button. Click shows inline confirmation with Yes/Cancel. On confirm: `supabase.from('bugs').delete().eq('id', bugId)`, close panel, remove card from board.

**Verify:** Click a card. Panel opens. Edit title, blur — check Supabase. Type fix notes, wait 1s — check Supabase. Click status stepper. Try backward move confirmation. Delete a bug.

**Commit:**
```bash
git add fix/index.html
git commit -m "feat: detail panel with inline editing and auto-save"
```

---

### Task 9: Fixer View — Keyboard Shortcuts + Real-Time

**Files:**
- Modify: `fix/index.html`

**Context:** Add keyboard shortcuts for power-user speed, and wire up Supabase Realtime so new bugs from reporters appear live.

**Keyboard shortcuts:**

```javascript
document.addEventListener('keydown', (e) => {
  // Don't trigger when typing in inputs
  if (e.target.matches('input, textarea, [contenteditable]')) return;

  switch(e.key) {
    case 'n': case 'N': focusSearch(); break;
    case '[': toggleRail(); break;
    case 'Escape': closeDetailPanel(); break;
    case '1': filterToStatus('Open'); break;
    case '2': filterToStatus('In Progress'); break;
    case '3': filterToStatus('Fixed'); break;
    case '4': filterToStatus('Verified'); break;
    case '0': clearFilters(); break;
    case 'ArrowUp': navigateCards(-1); break;
    case 'ArrowDown': navigateCards(1); break;
    case 'Enter': openFocusedCard(); break;
    case 'ArrowRight': moveFocusedCardForward(); break;
    case '?': toggleShortcutOverlay(); break;
  }
});
```

**Shortcut overlay (`?`):**
- Fixed overlay, centered card with white bg, lists all shortcuts in a 2-column table
- Click outside or `?` again to dismiss

**Card navigation (arrow keys):**
- Track a `focusedCardIndex` and `focusedColumn`
- Focused card gets a blue border ring (box-shadow: 0 0 0 2px var(--blue))
- Up/Down moves within current column
- Right arrow: moves focused card to next status column (same as drag-drop)

**Real-time subscription:**
```javascript
supabase.channel('fixer-bugs')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'bugs'
  }, (payload) => {
    // New bug: add card to Open column with slide-down animation
    // Increment stats
  })
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'bugs'
  }, (payload) => {
    // Status change: move card between columns with animation
    // Other field change: update card content and detail panel if open
    // If Richie is editing fix_notes on this bug, don't overwrite (debounce conflict)
  })
  .on('postgres_changes', {
    event: 'DELETE',
    schema: 'public',
    table: 'bugs'
  }, (payload) => {
    // Remove card, close detail panel if this bug was open
  })
  .subscribe();
```

**Verify:** Open reporter view in another tab. Submit a bug. Fixer view gets the card live. Use keyboard shortcuts to navigate and move cards.

**Commit:**
```bash
git add fix/index.html
git commit -m "feat: keyboard shortcuts and real-time sync"
```

---

### Task 10: Polish + Deploy

**Files:**
- Modify: `report/index.html` (responsive tweaks)
- Modify: `fix/index.html` (responsive tweaks, offline banner)
- Modify: `vercel.json` (if needed)

**Step 1: Mobile responsive pass**

Reporter view:
- Already mobile-first by design
- Verify module bottom sheet works on 375px
- Screenshot drop zone at 120px height on mobile

Fixer view:
- Rail: collapses to hamburger on < 768px (icon button top-left to toggle as overlay)
- Board: single column scrollable on mobile (stack columns vertically)
- Detail panel: full-screen overlay on mobile (not side panel)
- Long-press move sheet: verified at 375px

**Step 2: Offline handling**

Both views:
```javascript
window.addEventListener('online', () => {
  document.querySelector('.offline-banner')?.classList.remove('show');
  // Flush pending writes
});
window.addEventListener('offline', () => {
  document.querySelector('.offline-banner')?.classList.add('show');
});
```

**Step 3: Landing redirect**

Root `/` redirects to `/report` (already in vercel.json).

**Step 4: Deploy to Vercel**

```bash
# Install Vercel CLI if needed
npm i -g vercel

# Deploy
cd "/Volumes/Extreme SSD/Bug-Tracker"
vercel
```

Follow prompts. The project deploys as static files with the rewrites from vercel.json.

**Verify:** Visit deployed URL. `/report` shows reporter view. `/fix` shows fixer view. Submit a bug from `/report`, see it appear on `/fix`.

**Commit:**
```bash
git add -A
git commit -m "feat: responsive polish and Vercel deployment config"
```

---

## Task Dependencies

```
Task 1 (Supabase) ─── must be done first, in dashboard
Task 2 (Structure) ── after Task 1, provides shared assets
Task 3 (Reporter shell) ── after Task 2
Task 4 (Reporter form) ── after Task 3
Task 5 (Reporter feed) ── after Task 4
Task 6 (Fixer shell) ── after Task 2 (parallel with Tasks 3-5)
Task 7 (Fixer kanban) ── after Task 6
Task 8 (Fixer detail) ── after Task 7
Task 9 (Fixer shortcuts + RT) ── after Task 8
Task 10 (Polish + Deploy) ── after Tasks 5 and 9
```

Tasks 3-5 (reporter) and Tasks 6-9 (fixer) can run in parallel after Task 2.

# Verify Inbox + Fixer Attach UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a top-of-dashboard "Verify inbox" strip to `reporter/index.html` for one-tap verify/reopen, and improve fix-screenshot attach discoverability in `fixer/index.html` with a modal-wide drop target, clipboard-paste banner, and triple-hint pills.

**Architecture:** Two single-file static HTML apps. All additions are inline CSS + inline JS. No backend changes. No new files. No new dependencies. Existing `allBugs` array, existing Supabase client, existing `showToast` (from `shared/config.js`) are reused. A new local `showUndoToast(msg, onUndo, ms)` will be added to `reporter/index.html` since the shared one does not support undo.

**Tech Stack:** HTML / inline CSS / inline JS, Supabase JS client (already loaded), vanilla `navigator.clipboard.read()` for clipboard-image detection.

**Source of truth:** `docs/plans/2026-04-17-verify-inbox-and-fixer-attach-design.md`

**Anchors** (as of commit `1a957cc`; use `Grep` to locate if lines shifted):
- Reporter toast CSS: `reporter/index.html:98` (`/* ── Toast ── */`)
- Reporter main container: `reporter/index.html:1070` (`<main class="main">`)
- Reporter list heading: `reporter/index.html:1117` (`<div class="list-heading">`)
- Reporter `renderBugs(newId)`: `reporter/index.html:1811`
- Reporter `bugRowHTML`: `reporter/index.html:~1852`
- Reporter `VIEW_META`: `reporter/index.html:~1385`
- Fixer fix modal body: `fixer/index.html:920` (`<div class="fix-modal-body">`)
- Fixer upload zone: `fixer/index.html:921` (`.fix-upload-zone`)
- Fixer hint text: `fixer/index.html:930`
- Fixer existing drop listeners: `fixer/index.html:1572-1580`
- Fixer `openFixModal` / modal open: grep for `fixModalOverlay.classList.add('open')`

---

## Task 1: Add `showUndoToast` helper + toast-undo CSS (reporter)

**Why:** The shared `showToast(msg, isError)` auto-dismisses at 3s with no action button. Verify/reopen need a 6-second toast with an Undo button. Adding a small local helper keeps `shared/config.js` untouched.

**Files:**
- Modify: `reporter/index.html` (CSS around line 108; JS near top of app script — any top-level helper section)

**Step 1: Extend the toast CSS.** Append after `.toast.error { ... }` (line 108):

```css
  .toast.with-action { padding: 8px 8px 8px 16px; display: flex; align-items: center; gap: 12px; }
  .toast-undo-btn {
    background: transparent; color: var(--bg-primary); border: 0.5px solid color-mix(in srgb, var(--bg-primary) 40%, transparent);
    padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 500;
    cursor: pointer; letter-spacing: 0.02em;
  }
  .toast-undo-btn:hover { background: color-mix(in srgb, var(--bg-primary) 15%, transparent); }
```

**Step 2: Add the JS helper.** Place near the top of the reporter script, right after the Supabase init (grep for `const sb = ` and insert after its block). Function:

```js
/* showUndoToast — 6s toast with an Undo button. Returns a cancel() function. */
function showUndoToast(message, onUndo, durationMs = 6000) {
  let toast = document.querySelector('.toast.with-action');
  if (toast) toast.remove();
  toast = document.createElement('div');
  toast.className = 'toast with-action show';
  toast.innerHTML = `<span></span><button class="toast-undo-btn" type="button">Undo</button>`;
  toast.firstChild.textContent = message;
  document.body.appendChild(toast);

  let done = false;
  const btn = toast.querySelector('.toast-undo-btn');
  const finish = () => {
    if (done) return;
    done = true;
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  };
  btn.addEventListener('click', () => { if (done) return; done = true; onUndo(); finish(); });
  const timer = setTimeout(finish, durationMs);

  return () => { clearTimeout(timer); finish(); };
}
```

**Step 3: Sanity-parse the inline script.**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('reporter/index.html','utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
try { new Function(m[1]); console.log('JS OK:', m[1].length); }
catch(e) { console.log('JS ERR:', e.message); process.exit(1); }
"
```
Expected: `JS OK: <n>` with no error.

**Step 4: Commit.**

```bash
git add reporter/index.html
git commit -m "feat(reporter): add showUndoToast helper for verify inbox"
```

---

## Task 2: Add verify-inbox CSS (reporter)

**Files:**
- Modify: `reporter/index.html` — insert a new CSS block right before the `/* ── Toast ── */` block (around line 97), so the styles sit with the other dashboard UI.

**Step 1: Paste this CSS block.**

```css
  /* ── Verify Inbox ── */
  .verify-inbox {
    margin-bottom: 14px;
    border: 0.5px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    overflow: hidden;
    transition: opacity 0.3s, transform 0.3s;
  }
  .verify-inbox.hide { display: none; }
  .verify-inbox.fade-out { opacity: 0; transform: translateY(-4px); pointer-events: none; }
  .vi-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; border-bottom: 0.5px solid var(--border-light);
    background: var(--bg-secondary);
  }
  .vi-head-title { font-size: 12px; font-weight: 600; color: var(--text-primary); letter-spacing: 0.02em; text-transform: uppercase; }
  .vi-head-title .vi-count { color: var(--text-tertiary); margin-left: 6px; font-weight: 500; }
  .vi-dismiss { background: transparent; border: 0; color: var(--text-tertiary); font-size: 18px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
  .vi-dismiss:hover { color: var(--text-primary); background: var(--bg-primary); }

  .vi-card {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 14px;
    align-items: center;
    padding: 12px 14px;
    border-top: 0.5px solid var(--border-light);
    transition: opacity 0.2s, transform 0.2s, max-height 0.2s;
    max-height: 200px; overflow: hidden;
  }
  .vi-card:first-of-type { border-top: 0; }
  .vi-card.verifying { opacity: 0; transform: translateX(14px); max-height: 0; padding-top: 0; padding-bottom: 0; border-top-width: 0; }

  .vi-thumbs { display: flex; gap: 6px; }
  .vi-thumb {
    width: 64px; height: 48px; border-radius: 4px; overflow: hidden;
    background: var(--bg-secondary); border: 0.5px solid var(--border-light);
    cursor: zoom-in; position: relative;
  }
  .vi-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .vi-thumb.placeholder { display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); font-size: 10px; }
  .vi-thumb-label {
    position: absolute; top: 2px; left: 2px; padding: 1px 4px;
    background: rgba(0,0,0,0.55); color: #fff; font-size: 9px; border-radius: 2px;
    letter-spacing: 0.04em;
  }

  .vi-body { min-width: 0; }
  .vi-title { font-size: 13px; font-weight: 500; color: var(--text-primary); margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vi-note { font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vi-note.empty { color: var(--text-tertiary); font-style: italic; }

  .vi-actions { display: flex; gap: 6px; }
  .vi-btn {
    font-size: 12px; font-weight: 500; padding: 6px 12px;
    border-radius: 6px; border: 0.5px solid transparent; cursor: pointer;
    white-space: nowrap;
  }
  .vi-btn.verify { background: var(--green); color: #fff; }
  .vi-btn.verify:hover { filter: brightness(1.05); }
  .vi-btn.reopen { background: transparent; color: var(--text-secondary); border-color: var(--border-light); }
  .vi-btn.reopen:hover { color: var(--red-text); border-color: var(--red); }

  .vi-reopen-prompt {
    display: none; grid-column: 1 / -1;
    padding: 10px 0 0;
    border-top: 0.5px dashed var(--border-light);
    margin-top: 10px;
  }
  .vi-card.reopening .vi-reopen-prompt { display: block; }
  .vi-reopen-prompt textarea {
    width: 100%; min-height: 54px; resize: vertical;
    font: inherit; font-size: 13px;
    padding: 8px 10px; border: 0.5px solid var(--border-light); border-radius: 6px;
    background: var(--bg-secondary); color: var(--text-primary);
  }
  .vi-reopen-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }

  @media (max-width: 640px) {
    .vi-card { grid-template-columns: 1fr; gap: 10px; }
    .vi-thumbs { order: 2; }
    .vi-body { order: 1; }
    .vi-actions { order: 3; justify-content: flex-end; }
    .vi-thumb { width: 100%; height: 80px; }
  }
```

**Step 2: Commit.**

```bash
git add reporter/index.html
git commit -m "feat(reporter): verify-inbox CSS"
```

---

## Task 3: Add verify-inbox HTML container (reporter)

**Files:**
- Modify: `reporter/index.html` around line 1116 (right before the `<!-- Section heading -->` `list-heading` div inside `<main class="main">`).

**Step 1: Insert the container.**

```html
    <!-- Verify inbox — shows Fixed bugs the current user reported, awaiting verify -->
    <section class="verify-inbox hide" id="verify-inbox" aria-label="Bugs awaiting your verification"></section>
```

Placement: sibling, just above `<div class="list-heading">`. Starts hidden; `renderVerifyInbox` toggles visibility.

**Step 2: Verify HTML is still valid (no broken tags).** Open `http://localhost:4321/reporter/` (server already runs on 4321) and confirm no layout break. The section is empty so nothing renders yet.

**Step 3: Commit.**

```bash
git add reporter/index.html
git commit -m "feat(reporter): verify-inbox container in dashboard"
```

---

## Task 4: Implement `renderVerifyInbox()` and hook into `renderBugs()` (reporter)

**Files:**
- Modify: `reporter/index.html` — add the function in the rendering section (near `renderBugs`), and call it from inside `renderBugs`.

**Step 1: Add the function.** Insert just after `renderBugs(newId)` closes (grep for `renderBugs(newId)` → jump to its end):

```js
  /* ============================================================
     Verify inbox — Fixed bugs reported by currentName
     ============================================================ */
  const verifyInboxEl = document.getElementById('verify-inbox');
  let viDismissed = sessionStorage.getItem('vi-dismissed') === '1';

  function getVerifyQueue() {
    return allBugs.filter(b => b.status === 'Fixed' && b.reporter === currentName);
  }

  function renderVerifyInbox() {
    if (!verifyInboxEl) return;
    const queue = getVerifyQueue();

    // Hide on the sidebar's needs-verify view (avoid duplication with the main list)
    if (queue.length === 0 || activeView === 'needs-verify' || viDismissed) {
      verifyInboxEl.classList.add('hide');
      verifyInboxEl.innerHTML = '';
      return;
    }

    verifyInboxEl.classList.remove('hide', 'fade-out');

    const head = `
      <div class="vi-head">
        <div class="vi-head-title">Needs your verification <span class="vi-count">· ${queue.length}</span></div>
        <button class="vi-dismiss" id="vi-dismiss-all" type="button" aria-label="Dismiss until next load">&times;</button>
      </div>`;

    const cardHTML = (b) => {
      const beforeUrl = b.screenshot_url || '';
      const afterUrl  = b.fix_screenshot_url || '';
      const beforeThumb = beforeUrl
        ? `<div class="vi-thumb" data-lightbox="${esc(beforeUrl)}"><span class="vi-thumb-label">BEFORE</span><img src="${esc(beforeUrl)}" alt=""></div>`
        : `<div class="vi-thumb placeholder"><span class="vi-thumb-label">BEFORE</span>none</div>`;
      const afterThumb = afterUrl
        ? `<div class="vi-thumb" data-lightbox="${esc(afterUrl)}"><span class="vi-thumb-label">AFTER</span><img src="${esc(afterUrl)}" alt=""></div>`
        : `<div class="vi-thumb placeholder"><span class="vi-thumb-label">AFTER</span>none</div>`;

      const noteHTML = b.fix_notes
        ? `<div class="vi-note">${esc(b.fix_notes)}</div>`
        : `<div class="vi-note empty">No fixer note</div>`;

      return `
        <div class="vi-card" data-vi-id="${b.id}">
          <div class="vi-thumbs">${beforeThumb}${afterThumb}</div>
          <div class="vi-body">
            <div class="vi-title">${esc(b.bug_id ? b.bug_id + ' · ' : '')}${esc(b.title)}</div>
            ${noteHTML}
          </div>
          <div class="vi-actions">
            <button class="vi-btn reopen" data-vi-reopen="${b.id}" type="button">↩ Reopen</button>
            <button class="vi-btn verify" data-vi-verify="${b.id}" type="button">✓ Verify</button>
          </div>
          <div class="vi-reopen-prompt">
            <textarea placeholder="What's still wrong? (optional)"></textarea>
            <div class="vi-reopen-actions">
              <button class="vi-btn reopen" data-vi-reopen-cancel="${b.id}" type="button">Cancel</button>
              <button class="vi-btn verify" data-vi-reopen-confirm="${b.id}" type="button" style="background:var(--red);">Reopen bug</button>
            </div>
          </div>
        </div>`;
    };

    verifyInboxEl.innerHTML = head + queue.map(cardHTML).join('');
    bindVerifyInboxEvents();
  }

  function bindVerifyInboxEvents() {
    // event delegation: one listener, many buttons
    verifyInboxEl.onclick = (e) => {
      const dismiss = e.target.closest('#vi-dismiss-all');
      if (dismiss) { viDismissed = true; sessionStorage.setItem('vi-dismissed','1'); renderVerifyInbox(); return; }

      const verifyBtn = e.target.closest('[data-vi-verify]');
      if (verifyBtn) { handleVerifyInbox(verifyBtn.dataset.viVerify); return; }

      const reopenBtn = e.target.closest('[data-vi-reopen]');
      if (reopenBtn) {
        const card = reopenBtn.closest('.vi-card');
        card.classList.add('reopening');
        card.querySelector('textarea').focus();
        return;
      }
      const cancelBtn = e.target.closest('[data-vi-reopen-cancel]');
      if (cancelBtn) { cancelBtn.closest('.vi-card').classList.remove('reopening'); return; }

      const confirmBtn = e.target.closest('[data-vi-reopen-confirm]');
      if (confirmBtn) {
        const card = confirmBtn.closest('.vi-card');
        const note = card.querySelector('textarea').value.trim();
        handleReopenInbox(confirmBtn.dataset.viReopenConfirm, note);
        return;
      }

      const thumb = e.target.closest('[data-lightbox]');
      if (thumb) { openLightbox(thumb.dataset.lightbox); return; }
    };
  }

  // stubs — filled in next tasks
  function handleVerifyInbox(id) { /* Task 5 */ }
  function handleReopenInbox(id, note) { /* Task 6 */ }
```

**Step 2: Hook `renderVerifyInbox()` into `renderBugs()`.** Inside `renderBugs(newId)`, at the very top of the function body, add:

```js
    renderVerifyInbox();
```

**Step 3: Confirm `openLightbox` exists.** Grep: `grep -n "function openLightbox\|openLightbox =" reporter/index.html`. If it doesn't exist, the lightbox is probably opened elsewhere — find how it's triggered (grep `data-lightbox`), then either call that same path or fall back to `window.open(url)` for thumbs. Do not invent a new lightbox.

**Step 4: JS parse sanity check** (same command as Task 1 Step 3). Expected: OK.

**Step 5: Browser check.** Reload `http://localhost:4321/reporter/`. If you have a Fixed bug under your account, the strip should render at the top of the dashboard with before/after thumbs and the two buttons. Buttons won't do anything yet.

**Step 6: Commit.**

```bash
git add reporter/index.html
git commit -m "feat(reporter): renderVerifyInbox scaffolds the queue UI"
```

---

## Task 5: Implement verify action with optimistic update + undo (reporter)

**Files:**
- Modify: `reporter/index.html` — replace the `handleVerifyInbox` stub.

**Step 1: Implementation.**

```js
  const pendingVerifies = new Map(); // id -> previous status

  async function handleVerifyInbox(id) {
    const bug = allBugs.find(b => String(b.id) === String(id));
    if (!bug) return;

    // Optimistic: animate card out and mutate local status
    const card = verifyInboxEl.querySelector(`.vi-card[data-vi-id="${id}"]`);
    if (card) card.classList.add('verifying');
    pendingVerifies.set(String(id), bug.status);
    bug.status = 'Verified';

    // Re-render after the CSS transition so height collapses cleanly
    setTimeout(() => renderVerifyInbox(), 220);

    let undone = false;
    const cancelToast = showUndoToast('Verified', () => {
      undone = true;
      bug.status = pendingVerifies.get(String(id)) || 'Fixed';
      pendingVerifies.delete(String(id));
      renderBugs();
    });

    const { error } = await sb.from('bugs').update({ status: 'Verified' }).eq('id', id);
    if (error) {
      bug.status = pendingVerifies.get(String(id)) || 'Fixed';
      pendingVerifies.delete(String(id));
      cancelToast();
      renderBugs();
      showToast('Couldn\'t verify — try again', true);
      return;
    }

    if (undone) {
      // Reverse the DB update to match the optimistic reversal the user chose
      await sb.from('bugs').update({ status: pendingVerifies.get(String(id)) || 'Fixed' }).eq('id', id);
    }
    pendingVerifies.delete(String(id));
  }
```

**Step 2: Browser check.** Reload. Click ✓ Verify on a queue item. Expected:
- Card animates out
- Toast appears "Verified · Undo"
- After 6s, toast goes away
- Supabase row is `Verified` (check in Supabase table editor or reload)
- Clicking Undo within 6s restores the row

**Step 3: Offline negative check.** In Chrome devtools network panel set "Offline" → click Verify → card reverts, "Couldn't verify — try again" toast shown, row still `Fixed` on server.

**Step 4: Commit.**

```bash
git add reporter/index.html
git commit -m "feat(reporter): one-tap verify with 6s undo from verify inbox"
```

---

## Task 6: Implement reopen action with note prompt + undo (reporter)

**Files:**
- Modify: `reporter/index.html` — replace the `handleReopenInbox` stub.

**Step 1: Implementation.**

```js
  async function handleReopenInbox(id, note) {
    const bug = allBugs.find(b => String(b.id) === String(id));
    if (!bug) return;

    const prev = { status: bug.status, fix_notes: bug.fix_notes, fix_screenshot_url: bug.fix_screenshot_url };

    const card = verifyInboxEl.querySelector(`.vi-card[data-vi-id="${id}"]`);
    if (card) card.classList.add('verifying');
    bug.status = 'Open';
    bug.fix_notes = null;
    setTimeout(() => renderVerifyInbox(), 220);

    let undone = false;
    const cancelToast = showUndoToast(note ? 'Reopened with note' : 'Reopened', () => {
      undone = true;
      Object.assign(bug, prev);
      renderBugs();
    });

    const updates = { status: 'Open', fix_notes: null };
    // Keep the fix_screenshot_url; we might re-verify later. If you want to clear it, do so here.
    // Prepend the reporter's reopen note to the title-level description if note is present:
    if (note) updates.fix_notes = `REOPEN NOTE: ${note}`;

    const { error } = await sb.from('bugs').update(updates).eq('id', id);
    if (error) {
      Object.assign(bug, prev);
      cancelToast();
      renderBugs();
      showToast('Couldn\'t reopen — try again', true);
      return;
    }
    if (undone) {
      await sb.from('bugs').update({ status: prev.status, fix_notes: prev.fix_notes }).eq('id', id);
    }
  }
```

**Step 2: Browser check.** On a fixed bug: click ↩ Reopen → prompt appears → type "still shows wrong total" → click Reopen bug → toast + card goes away. Supabase row: `status=Open`, `fix_notes="REOPEN NOTE: still shows wrong total"`. Click Undo within 6s → row reverts.

**Step 3: Commit.**

```bash
git add reporter/index.html
git commit -m "feat(reporter): reopen from verify inbox with optional note"
```

---

## Task 7: Reporter QA pass + fix anything that breaks

**Files:**
- Read-only pass against `reporter/index.html`.

**Step 1: Walk through the reporter verification plan** from `docs/plans/2026-04-17-verify-inbox-and-fixer-attach-design.md` steps 1–9. In particular:

1. Seed a fix and verify the strip appears.
2. Sidebar's "Needs verify" view should hide the strip (no duplication).
3. Narrow viewport (Chrome devtools, 375px wide) — thumbs should stack above the text.
4. Clear the queue — strip should hide.
5. Click ✕ dismiss-all — strip hides, does NOT verify. Reload → strip returns if there are still Fixed bugs.
6. JS parse sanity (same command as Task 1 Step 3). Expected: OK.

**Step 2: Log any defects as separate tasks** (new `TaskCreate`). Do not move on until the reporter side is clean.

**Step 3: Commit any fixes separately** with `fix(reporter): ...` prefix.

---

## Task 8: Enlarge fix-modal drop target (fixer)

**Files:**
- Modify: `fixer/index.html` — CSS (near `.fix-upload-zone` styles ~line 573) and JS (near existing drop listeners ~line 1572).

**Step 1: Add modal-wide drop overlay CSS.** After the `.fix-upload-zone` block, append:

```css
  .fix-modal { position: relative; }
  .fix-modal-dropover {
    position: absolute; inset: 0; display: none;
    align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--green) 18%, transparent);
    border: 1.5px dashed var(--green); border-radius: inherit;
    color: var(--green-text); font-size: 14px; font-weight: 600;
    pointer-events: none; z-index: 10;
    letter-spacing: 0.02em;
  }
  .fix-modal.dragging-over .fix-modal-dropover { display: flex; }
```

**Step 2: Add overlay element inside the modal.** Just inside `<div class="fix-modal">` (grep `<div class="fix-modal"`), add as first child:

```html
      <div class="fix-modal-dropover">Drop to attach screenshot</div>
```

**Step 3: Add the modal-wide drop listeners.** Near the existing `fixUploadZone.addEventListener('dragover', ...)` block, append listeners on the modal container itself with a dragcounter to stop flicker:

```js
  const fixModal = document.querySelector('.fix-modal');
  let fixDragCounter = 0;
  if (fixModal) {
    fixModal.addEventListener('dragenter', e => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      fixDragCounter++;
      fixModal.classList.add('dragging-over');
    });
    fixModal.addEventListener('dragover', e => { e.preventDefault(); });
    fixModal.addEventListener('dragleave', () => {
      fixDragCounter = Math.max(0, fixDragCounter - 1);
      if (fixDragCounter === 0) fixModal.classList.remove('dragging-over');
    });
    fixModal.addEventListener('drop', e => {
      e.preventDefault();
      fixDragCounter = 0;
      fixModal.classList.remove('dragging-over');
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFixFile(file);
    });
  }
```

**Step 4: Browser check.** Open fix modal on a bug, drag a PNG from the desktop anywhere on the modal. Expected: green overlay appears; drop attaches the image. The small drop zone still works via its own listeners.

**Step 5: Commit.**

```bash
git add fixer/index.html
git commit -m "feat(fixer): modal-wide drop target for fix screenshot"
```

---

## Task 9: Clipboard-paste banner on fix modal open (fixer)

**Files:**
- Modify: `fixer/index.html` — CSS, HTML, JS.

**Step 1: Add banner CSS** next to the `.fix-upload-*` block:

```css
  .fix-clip-banner {
    display: none; align-items: center; justify-content: space-between;
    gap: 10px; margin-bottom: 10px;
    padding: 8px 12px; border-radius: 6px;
    background: color-mix(in srgb, var(--blue) 10%, transparent);
    border: 0.5px solid color-mix(in srgb, var(--blue) 40%, transparent);
    color: var(--blue-text); font-size: 12.5px;
  }
  .fix-clip-banner.show { display: flex; }
  .fix-clip-banner button {
    background: var(--blue); color: #fff; border: 0; cursor: pointer;
    padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 500;
  }
```

**Step 2: Add HTML** inside the `fix-modal-body`, as the first child (right above `.fix-upload-zone`):

```html
      <div class="fix-clip-banner" id="fix-clip-banner">
        <span>📋 Screenshot on clipboard</span>
        <button type="button" id="fix-clip-paste">Paste</button>
      </div>
```

**Step 3: JS — detect clipboard image on modal open.** Find where the fix modal opens (grep `fixModalOverlay.classList.add('open')`). Right after the modal becomes visible, call:

```js
  async function maybeShowClipboardBanner() {
    const banner = document.getElementById('fix-clip-banner');
    if (!banner) return;
    banner.classList.remove('show');
    if (!(navigator.clipboard?.read && window.isSecureContext)) return;
    try {
      const items = await navigator.clipboard.read();
      const first = items.find(i => i.types.some(t => t.startsWith('image/')));
      if (!first) return;
      const mime = first.types.find(t => t.startsWith('image/'));
      banner.classList.add('show');
      document.getElementById('fix-clip-paste').onclick = async () => {
        const blob = await first.getType(mime);
        const file = new File([blob], `clipboard-${Date.now()}.png`, { type: mime });
        handleFixFile(file);
        banner.classList.remove('show');
      };
    } catch { /* permission denied or unsupported — silent */ }
  }
```

And invoke it right after the modal is opened (inside the `openFixModal` function, after the class is added).

**Step 4: Browser check.** Screenshot something to clipboard (Cmd+Ctrl+Shift+4 on macOS → goes to clipboard). Open fix modal → banner appears → click Paste → image attaches. Close modal, clear clipboard (copy some text), open modal → banner does not appear.

**Step 5: Commit.**

```bash
git add fixer/index.html
git commit -m "feat(fixer): clipboard-paste banner on fix modal open"
```

---

## Task 10: Replace single-line hint with triple-hint pills (fixer)

**Files:**
- Modify: `fixer/index.html` — HTML around line 930, CSS in the `.fix-upload-*` block.

**Step 1: Replace the hint.** Change line 930 from:

```html
<div class="fix-upload-hint">Drop, paste, or click — show the fixed state</div>
```

to:

```html
<div class="fix-upload-hint">Show the fixed state</div>
<div class="fix-upload-pills">
  <span class="fix-pill"><kbd>⇧</kbd> Drop</span>
  <span class="fix-pill"><kbd>⌘V</kbd> Paste</span>
  <span class="fix-pill"><kbd>⬆</kbd> Browse</span>
</div>
```

**Step 2: Add pill CSS** near the existing upload-zone CSS:

```css
  .fix-upload-pills { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; justify-content: center; }
  .fix-pill {
    font-size: 10.5px; color: var(--text-tertiary);
    padding: 2px 8px; border: 0.5px solid var(--border-light);
    border-radius: 999px; background: var(--bg-secondary);
    display: inline-flex; align-items: center; gap: 4px;
  }
  .fix-pill kbd {
    font: inherit; font-size: 9.5px; letter-spacing: 0.04em;
    padding: 0 3px; background: var(--bg-primary);
    border: 0.5px solid var(--border-light); border-radius: 3px;
    color: var(--text-secondary);
  }
```

**Step 3: Browser check.** Fix modal should now show three small pills under "Show the fixed state." They are purely decorative — the actual input paths (drop, paste, click) are already wired by Task 8, Task 9, and the existing file input.

**Step 4: Commit.**

```bash
git add fixer/index.html
git commit -m "feat(fixer): triple-hint pills for drop/paste/browse discoverability"
```

---

## Task 11: Fixer QA pass + fix anything that breaks

**Files:**
- Read-only pass against `fixer/index.html`.

**Step 1: Walk through the fixer verification plan** (design doc steps 10–14):

10. Open fix modal with clipboard image → banner appears → Paste attaches.
11. Open fix modal without clipboard image → no banner.
12. Drag a file anywhere on modal body → green overlay → drop → attached.
13. Drag over, then drag leave (without drop) → overlay dismissed cleanly, no flicker when dragging over child elements.
14. Cmd+V inside modal still attaches image (legacy listener at `fixer/index.html:~1578`).

**Step 2: JS parse sanity.**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('fixer/index.html','utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
try { new Function(m[1]); console.log('JS OK:', m[1].length); }
catch(e) { console.log('JS ERR:', e.message); process.exit(1); }
"
```

**Step 3: Log defects as new tasks** (`TaskCreate`) and fix separately with `fix(fixer): ...` commits.

---

## Task 12: Integration check + push

**Step 1: Run both parse checks** (reporter and fixer) as one-liner:

```bash
node -e "
const fs = require('fs');
for (const p of ['reporter/index.html','fixer/index.html']) {
  const html = fs.readFileSync(p,'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
  try { new Function(m[1]); console.log(p, 'OK', m[1].length); }
  catch(e) { console.log(p, 'ERR', e.message); process.exit(1); }
}
"
```

Expected: both `OK`.

**Step 2: End-to-end smoke test.**
1. Reporter submits a bug.
2. Fixer opens the bug in fixer page, drags an after-screenshot onto the modal body (not the zone), submits.
3. Reporter reloads dashboard → Verify inbox shows the card with before + after.
4. Reporter clicks ✓ Verify → toast + card gone → reload → bug appears in "Verified" view.
5. Repeat once with Reopen → bug returns to "Open" view.

**Step 3: Push.**

```bash
git log --oneline origin/main..HEAD
git push origin main
```

Expected: a clean sequence of feat commits, no `fix` commits on top of the feature commits (those should have been squashed into the feature commit they fix if caught before push; if caught after, keep as separate fix commits).

---

## Notes

- **Lightbox function.** If `openLightbox` is not the right name, use whatever pattern the rest of the file uses for `data-lightbox`. The thumbs in the verify inbox reuse that same attribute, so if existing click-delegation already handles `data-lightbox` globally, the Task 4 thumb-click branch can be removed.
- **`currentName`.** This is the logged-in reporter variable, used by the existing `bugRowHTML` for the "Tap to verify" hint. Grep to confirm the exact variable name.
- **Undo semantics.** If the user undoes within 6s, we issue a reversal Supabase update. This means the bug ends up back as `Fixed` server-side. A race is possible: if the user's first update is still in flight when they click Undo. The code path handles this by deferring the reversal until after the first `await` resolves.
- **No realtime.** Another user in another tab won't see the strip update until they reload. Explicitly out of scope per the design doc.

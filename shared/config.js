/* ============================================
   Bug-Tracker — Supabase Client & Shared Config
   ============================================ */

const SUPABASE_URL = 'https://vzonandspicspfjjatjm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6b25hbmRzcGljc3BmamphdGptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1NDY4OTMsImV4cCI6MjA5MTEyMjg5M30.A_CtpuJQ4pJTOlYIP6hMDp3eHiQqjNP8M24NNhLLXqQ';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---- Helpers ---- */

function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleString('en-GB', { month: 'short' });
  return `${day} ${month}`;
}

function esc(s) {
  const el = document.createElement('div');
  el.textContent = s;
  return el.innerHTML;
}

/* ---- Constants ---- */

const MODULES = {
  Finance: [
    'Invoice', 'COA', 'Journal', 'AR Aging', 'AP Aging',
    'Bank Recon', 'Petty Cash', 'Debit Note', 'Credit Note', 'Credit Limit'
  ],
  Operations: [
    'Inventory', 'Purchase', 'Sales'
  ],
  Other: [
    'HR', 'Settings', 'Dashboard', 'Auth'
  ]
};

const STATUS_COLORS = {
  'Open':        { dot: '#FF3B30', bg: '#FFF0EF' },
  'In Progress': { dot: '#FF9500', bg: '#FFF8EE' },
  'Fixed':       { dot: '#007AFF', bg: '#EEF4FF' },
  'Verified':    { dot: '#34C759', bg: '#EEFBF3' },
  'Closed':      { dot: '#8E8E93', bg: '#F2F2F7' }
};

const SEVERITY_COLORS = {
  Critical: '#FF3B30',
  High:     '#FF9500',
  Medium:   '#FFCC00',
  Low:      '#8E8E93'
};

const REPORTERS = ['Richie', 'Darren', 'Raymond'];

/* ---- Toast ---- */

function showToast(message, isError = false) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

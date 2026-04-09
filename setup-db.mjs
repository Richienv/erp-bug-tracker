import postgres from 'postgres';

// Session-mode pooler (port 5432)
const sql = postgres('postgresql://postgres.vzonandspicspfjjatjm:%23erpbug0811@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres', {
  ssl: 'require',
  connect_timeout: 10,
  connection: { application_name: 'bug-tracker-setup' }
});

const statements = [
  // Bugs table
  `create table if not exists bugs (
    id uuid primary key default gen_random_uuid(),
    bug_id text unique not null default '',
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
  )`,

  // Sequence for bug_id
  `create sequence if not exists bug_id_seq start 1`,

  // Function to auto-generate bug_id
  `create or replace function set_bug_id()
   returns trigger as $$
   begin
     new.bug_id := 'ERP-' || lpad(nextval('bug_id_seq')::text, 3, '0');
     return new;
   end;
   $$ language plpgsql`,

  // Trigger for bug_id
  `drop trigger if exists bug_id_trigger on bugs`,
  `create trigger bug_id_trigger
     before insert on bugs
     for each row execute function set_bug_id()`,

  // Function to auto-update updated_at
  `create or replace function update_updated_at()
   returns trigger as $$
   begin
     new.updated_at := now();
     return new;
   end;
   $$ language plpgsql`,

  // Trigger for updated_at
  `drop trigger if exists updated_at_trigger on bugs`,
  `create trigger updated_at_trigger
     before update on bugs
     for each row execute function update_updated_at()`,

  // Indexes
  `create index if not exists idx_bugs_status on bugs(status)`,
  `create index if not exists idx_bugs_reporter on bugs(reporter)`,

  // Disable RLS
  `alter table bugs disable row level security`,

  // Enable realtime
  `alter publication supabase_realtime add table bugs`,

  // Storage bucket
  `insert into storage.buckets (id, name, public)
   values ('screenshots', 'screenshots', true)
   on conflict (id) do nothing`,

  // Storage policies
  `create policy if not exists "Allow public uploads"
     on storage.objects for insert
     with check (bucket_id = 'screenshots')`,

  `create policy if not exists "Allow public reads"
     on storage.objects for select
     using (bucket_id = 'screenshots')`,

  `create policy if not exists "Allow public deletes"
     on storage.objects for delete
     using (bucket_id = 'screenshots')`,

  // pr_url column for auto-fix daemon
  `ALTER TABLE bugs ADD COLUMN IF NOT EXISTS pr_url text`,
];

console.log('Setting up Supabase database...\n');

for (const stmt of statements) {
  const label = stmt.trim().split('\n')[0].slice(0, 60);
  try {
    await sql.unsafe(stmt);
    console.log(`  OK: ${label}`);
  } catch (e) {
    // Some statements may fail if already exist, that's fine
    if (e.message?.includes('already exists') || e.message?.includes('duplicate')) {
      console.log(`  SKIP (exists): ${label}`);
    } else {
      console.log(`  WARN: ${label}`);
      console.log(`        ${e.message}`);
    }
  }
}

// Test: insert and read back
console.log('\nTesting insert...');
const [row] = await sql`insert into bugs (title, module, reporter) values ('Test bug', 'Finance / Invoice', 'Richie') returning bug_id, title, status`;
console.log(`  Inserted: ${row.bug_id} — "${row.title}" [${row.status}]`);

// Clean up test
await sql`delete from bugs where bug_id = ${row.bug_id}`;
console.log(`  Cleaned up test row`);

console.log('\nDatabase setup complete!');
await sql.end();

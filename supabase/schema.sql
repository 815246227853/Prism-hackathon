-- Prism database schema. Run once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: everything uses "if not exists" / "or replace".

create extension if not exists vector;

create table if not exists studies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  objective text not null,
  audience text,
  questions jsonb not null default '[]'::jsonb,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists interviews (
  id uuid primary key default gen_random_uuid(),
  participant_name text,
  conversation_id text not null,
  transcript text not null default '',
  analysis jsonb,
  study_id uuid references studies(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Knowledge-base chunks for RAG (OpenAI text-embedding-3-small = 1536 dims).
create table if not exists doc_chunks (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  embedding vector(1536) not null,
  study_id uuid references studies(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Top-k similar chunks, optionally limited to one study.
create or replace function match_chunks(
  query_embedding vector(1536),
  match_count int default 3,
  filter_study_id uuid default null
)
returns table (content text, similarity float)
language sql stable
as $$
  select c.content, 1 - (c.embedding <=> query_embedding) as similarity
  from doc_chunks c
  where filter_study_id is null or c.study_id = filter_study_id
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- The app connects with the secret key (server-side only), which bypasses RLS.
-- Enable RLS with no policies so the public/publishable key can't read data.
alter table studies enable row level security;
alter table interviews enable row level security;
alter table doc_chunks enable row level security;

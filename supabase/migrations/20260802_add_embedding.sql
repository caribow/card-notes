create extension if not exists vector;
alter table public.notes add column if not exists embedding vector(1536);
create index if not exists notes_embedding_idx on public.notes using ivfflat (embedding vector_cosine_ops) with (lists = 100);

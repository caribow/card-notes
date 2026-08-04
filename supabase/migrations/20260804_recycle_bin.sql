-- 回收站：软删除
-- 删除 = update deleted_at；回收站内彻底删除 = delete
alter table public.notes add column if not exists deleted_at timestamptz default null;
create index if not exists notes_deleted_at_idx on public.notes (deleted_at) where deleted_at is not null;

-- 语义近邻排除已删除笔记
create or replace function public.note_neighbors(p_note_id bigint, p_limit int default 5)
returns table (
  id bigint, text text, tags text[], imgs text[],
  recorded_on date, pinned_at timestamptz,
  created_at timestamptz, updated_at timestamptz,
  similarity float
)
language sql stable security invoker set search_path = 'public'
as $$
  select n.id, n.text, n.tags, n.imgs, n.recorded_on, n.pinned_at,
         n.created_at, n.updated_at,
         1 - (n.embedding <=> src.embedding) as similarity
  from public.notes n
  cross join (select embedding from public.notes where id = p_note_id) src
  where n.id <> p_note_id
    and n.embedding is not null
    and src.embedding is not null
    and n.deleted_at is null
  order by n.embedding <=> src.embedding
  limit least(greatest(p_limit, 1), 20)
$$;

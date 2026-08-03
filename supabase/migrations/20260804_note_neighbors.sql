-- 笔记语义近邻：洞察页与随机漫步共用
-- SECURITY INVOKER：调用者仍需通过 notes 的 RLS（owner 校验），函数本身不放大权限
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
  order by n.embedding <=> src.embedding
  limit least(greatest(p_limit, 1), 20)
$$;

grant execute on function public.note_neighbors(bigint, int) to authenticated;

-- 修复「编辑保存误报在其他设备修改」
-- 根因：set_card_note_updated_at 是 BEFORE UPDATE 无列过滤，
-- embed-note 回写 embedding 列也会刷新 updated_at，导致前端乐观锁
-- (.eq('updated_at', 旧值)) 在下次保存时匹配 0 行误报冲突。
-- 修复：仅在内容相关列真实变化时才刷新 updated_at；
-- embedding 回写（只改 embedding 列）不再触碰 updated_at。
create or replace function public.set_card_note_updated_at()
returns trigger
language plpgsql
set search_path = 'pg_catalog', 'public'
as $$
begin
  if new.text is not distinct from old.text
     and new.tags is not distinct from old.tags
     and new.imgs is not distinct from old.imgs
     and new.recorded_on is not distinct from old.recorded_on
     and new.pinned_at is not distinct from old.pinned_at
     and new.deleted_at is not distinct from old.deleted_at then
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- 修复「编辑保存误报在其他设备修改」
-- 根因：set_card_note_updated_at 是 BEFORE UPDATE 无列过滤，
-- embed-note 回写 embedding 列也会刷新 updated_at，导致前端乐观锁
-- (.eq('updated_at', 旧值)) 在下次保存时匹配 0 行误报冲突。
-- 修复：仅当用户可编辑业务字段整行真变化时才推进 updated_at；
-- embedding（后台派生）回写不推进版本，并防止调用方伪造 updated_at。
-- 维护要求：新增用户可编辑业务列时加入比较组；新增纯派生列不加入。
create or replace function public.set_card_note_updated_at()
returns trigger
language plpgsql
set search_path = 'pg_catalog', 'public'
as $$
begin
  if row(new.id,new.text,new.tags,new.imgs,new.created_at,new.owner_id,new.recorded_on,new.pinned_at,new.deleted_at)
     is distinct from
     row(old.id,old.text,old.tags,old.imgs,old.created_at,old.owner_id,old.recorded_on,old.pinned_at,old.deleted_at)
  then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

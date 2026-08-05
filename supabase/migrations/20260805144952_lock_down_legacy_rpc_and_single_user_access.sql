-- Security hardening for the single-user FlashNote deployment.
-- The old Fanfou importer was a SECURITY DEFINER RPC executable by anon;
-- it is no longer used and must not remain reachable from PostgREST.
begin;

drop function if exists public.import_fanfou(text, uuid);

-- Trigger functions are invoked by PostgreSQL triggers, not by API clients.
revoke all on function private.trigger_embed_note() from public, anon, authenticated;

-- Keep the semantic-neighbor RPC available only to authenticated users.
revoke all on function public.note_neighbors(bigint, integer, double precision)
  from public, anon;
grant execute on function public.note_neighbors(bigint, integer, double precision)
  to authenticated;

-- api_keys is server-only. RLS already denies access; remove table grants too.
revoke all on table public.api_keys from public, anon, authenticated;

-- map_cache is also part of this single-user app. Require both the owner row
-- and the private deployment allowlist, matching the notes/storage boundary.
drop policy if exists map_cache_select on public.map_cache;
drop policy if exists map_cache_insert on public.map_cache;
drop policy if exists map_cache_update on public.map_cache;
drop policy if exists map_cache_delete on public.map_cache;

create policy map_cache_select on public.map_cache
  for select to authenticated
  using (private.is_card_notes_owner() and auth.uid() = owner_id);

create policy map_cache_insert on public.map_cache
  for insert to authenticated
  with check (private.is_card_notes_owner() and auth.uid() = owner_id);

create policy map_cache_update on public.map_cache
  for update to authenticated
  using (private.is_card_notes_owner() and auth.uid() = owner_id)
  with check (private.is_card_notes_owner() and auth.uid() = owner_id);

create policy map_cache_delete on public.map_cache
  for delete to authenticated
  using (private.is_card_notes_owner() and auth.uid() = owner_id);

commit;
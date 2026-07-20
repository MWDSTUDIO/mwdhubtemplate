-- ═══════════════════════════════════════════════════════════════════
-- Server-side helpers callable through PostgREST RPC.
-- ═══════════════════════════════════════════════════════════════════

-- Verify a room code (teamwork shared code, or Estelle's vault code).
-- Security definer: reads access_codes, which no RLS policy exposes.
-- Eligibility is checked first — the right code from the wrong person
-- opens nothing.
create or replace function public.verify_code(p_scope text, p_code text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  ok boolean := false;
begin
  if p_scope = 'teamwork' then
    if not app.is_teamwork() then return false; end if;
    select exists (
      select 1 from access_codes
      where scope = 'teamwork' and code_hash = crypt(p_code, code_hash)
    ) into ok;
  elsif p_scope = 'vault' then
    if not app.is_principal() then return false; end if;
    select exists (
      select 1 from access_codes
      where scope = 'vault' and profile_id = auth.uid()
        and code_hash = crypt(p_code, code_hash)
    ) into ok;
  end if;
  return ok;
end $$;

grant execute on function public.verify_code(text, text) to authenticated;

-- Publish every draft budget line of a wedding in one word (team only —
-- RLS on budget_lines already enforces it, the function keeps invoker rights).
create or replace function public.publish_budget(p_wedding uuid)
returns int
language plpgsql as $$
declare
  n int;
begin
  update budget_lines set status = 'published'
  where wedding_id = p_wedding and status = 'draft';
  get diagnostics n = row_count;
  update envelope_notes set status = 'published'
  where wedding_id = p_wedding and status = 'draft';
  return n;
end $$;

grant execute on function public.publish_budget(uuid) to authenticated;

-- Publish the timeline drafts (milestones + monthly notes) of a wedding.
create or replace function public.publish_timeline(p_wedding uuid)
returns int
language plpgsql as $$
declare
  n int;
begin
  update timeline_milestones set status = 'published'
  where wedding_id = p_wedding and status = 'draft';
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.publish_timeline(uuid) to authenticated;


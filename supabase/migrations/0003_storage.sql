-- ═══════════════════════════════════════════════════════════════════
-- Storage buckets. Object paths are prefixed by wedding id:
--   shared/<wedding_id>/…      client-visible files (board covers, proofs)
--   internal/<wedding_id>/…    team-only files
--   vault/…                    Estelle alone
--   entrance/<wedding_id>/…    entrance media (read by wedding members)
-- ═══════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public) values
  ('shared', 'shared', false),
  ('internal', 'internal', false),
  ('vault', 'vault', false),
  ('entrance', 'entrance', false)
on conflict (id) do nothing;

create policy "team all shared" on storage.objects
  for all using (bucket_id = 'shared' and app.is_team())
  with check (bucket_id = 'shared' and app.is_team());

create policy "couple reads own shared" on storage.objects
  for select using (
    bucket_id = 'shared'
    and app.couple_of(((storage.foldername(name))[1])::uuid)
  );

create policy "team all internal" on storage.objects
  for all using (bucket_id = 'internal' and app.is_team())
  with check (bucket_id = 'internal' and app.is_team());

create policy "principal all vault" on storage.objects
  for all using (bucket_id = 'vault' and app.is_principal())
  with check (bucket_id = 'vault' and app.is_principal());

create policy "team all entrance" on storage.objects
  for all using (bucket_id = 'entrance' and app.is_team())
  with check (bucket_id = 'entrance' and app.is_team());

create policy "members read entrance" on storage.objects
  for select using (
    bucket_id = 'entrance'
    and (
      app.couple_of(((storage.foldername(name))[1])::uuid)
      or app.coordinator_of(((storage.foldername(name))[1])::uuid)
    )
  );

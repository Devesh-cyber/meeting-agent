-- =====================================================================
-- Run ONLY when you merge phase1 into main (after judging is over).
-- Removes the hackathon tables and the old public recordings access.
-- The Phase 1 tables (profiles, categories, entries, items,
-- entry_decisions, push_subscriptions) are not touched.
-- =====================================================================
drop table if exists public.action_items cascade;
drop table if exists public.decisions cascade;
drop table if exists public.meetings cascade;
drop table if exists public.people cascade;

drop policy if exists "anon upload recordings" on storage.objects;
update storage.buckets set public = false where id = 'recordings';
-- Then in the dashboard: Storage → recordings → ⋯ → Empty bucket, then Delete bucket.

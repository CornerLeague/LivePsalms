-- supabase/migrations/034_lamplight_chat_threads_surface.sql
-- Study reuses lamplight_chat_threads but must not intermix with journaling
-- Bible-chat history. Add a `surface` marker and widen the active-passage
-- unique index so a passage can have one active 'chat' thread AND one active
-- 'study' thread.

alter table public.lamplight_chat_threads
  add column surface text not null default 'chat'
  check (surface in ('chat', 'study'));

drop index if exists lamplight_chat_threads_active_passage;

create unique index lamplight_chat_threads_active_passage
  on public.lamplight_chat_threads (user_id, passage_ref, surface)
  where archived = false;

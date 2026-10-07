-- The project does not expose new tables automatically, so the server role used by the
-- notification job (SUPABASE_SECRET_KEY) needs explicit privileges. Least privilege: only
-- what /api/cron/notify and the unsubscribe link do. Run once after 202610060001_notifications.sql.
grant select on table public.watch_states to service_role;
grant select, update on table public.notification_prefs to service_role;
grant select, delete on table public.push_subscriptions to service_role;
grant select, insert, delete on table public.notification_log to service_role;
grant select, insert, update on table public.catalog_links to service_role;
grant select, insert, update on table public.cron_state to service_role;

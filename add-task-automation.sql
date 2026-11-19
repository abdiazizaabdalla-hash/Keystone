-- Task-driven automation: an automation can watch one checklist step ("when Inspection scheduling is completed..."),
-- so it needs to remember which step. Additive and safe to run more than once; existing automations are untouched.
alter table public.automation_templates add column if not exists trigger_task text;
alter table public.automation_instances add column if not exists trigger_task text;

notify pgrst, 'reload schema';

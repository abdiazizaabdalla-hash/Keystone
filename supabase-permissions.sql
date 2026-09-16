-- Grant permissions to service_role for all tables
-- Run this in Supabase SQL Editor to fix "permission denied" errors

GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO service_role;

-- Verify permissions were granted
-- SELECT * FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = 'service_role';

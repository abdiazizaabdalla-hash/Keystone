-- Migration: Add flat_fee column to agents table
-- This migration adds support for flat fees per closing in addition to percentage-based fees

-- Add flat_fee column to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS flat_fee DECIMAL(12,2) DEFAULT 0;

-- Update RLS policies for agents to allow UPDATE on flat_fee
CREATE POLICY "TC can update their own agents"
  ON agents FOR UPDATE
  USING (tc_user_id = auth.uid())
  WITH CHECK (tc_user_id = auth.uid());

-- Update RLS policies for agents to allow DELETE on flat_fee
CREATE POLICY "TC can delete their own agents"
  ON agents FOR DELETE
  USING (tc_user_id = auth.uid());

-- Create index on flat_fee for faster queries
CREATE INDEX IF NOT EXISTS idx_agents_flat_fee ON agents(flat_fee);

-- Grant permissions for service role if not already granted
GRANT SELECT, INSERT, UPDATE, DELETE ON agents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON transactions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO service_role;

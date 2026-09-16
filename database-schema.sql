-- Users table (TCs and Agents)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('TC', 'Agent')),
  password_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agents table (managed by TC)
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tc_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  brokerage VARCHAR(255),
  commission_percent DECIMAL(5,2) NOT NULL DEFAULT 25,
  email VARCHAR(255),
  phone VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table (deals)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  file_number VARCHAR(255) NOT NULL,
  property_address VARCHAR(500),
  purchase_price DECIMAL(12,2),
  status VARCHAR(100) DEFAULT 'Contract Pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tasks table (checklist items)
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Invoices table
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  amount_owed DECIMAL(12,2) NOT NULL,
  invoice_number VARCHAR(100) NOT NULL UNIQUE,
  invoice_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  due_date DATE NOT NULL,
  paid BOOLEAN DEFAULT FALSE,
  paid_at TIMESTAMP,
  paid_amount DECIMAL(12,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_agents_tc_user_id ON agents(tc_user_id);
CREATE INDEX idx_transactions_agent_id ON transactions(agent_id);
CREATE INDEX idx_tasks_transaction_id ON tasks(transaction_id);
CREATE INDEX idx_invoices_agent_id ON invoices(agent_id);
CREATE INDEX idx_invoices_paid ON invoices(paid);

-- Enable RLS (Row Level Security)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- RLS Policies for agents (TC only sees their own agents)
CREATE POLICY "TC can see their own agents"
  ON agents FOR SELECT
  USING (tc_user_id = auth.uid());

CREATE POLICY "TC can insert their own agents"
  ON agents FOR INSERT
  WITH CHECK (tc_user_id = auth.uid());

-- RLS Policies for transactions
CREATE POLICY "TC can see agent transactions"
  ON transactions FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM agents WHERE tc_user_id = auth.uid()
    )
  );

CREATE POLICY "TC can insert transactions"
  ON transactions FOR INSERT
  WITH CHECK (
    agent_id IN (
      SELECT id FROM agents WHERE tc_user_id = auth.uid()
    )
  );

-- RLS Policies for tasks
CREATE POLICY "TC can see agent tasks"
  ON tasks FOR SELECT
  USING (
    transaction_id IN (
      SELECT t.id FROM transactions t
      JOIN agents a ON t.agent_id = a.id
      WHERE a.tc_user_id = auth.uid()
    )
  );

-- RLS Policies for invoices
CREATE POLICY "TC can see agent invoices"
  ON invoices FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM agents WHERE tc_user_id = auth.uid()
    )
  );

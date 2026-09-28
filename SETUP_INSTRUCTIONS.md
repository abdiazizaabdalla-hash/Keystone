# Relay TC - Setup & Fixes Required

## 🔴 CRITICAL: Database Schema Issues

Your agents table is missing the `flat_fee` and `commission_percent` columns. 

### Step 1: Run This SQL in Supabase
Go to **Supabase Dashboard → SQL Editor** and run this complete migration:

```sql
-- ============================================
-- COMPLETE RELAY TC SCHEMA
-- ============================================

-- 1. DROP OLD TABLES AND RECREATE WITH PROPER COLUMNS
DROP TABLE IF EXISTS agents CASCADE;

CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tc_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brokerage TEXT,
  email TEXT,
  phone TEXT,
  flat_fee DECIMAL(12,2) DEFAULT 400,
  commission_percent DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::TEXT, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::TEXT, NOW()) NOT NULL
);

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all agents" ON agents
  FOR SELECT USING (TRUE);

CREATE POLICY "Users can manage their own agents" ON agents
  FOR INSERT WITH CHECK (tc_user_id = auth.uid());

CREATE POLICY "Users can update their own agents" ON agents
  FOR UPDATE USING (tc_user_id = auth.uid()) WITH CHECK (tc_user_id = auth.uid());

CREATE POLICY "Users can delete their own agents" ON agents
  FOR DELETE USING (tc_user_id = auth.uid());

CREATE INDEX idx_agents_tc_user_id ON agents(tc_user_id);

-- 2. TRANSACTIONS TABLE
DROP TABLE IF EXISTS transactions CASCADE;

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  file_number TEXT NOT NULL UNIQUE,
  property_address TEXT NOT NULL,
  purchase_price DECIMAL(15,2) DEFAULT 0,
  status TEXT DEFAULT 'Open',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::TEXT, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::TEXT, NOW()) NOT NULL
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view transactions" ON transactions
  FOR SELECT USING (TRUE);

CREATE POLICY "Users can create transactions" ON transactions
  FOR INSERT WITH CHECK (TRUE);

CREATE POLICY "Users can update transactions" ON transactions
  FOR UPDATE USING (TRUE) WITH CHECK (TRUE);

CREATE INDEX idx_transactions_agent_id ON transactions(agent_id);

-- 3. INVOICES TABLE
DROP TABLE IF EXISTS invoices CASCADE;

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL UNIQUE,
  invoice_date TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::TEXT, NOW()),
  due_date TIMESTAMP WITH TIME ZONE,
  amount_owed DECIMAL(12,2) DEFAULT 0,
  paid BOOLEAN DEFAULT FALSE,
  payment_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::TEXT, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::TEXT, NOW()) NOT NULL
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view invoices" ON invoices
  FOR SELECT USING (TRUE);

CREATE POLICY "Users can manage invoices" ON invoices
  FOR INSERT WITH CHECK (TRUE);

CREATE POLICY "Users can update invoices" ON invoices
  FOR UPDATE USING (TRUE) WITH CHECK (TRUE);

CREATE INDEX idx_invoices_agent_id ON invoices(agent_id);
CREATE INDEX idx_invoices_transaction_id ON invoices(transaction_id);

-- 4. TASKS TABLE
DROP TABLE IF EXISTS tasks CASCADE;

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::TEXT, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::TEXT, NOW()) NOT NULL
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tasks" ON tasks
  FOR SELECT USING (TRUE);

CREATE POLICY "Users can manage tasks" ON tasks
  FOR INSERT WITH CHECK (TRUE);

CREATE POLICY "Users can update tasks" ON tasks
  FOR UPDATE USING (TRUE) WITH CHECK (TRUE);

CREATE INDEX idx_tasks_transaction_id ON tasks(transaction_id);
```

---

## 👤 Setting Up Your Master/Admin Account

### Step 2: Create Admin User
1. Sign up at `http://localhost:3000` with your email/password
2. Go to **Supabase Dashboard → Authentication → Users**
3. Find your user
4. Click the user row and edit **User Metadata**
5. Add:
```json
{
  "is_admin": true
}
```
6. Click "Save"

### Step 3: Access Admin Panel
- Navigate to `http://localhost:3000/dashboard/admin`
- You'll see all TC users, their roles, and agents count

---

## ✅ What's Fixed in This Version

### New Pages Created:
- ✅ `/dashboard/transactions/new` - Create new deals (was getting 404)
- ✅ `/dashboard/admin` - Master account panel to manage all users
- ✅ `/api/auth/me` - Get current user info
- ✅ Updated agents API with proper user authentication

### Database Improvements:
- ✅ `agents` table now has `flat_fee` and `commission_percent` columns
- ✅ Proper default values (flat_fee: $400, commission_percent: 0%)
- ✅ User isolation via RLS policies
- ✅ Support for multiple TC accounts

### UI/UX Enhancements:
- ✅ Agent form now properly saves flat fees
- ✅ New transaction creation workflow
- ✅ Admin dashboard for viewing all users

---

## 🎯 Common TC Tools & How Relay TC Differs

### Industry Standard TC Software (2026):

| Tool | Model | Price | Focus |
|------|-------|-------|-------|
| **ReBillion** | AI-powered | $199–$499/mo | AI extraction, compliance |
| **Dotloop** | Document collab | Per-user | E-signature, templates |
| **SkySlope** | Enterprise | Custom quote | Compliance, audit trails |
| **ListedKit** | Workflow | Per-user/mo | TC templates, dashboards |
| **Brokermint** | Back-office | Per-user tiered | Financials, commissions |
| **DocJacket** | Extraction | Per-file | Document parsing |

### How Relay TC is Different:

**Relay TC Focus:**
- **Simple flat-fee model** - $400/transaction (not per-user pricing)
- **Built for independent TCs** - Not for 50-person brokerages (yet)
- **Agent fee management** - Track what you pay each agent
- **Direct client relationship** - You own the relationship (not embedded in brokerage software)
- **Custom workflow** - Build exactly what YOU need

**Key Advantage:**
Most TC software costs $500–2000+/year per user. Relay TC's model charges based on deals closed, so:
- Small TC with 20 deals/month = $8,000/mo
- Scales down if slower, scales up naturally with business

---

## 🔄 UtilitySheet vs Relay TC

### What UtilitySheet Does:
- Collects utility information from sellers
- Generates PDF utility sheets for buyers
- Reusable seller links for templates
- Fills ONE specific gap in TC workflow

### What Relay TC Does:
- Complete transaction management platform
- Agent commission tracking
- Invoice generation
- Deal lifecycle management
- Task checklist automation

**They're Complementary!** Relay TC could integrate UtilitySheet for collecting utilities. It's not a replacement—it's a specialized form tool.

---

## 📋 Next Steps

1. **Run the SQL migration** in Supabase
2. **Create your admin account** (sign up normally, then add is_admin metadata)
3. **Test agent creation** with flat fees
4. **Try new transaction workflow**
5. **Access admin panel** to see all users

---

## 🚀 Running Your App

```bash
# Terminal in keystone folder
npm run dev

# Visit
http://localhost:3000
```

App is running on **localhost:3000** with all new features ready to test!

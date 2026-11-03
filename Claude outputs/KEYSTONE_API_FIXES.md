# Keystone TC - API Authentication & Authorization Fixes

## Summary of Changes

All API routes have been updated to properly authenticate users and implement admin bypass functionality.

### Key Improvements

#### 1. **Agents API** (`/api/agents/route.ts`)
- ✅ GET: Authenticated users see only their agents; admins see all agents
- ✅ POST: Uses authenticated user's `user.id` instead of hardcoded placeholder
- ✅ PATCH: Only allows users to modify their own agents
- ✅ DELETE: Only allows users to delete their own agents
- ✅ All endpoints require valid Bearer token in Authorization header

#### 2. **Transactions API** (`/api/transactions/route.ts`)
- ✅ GET: Authenticated users see only transactions for their agents; admins see all
- ✅ POST: Verifies agent belongs to user before creating transaction
- ✅ Auto-creates 6 standard tasks per transaction (Pre-Inspection, Inspection, Appraisal, Underwriting, Funding, Closing)
- ✅ All endpoints require valid Bearer token

#### 3. **Invoices API** (`/api/invoices/route.ts`)
- ✅ GET: Authenticated users see only invoices for their agents; admins see all
- ✅ POST: Verifies agent belongs to user before creating invoice
- ✅ Auto-calculates fee: `flat_fee + (purchase_price * commission_percent / 100)`
- ✅ Auto-generates invoice numbers: `KEYSTN-YYYYMMDD-XXXXX`
- ✅ PATCH: Only allows users to update invoices for their agents
- ✅ All endpoints require valid Bearer token

#### 4. **Tasks API** (`/api/tasks/route.ts`)
- ✅ GET: Authenticated users see only tasks for their transactions; admins see all
- ✅ PATCH: Only allows users to toggle tasks for their transactions
- ✅ All endpoints require valid Bearer token

### Authentication Flow

1. **Frontend sends Bearer token** in Authorization header:
   ```
   Authorization: Bearer <access_token>
   ```

2. **Backend extracts token** and validates:
   ```typescript
   const authHeader = request.headers.get('authorization');
   const token = authHeader.slice(7); // Remove "Bearer "
   const { data: { user } } = await supabaseServer.auth.getUser(token);
   ```

3. **Admin bypass check**:
   ```typescript
   const { data: userData } = await supabaseServer.auth.admin.getUserById(user.id);
   const isAdmin = userData?.user_metadata?.is_admin === true;
   ```

### Setting Up Master Admin Account

To give your account full access to all data:

1. Go to Supabase dashboard → Authentication → Users
2. Find your user account
3. Click the user → "User Details" 
4. Edit User Metadata (JSON) and add:
   ```json
   {
     "is_admin": true
   }
   ```
5. Save changes

Now when you log in, you'll have:
- Access to all agents (not just yours)
- Access to all transactions
- Access to all invoices
- Full access to `/dashboard/admin` page

### Testing the Complete Flow

1. **Sign up/Login**:
   - Navigate to `/auth`
   - Create an account or login
   - Token is stored in localStorage as `auth_token`

2. **Create Agents**:
   - Go to `/dashboard/agents`
   - Add agent with name, brokerage, email, phone, flat fee ($400 default), commission %
   - Verify agent appears in list

3. **Create Transaction**:
   - Go to `/dashboard/transactions`
   - Click "New Transaction"
   - Select agent, enter file number, property address, purchase price
   - Verify 6 tasks are auto-created

4. **View Transactions**:
   - Back in Transactions page
   - Should see the transaction you just created
   - See associated tasks

5. **Create Invoice**:
   - Go to `/dashboard/invoices`
   - Create invoice from a transaction
   - Verify fee calculation: `$400 (flat) + (purchase_price * commission%) = total`
   - Verify invoice number format: `KEYSTN-YYYYMMDD-00001`

6. **Admin Panel** (if is_admin=true):
   - Go to `/dashboard/admin`
   - Should see all TC users and their data
   - Can view/manage all agents, transactions, invoices

### Frontend Updates Needed

Make sure all API calls from the frontend include the auth token:

```typescript
const token = localStorage.getItem('auth_token');
const response = await fetch('/api/agents', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

### Default Values

- **Flat Fee**: $400 (if not specified)
- **Commission %**: 0% (if not specified)
- **Transaction Status**: "Contract Pending"
- **Invoice Due Date**: 30 days from creation
- **Auto-Created Tasks**: Pre-Inspection, Inspection, Appraisal, Underwriting, Funding, Closing

### Error Codes

- **401 Unauthorized**: Missing or invalid token
- **403 Forbidden**: User trying to access data that doesn't belong to them
- **400 Bad Request**: Missing required fields (agentId, transactionId, etc.)
- **404 Not Found**: Resource doesn't exist
- **500 Internal Server Error**: Database or unexpected error

### Next Steps

1. Push these API files to your project
2. Make sure frontend pages are sending Authorization headers on all API calls
3. Set up your master admin account via Supabase user metadata
4. Test the complete flow: Auth → Agents → Transactions → Invoices
5. Verify admin account can see all data across all users

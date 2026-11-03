# Keystone TC - Frontend Authentication TODO

All frontend pages making API calls must include the auth token in the Authorization header.

## ✅ Fixed Pages

- [x] `/dashboard/agents/page.tsx` - Now includes `Authorization: Bearer ${token}` on all API calls (GET, POST, PATCH, DELETE)

## 🔴 Pages That Still Need Fixes

### Critical - Currently Won't Work

These pages need to be updated to send auth tokens on all API calls:

1. **`/transactions/page.tsx`** (List transactions)
   - [ ] GET /api/transactions - needs Authorization header
   - [ ] Should fetch token from localStorage
   
2. **`/transactions/[id]/page.tsx`** (View single transaction)
   - [ ] GET /api/transactions/[id] - needs Authorization header
   - [ ] PATCH for updating transaction status
   - [ ] GET /api/tasks?transactionId={id} - needs Authorization header

3. **`/transactions/new/page.tsx`** (Create new transaction)
   - [ ] POST /api/transactions - needs Authorization header
   - [ ] GET /api/agents - needs Authorization header (for agent dropdown)

4. **`/invoices/page.tsx`** (List invoices)
   - [ ] GET /api/invoices - needs Authorization header
   - [ ] GET /api/invoices?paid=true/false - needs Authorization header
   - [ ] GET /api/invoices?agentId={id} - needs Authorization header
   - [ ] POST /api/invoices - needs Authorization header (create new invoice)
   - [ ] PATCH /api/invoices - needs Authorization header (mark as paid)

5. **`/invoices/[id]/page.tsx`** (View single invoice)
   - [ ] GET /api/invoices/[id] - needs Authorization header
   - [ ] PATCH for updating payment status

6. **`/dashboard/page.tsx`** (Main dashboard)
   - [ ] Fetch stats from API - needs Authorization header
   - [ ] GET /api/agents/stats or similar
   - [ ] GET /api/transactions/stats or similar

7. **`/dashboard/admin/page.tsx`** (Admin panel - if it exists)
   - [ ] GET /api/users or similar (for fetching all users)
   - [ ] Needs Authorization header

## How to Fix Each Page

### Template for fetch() calls:

```typescript
// Before (WRONG - will get 401 Unauthorized)
const response = await fetch('/api/agents', {
  method: 'GET',
  headers: { 'Content-Type': 'application/json' }
});

// After (CORRECT - includes auth token)
const token = localStorage.getItem('auth_token');
if (!token) {
  console.error('No auth token found');
  return;
}

const response = await fetch('/api/agents', {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  }
});

// Handle 401 responses
if (response.status === 401) {
  // Token is invalid/expired, redirect to login
  window.location.href = '/auth';
}
```

## Helper Function to Add to Each Page

Consider creating a reusable fetch wrapper:

```typescript
// lib/api.ts
export async function apiFetch(
  url: string,
  options: RequestInit = {}
) {
  const token = localStorage.getItem('auth_token');
  if (!token) {
    window.location.href = '/auth';
    throw new Error('No auth token found');
  }

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
    'Authorization': `Bearer ${token}`,
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    // Token invalid/expired
    localStorage.removeItem('auth_token');
    window.location.href = '/auth';
  }

  return response;
}

// Usage in pages:
const response = await apiFetch('/api/agents', {
  method: 'GET'
});
```

## Testing Checklist

Once all pages are updated:

1. [ ] Sign up / Login (should get auth_token in localStorage)
2. [ ] Navigate to Agents page - should see your agents
3. [ ] Add agent with $400 flat fee and 5% commission
4. [ ] Navigate to Transactions page - should load (empty if no transactions)
5. [ ] Create new transaction:
   - Select agent
   - Enter file number (e.g., "TEST-001")
   - Enter property address
   - Enter purchase price ($500,000)
   - Should create transaction + 6 auto tasks
6. [ ] View transaction - should see details + tasks
7. [ ] Create invoice from transaction
   - Should calculate: $400 + ($500,000 × 5%) = $25,400
   - Should generate invoice number: KEYSTN-YYYYMMDD-00001
8. [ ] Mark invoice as paid
9. [ ] Admin test (if is_admin=true in Supabase):
   - Login with admin account
   - Visit /dashboard/admin
   - Should see all TC users and their agents/transactions
10. [ ] Regular user can't see other users' data
    - Login as User A
    - Should only see User A's agents/transactions
    - Should NOT see User B's data

## API Error Responses to Handle

- **401 Unauthorized**: Token missing/invalid → redirect to /auth
- **403 Forbidden**: User doesn't have permission → show error message
- **400 Bad Request**: Missing required fields → show validation error
- **404 Not Found**: Resource doesn't exist → show not found message
- **500 Server Error**: Database error → show generic error message

## Authorization Examples

- User can see only their own agents
- User can see only transactions for their agents
- User can see only invoices for their agents
- Admin (is_admin=true) can see everything
- Admin (is_admin=true) can see `/dashboard/admin` page

// Runs the assistant's runner once against your local app (npm run dev:local must be running on port 3000).
// Usage: npm run automation:tick            -> http://localhost:3000
//        node scripts/automation-tick.mjs http://localhost:3001
// Reads CRON_SECRET from .env.local so you never type it.
import { readFileSync } from 'node:fs';

const base = process.argv[2] || 'http://localhost:3000';
let secret = process.env.CRON_SECRET;
if (!secret) {
  try {
    const line = readFileSync('.env.local', 'utf8').split('\n').find((l) => l.startsWith('CRON_SECRET='));
    secret = line?.slice('CRON_SECRET='.length).trim().replace(/^["']|["']$/g, '');
  } catch {}
}
if (!secret) {
  console.error('No CRON_SECRET found in .env.local');
  process.exit(1);
}
const res = await fetch(`${base}/api/cron/automation-tick`, { headers: { Authorization: `Bearer ${secret}` } });
console.log(res.status, JSON.stringify(await res.json(), null, 2));

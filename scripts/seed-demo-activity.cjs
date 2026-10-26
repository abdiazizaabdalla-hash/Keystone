// Demo helper: gives the demo deals real, openable documents and live message threads.
//
// What it does, for the deals created by add-demo-team-abdiaziz (file numbers 2026-20xx and
// 2026-21xx) on the three demo accounts only:
//   1. Documents: uploads small placeholder PDFs (clearly marked "SAMPLE DOCUMENT") into the
//      private transaction-documents bucket and adds the matching rows, filed under the right
//      category, linked to the right checklist step, and signed where it makes sense. Open deals
//      get the documents their stage would really have; closed deals get a full closing file.
//   2. Messages: gives every open deal an agent on the deal (a demo agent login that cannot sign
//      in, since it has no password and an @example.com address) and a short TC <-> agent
//      conversation that matches the deal's stage, some with a document attached.
//
// Nothing is emailed. It writes only with your own .env.local (this script never prints it).
// Run it in your own terminal from the project root, after the six demo SQL parts:
//
//   node scripts/seed-demo-activity.cjs --dry      # shows what it would do, changes nothing
//   node scripts/seed-demo-activity.cjs            # does it (safe to re-run; skips what exists)
//   node scripts/seed-demo-activity.cjs --reset    # removes the demo documents and messages, then re-adds them
//
// Delete this file when the demo is over; it is not meant to ship or run in production.
const fs = require('fs');
const path = require('path');
const { createClient } = require(path.join(process.cwd(), 'node_modules/@supabase/supabase-js'));

const DRY = process.argv.includes('--dry');
const RESET = process.argv.includes('--reset');
const BUCKET = 'transaction-documents';
const OWNER_EMAILS = ['abdiaziz.a.abdalla@gmail.com', 'aabdiaziz47@gmail.com', 'aaa7420023@gmail.com'];
const STAGES = ['Contract Pending', 'Contract & File Setup', 'Earnest Money & Option', 'Inspection & Repairs', 'Title, Appraisal & Financing', 'Clear to Close', 'Closed'];
const DEMO_PATH_MARK = '/demo-'; // every placeholder file's storage path contains this

// ---------- env (read from .env.local, never printed) ----------
function loadEnv() {
  const env = {};
  const content = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, eq).trim()] = v;
  }
  return env;
}

// ---------- a tiny valid one-page PDF, no libraries ----------
function ascii(s) {
  return String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7e]/g, '');
}
function makePdf(title, lines) {
  const esc = (s) => ascii(s).replace(/[\\()]/g, '\\$&');
  let content = `BT /F1 22 Tf 1 0 0 1 72 720 Tm (${esc(title)}) Tj ET\n`;
  lines.forEach((l, i) => {
    content += `BT /F1 11 Tf 1 0 0 1 72 ${690 - i * 20} Tm (${esc(l)}) Tj ET\n`;
  });
  content += 'BT /F1 10 Tf 1 0 0 1 72 90 Tm (SAMPLE DOCUMENT - placeholder file for the Relay TC demo. Not a real contract or record.) Tj ET\n';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => {
    out += `${String(o).padStart(10, '0')} 00000 n \n`;
  });
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------- which documents a deal has at each stage ----------
// done = number of finished checklist steps (0..6). cat/type match src/lib/documentTaxonomy.ts.
// step = checklist step the document belongs to (0-based), sign = needs a signature, by = who uploaded it.
const DOC_PLAN = [
  { min: 0, cat: 'contract_disclosures', type: 'Purchase Contract', step: 0, sign: true, by: 'agent', off: 0 },
  { min: 0, cat: 'contract_disclosures', type: 'IABS / Agency Documents', step: 0, sign: true, by: 'agent', off: 0 },
  { min: 1, cat: 'contract_disclosures', type: 'Seller Disclosure', step: 0, sign: true, by: 'agent', off: 1 },
  { min: 1, cat: 'contract_disclosures', type: 'Lead-Based Paint Disclosure', step: 0, sign: true, by: 'agent', off: 1 },
  { min: 1, cat: 'financing_underwriting', type: 'Pre-Approval', step: 3, sign: false, by: 'agent', off: 1 },
  { min: 2, cat: 'earnest_money_option', type: 'Earnest Money Receipt', step: 1, sign: false, by: 'tc', off: 3 },
  { min: 2, cat: 'earnest_money_option', type: 'Option Fee Receipt', step: 1, sign: false, by: 'tc', off: 3 },
  { min: 2, cat: 'inspection_repairs', type: 'Inspection Report', step: 2, sign: false, by: 'agent', off: 9 },
  { min: 3, cat: 'inspection_repairs', type: 'Repair Requests', step: 2, sign: true, by: 'agent', off: 11 },
  { min: 3, cat: 'title_escrow', type: 'Title Commitment', step: 3, sign: false, by: 'tc', off: 14 },
  { min: 4, cat: 'title_escrow', type: 'Survey', step: 3, sign: false, by: 'tc', off: 16 },
  { min: 4, cat: 'appraisal', type: 'Appraisal', step: 3, sign: false, by: 'tc', off: 19 },
  { min: 4, cat: 'financing_underwriting', type: 'Insurance', step: 3, sign: false, by: 'agent', off: 21 },
  { min: 5, cat: 'financing_underwriting', type: 'Clear to Close', step: 4, sign: false, by: 'tc', off: 26 },
  { min: 5, cat: 'closing', type: 'Closing Disclosure', step: 4, sign: true, by: 'tc', off: 27 },
  { min: 6, cat: 'closing', type: 'Settlement Statement', step: 5, sign: false, by: 'tc', off: 30 },
  { min: 6, cat: 'closing', type: 'Closing Confirmation', step: 5, sign: false, by: 'tc', off: 30 },
  { min: 6, cat: 'post_closing', type: 'Final File', step: 5, sign: false, by: 'tc', off: 31 },
];

// ---------- conversations (open deals only) ----------
// {a} agent first name, {t} TC first name, {s} street, {w} what the deal is waiting on
const THREADS = {
  early: [
    ['agent', 'Hi {t}, we are under contract on {s}. Executed contract attached, can you open the file and send me the timeline?', 'Purchase Contract'],
    ['tc', 'Got it, thanks {a}. The file is open and the checklist is set up. I will send the key dates today.'],
    ['agent', 'Perfect. The buyers say earnest money goes in first thing tomorrow.'],
    ['tc', 'Great, I will confirm receipt with title as soon as it lands.'],
  ],
  option: [
    ['agent', 'Earnest money receipt from title is in the file. Inspection is Thursday at 9, buyers will be there.', 'Earnest Money Receipt'],
    ['tc', 'Thanks {a}. I added the inspection to the critical dates. Option period is running, so the repair request should go out right after the report.'],
    ['agent', 'Report is back, mostly small items. I will send the repair request tomorrow.', 'Inspection Report'],
    ['tc', 'Sounds good, send it over and I will track the seller response.'],
  ],
  repairs: [
    ['agent', 'Seller agreed to the repairs on {s}. Signed request attached.', 'Repair Requests'],
    ['tc', 'Thanks {a}, filed. I started the title and appraisal steps.'],
    ['agent', 'Lender says the appraisal is ordered. Anything you need from the buyers?'],
    ['tc', 'Just the homeowner insurance quote. I will remind them today.'],
  ],
  title: [
    ['tc', 'Title commitment is in. Sharing it so you can review the exceptions.', 'Title Commitment'],
    ['agent', 'Thanks {t}. Appraisal came in at value, the lender says underwriting is the last step.'],
    ['tc', 'Excellent. I will chase clear to close and line up a closing time with title.'],
    ['agent', 'Buyers would love a 2pm closing if it works.'],
  ],
  ctc: [
    ['tc', 'We are clear to close on {s}! Closing disclosure is in the file for the buyers.', 'Closing Disclosure'],
    ['agent', 'Amazing, thank you. The buyers are booking the final walkthrough.'],
    ['tc', 'I will send the closing day checklist, and your invoice goes out after funding.'],
    ['agent', 'You are the best, thanks {t}.'],
  ],
};
const WAITING_TAIL = [
  ['agent', 'Any news from the {w}? My clients keep asking.'],
  ['tc', 'Still waiting on the {w}. I followed up this morning and will update you the moment I hear back.'],
];

// minutes ago for the LAST message, by deal index, so the inbox has a natural spread
const LAST_AGO = [35, 180, 420, 900, 1500, 2200, 3100, 70, 640, 1200];

async function main() {
  const env = loadEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase URL or service role key in .env.local');
    process.exit(1);
  }
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const must = (res, what) => {
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
    return res.data;
  };

  // --- the three demo owners
  const allUsers = [];
  for (let page = 1; page < 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('listUsers: ' + error.message);
    allUsers.push(...data.users);
    if (data.users.length < 1000) break;
  }
  const byEmail = new Map(allUsers.map((u) => [(u.email || '').toLowerCase(), u]));
  const owners = OWNER_EMAILS.map((e) => byEmail.get(e));
  if (owners.some((o) => !o)) throw new Error('One of the three demo accounts does not exist.');
  const ownerIds = owners.map((o) => o.id);
  const ownerFirst = new Map(owners.map((o) => [o.id, ((o.user_metadata && o.user_metadata.full_name) || o.email).split(' ')[0]]));

  // --- demo deals + their agents
  const agents = must(await sb.from('agents').select('id, name, email, tc_user_id').in('tc_user_id', ownerIds), 'agents');
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const txs = must(
    await sb.from('transactions').select('id, file_number, property_address, status, agent_id, acceptance_date, tc_user_id').in('agent_id', agents.map((a) => a.id)),
    'transactions'
  ).filter((t) => /^2026-(20|21)\d\d$/.test(t.file_number || ''));
  if (!txs.length) throw new Error('No demo deals found. Run the six demo SQL parts first.');
  const txIds = txs.map((t) => t.id);
  const tasksByTx = new Map();
  must(await sb.from('tasks').select('id, transaction_id, sort_order, waiting_on').in('transaction_id', txIds), 'tasks').forEach((t) => {
    if (!tasksByTx.has(t.transaction_id)) tasksByTx.set(t.transaction_id, []);
    tasksByTx.get(t.transaction_id).push(t);
  });
  console.log(`Demo deals found: ${txs.length} (${txs.filter((t) => t.status !== 'Closed').length} open)`);

  // --- reset (demo documents and every message on the demo deals)
  if (RESET) {
    const docs = must(await sb.from('documents').select('id, storage_path').in('transaction_id', txIds).like('storage_path', `%${DEMO_PATH_MARK}%`), 'documents');
    console.log(`Reset: ${docs.length} demo documents, then all messages on the demo deals`);
    if (!DRY) {
      await sb.from('messages').delete().in('transaction_id', txIds);
      if (docs.length) {
        for (let i = 0; i < docs.length; i += 100) await sb.storage.from(BUCKET).remove(docs.slice(i, i + 100).map((d) => d.storage_path));
        await sb.from('documents').delete().in('id', docs.map((d) => d.id));
      }
    }
  }

  // --- demo agent logins (no password, example.com address: they cannot sign in)
  const agentUserByAgentId = new Map();
  const openTxs = txs.filter((t) => t.status !== 'Closed');
  const neededAgents = [...new Set(openTxs.map((t) => t.agent_id))].map((id) => agentById.get(id)).filter(Boolean);
  for (const a of neededAgents) {
    const email = (a.email || '').toLowerCase();
    if (!email.endsWith('@example.com')) {
      console.log(`  skip ${a.name}: not an example.com address`);
      continue;
    }
    let u = byEmail.get(email);
    if (u && !(u.app_metadata && u.app_metadata.role === 'agent')) {
      console.log(`  skip ${a.name}: that email belongs to a non-agent account, left alone`);
      continue;
    }
    if (!u) {
      if (DRY) {
        u = { id: `dry-${a.id}` };
      } else {
        const res = await sb.auth.admin.createUser({ email, email_confirm: true, app_metadata: { role: 'agent' }, user_metadata: { full_name: a.name, demo: true } });
        if (res.error) throw new Error(`createUser ${email}: ${res.error.message}`);
        u = res.data.user;
      }
    }
    agentUserByAgentId.set(a.id, u.id);
  }
  console.log(`Demo agent logins ready: ${agentUserByAgentId.size} of ${neededAgents.length}`);

  // --- per deal
  let docCount = 0;
  let msgCount = 0;
  let linkCount = 0;
  let idx = 0;
  for (const tx of txs.sort((a, b) => a.file_number.localeCompare(b.file_number))) {
    const done = Math.max(0, STAGES.indexOf(tx.status));
    const ownerId = tx.tc_user_id;
    const agent = agentById.get(tx.agent_id);
    const agentUserId = agentUserByAgentId.get(tx.agent_id) || null;
    const tasks = tasksByTx.get(tx.id) || [];
    const taskForStep = (s) => (tasks.find((t) => t.sort_order === s) || {}).id || null;
    const isOpen = tx.status !== 'Closed';
    const street = (tx.property_address || '').split(',')[0];
    const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const accepted = tx.acceptance_date ? new Date(tx.acceptance_date + 'T12:00:00Z') : new Date();

    // documents
    const existingDocs = must(await sb.from('documents').select('id, document_type, storage_path').eq('transaction_id', tx.id).like('storage_path', `%${DEMO_PATH_MARK}%`), 'documents');
    const docByType = new Map(existingDocs.map((d) => [d.document_type, d.id]));
    if (existingDocs.length === 0) {
      for (const spec of DOC_PLAN.filter((d) => d.min <= done)) {
        const fileName = `${slug(spec.type)}-${tx.file_number}.pdf`;
        const storagePath = `${tx.id}${DEMO_PATH_MARK}${slug(spec.type).toLowerCase()}.pdf`;
        const body = makePdf(spec.type, [`File ${tx.file_number}`, tx.property_address, `Agent: ${agent ? agent.name : ''}`, `Stage: ${tx.status}`]);
        docCount++;
        if (DRY) continue;
        const up = await sb.storage.from(BUCKET).upload(storagePath, body, { contentType: 'application/pdf', upsert: true });
        if (up.error) throw new Error(`upload ${fileName}: ${up.error.message}`);
        const when = new Date(Math.min(Date.now() - 3600 * 1000, accepted.getTime() + spec.off * 86400000 + 9 * 3600 * 1000));
        const signed = spec.sign && (done > spec.step || !isOpen);
        const uploader = spec.by === 'agent' && agentUserId ? agentUserId : ownerId;
        const row = {
          transaction_id: tx.id,
          task_id: taskForStep(spec.step),
          category: spec.cat,
          document_type: spec.type,
          file_name: fileName,
          storage_path: storagePath,
          content_type: 'application/pdf',
          file_size: body.length,
          uploaded_by: uploader,
          requires_signature: spec.sign,
          is_signed: signed,
          created_at: when.toISOString(),
        };
        let ins = await sb.from('documents').insert(row).select('id').single();
        if (ins.error && /is_signed|created_at|column/i.test(ins.error.message)) {
          delete row.is_signed;
          ins = await sb.from('documents').insert(row).select('id').single();
        }
        if (ins.error) throw new Error(`document row ${fileName}: ${ins.error.message}`);
        docByType.set(spec.type, ins.data.id);
      }
    }

    // agent on the deal + conversation (open deals only)
    if (!isOpen || !agentUserId) continue;
    if (!DRY) {
      const link = await sb.from('transaction_agents').upsert({ transaction_id: tx.id, agent_user_id: agentUserId, invited_by: ownerId }, { onConflict: 'transaction_id,agent_user_id', ignoreDuplicates: true });
      if (link.error) throw new Error('transaction_agents: ' + link.error.message);
    }
    linkCount++;
    const existingMsgs = must(await sb.from('messages').select('id').eq('transaction_id', tx.id).limit(1), 'messages');
    if (existingMsgs.length) continue;
    const key = done <= 1 ? 'early' : done === 2 ? 'option' : done === 3 ? 'repairs' : done === 4 ? 'title' : 'ctc';
    const waitingOn = (tasks.find((t) => t.waiting_on) || {}).waiting_on;
    const script = [...THREADS[key]];
    if (waitingOn) script.splice(script.length - 1, 1, ...WAITING_TAIL);
    const lastAgo = LAST_AGO[idx % LAST_AGO.length];
    idx++;
    const fill = (s) => s.replace(/\{a\}/g, (agent ? agent.name : 'there').split(' ')[0]).replace(/\{t\}/g, ownerFirst.get(ownerId) || 'there').replace(/\{s\}/g, street).replace(/\{w\}/g, (waitingOn || 'title company').toLowerCase());
    // times run forward: the last message is `lastAgo` minutes old, each earlier one a bit further back
    const agoAt = new Array(script.length);
    agoAt[script.length - 1] = lastAgo;
    for (let i = script.length - 2; i >= 0; i--) agoAt[i] = agoAt[i + 1] + 25 + ((i * 41 + idx * 17) % 70);
    const rows = script.map((m, i) => ({
      transaction_id: tx.id,
      sender_id: m[0] === 'agent' ? agentUserId : ownerId,
      sender_role: m[0],
      body: fill(m[1]),
      attachment_document_id: m[2] ? docByType.get(m[2]) || null : null,
      created_at: new Date(Date.now() - agoAt[i] * 60000).toISOString(),
    }));
    msgCount += rows.length;
    if (!DRY) must(await sb.from('messages').insert(rows), 'messages insert');
  }

  console.log(`${DRY ? 'Would add' : 'Added'}: ${docCount} documents, ${msgCount} messages, ${linkCount} agent links on open deals.`);
  if (!DRY) console.log('Done. Reload the dashboard: Messages tab and each deal Documents tab are now populated.');
}

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});

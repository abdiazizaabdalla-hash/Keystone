// One-off setup script: creates the Stripe Products/Prices Relay TC needs
// (Starter $19/mo, Pro $39/mo, Team $89/mo for the first 3 seats then $30/mo
// per extra seat — see src/lib/stripe.ts) and prints the price IDs to paste
// into .env.local as STRIPE_PRICE_STARTER / STRIPE_PRICE_PRO / STRIPE_PRICE_TEAM.
// For live mode, create the same three prices in the Stripe dashboard
// (this script refuses live keys on purpose). Safe to re-run — it skips creating
// a product/price if one with the same lookup_key already exists.
//
// Usage: STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup-products.mjs
import Stripe from 'stripe';

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error('Set STRIPE_SECRET_KEY in the environment before running this script.');
  process.exit(1);
}
if (!secretKey.startsWith('sk_test_')) {
  console.error('Refusing to run against a non-test-mode key (must start with sk_test_). Pass your Stripe TEST secret key.');
  process.exit(1);
}

const stripe = new Stripe(secretKey);

async function ensurePrice({ lookupKey, productName, nickname, price }) {
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (existing.data.length > 0) {
    console.log(`${lookupKey}: already exists -> ${existing.data[0].id}`);
    return existing.data[0].id;
  }

  const product = await stripe.products.create({ name: productName });
  const created = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    recurring: { interval: 'month' },
    lookup_key: lookupKey,
    nickname,
    ...price,
  });
  console.log(`${lookupKey}: created -> ${created.id}`);
  return created.id;
}

const starterPriceId = await ensurePrice({
  lookupKey: 'relay_starter_monthly_v2',
  productName: 'Relay TC — Starter',
  nickname: 'Starter $19/mo',
  price: { unit_amount: 1900 },
});

const proPriceId = await ensurePrice({
  lookupKey: 'relay_pro_monthly_v2',
  productName: 'Relay TC — Pro',
  nickname: 'Pro $39/mo',
  price: { unit_amount: 3900 },
});

// Graduated tiers: the first 3 seats cost a flat $89, every seat after that $30.
// Checkout starts at quantity 3 and seat changes only move the quantity.
const teamPriceId = await ensurePrice({
  lookupKey: 'relay_team_monthly_v2',
  productName: 'Relay TC — Team',
  nickname: 'Team $89/mo for 3 seats, then $30/seat',
  price: {
    billing_scheme: 'tiered',
    tiers_mode: 'graduated',
    tiers: [
      { up_to: 3, flat_amount: 8900, unit_amount: 0 },
      { up_to: 'inf', unit_amount: 3000 },
    ],
  },
});

console.log('\nAdd these to .env.local:\n');
console.log(`STRIPE_PRICE_STARTER=${starterPriceId}`);
console.log(`STRIPE_PRICE_PRO=${proPriceId}`);
console.log(`STRIPE_PRICE_TEAM=${teamPriceId}`);

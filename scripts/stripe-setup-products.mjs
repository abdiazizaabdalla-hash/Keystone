// One-off setup script: creates the Stripe Products/Prices Relay TC needs
// (Pro $29/mo, Team $57/mo flat — see src/lib/stripe.ts for why Team isn't
// per-seat yet) and prints the price IDs to paste into .env.local as
// STRIPE_PRICE_PRO / STRIPE_PRICE_TEAM. Safe to re-run — it skips creating
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

async function ensurePrice({ lookupKey, productName, unitAmount, nickname }) {
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (existing.data.length > 0) {
    console.log(`${lookupKey}: already exists -> ${existing.data[0].id}`);
    return existing.data[0].id;
  }

  const product = await stripe.products.create({ name: productName });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: unitAmount,
    currency: 'usd',
    recurring: { interval: 'month' },
    lookup_key: lookupKey,
    nickname,
  });
  console.log(`${lookupKey}: created -> ${price.id}`);
  return price.id;
}

const proPriceId = await ensurePrice({
  lookupKey: 'keystone_pro_monthly',
  productName: 'Relay TC — Pro',
  unitAmount: 2900,
  nickname: 'Pro $29/mo',
});

const teamPriceId = await ensurePrice({
  lookupKey: 'keystone_team_monthly',
  productName: 'Relay TC — Team',
  unitAmount: 5700,
  nickname: 'Team $57/mo (3-seat bundle)',
});

console.log('\nAdd these to .env.local:\n');
console.log(`STRIPE_PRICE_PRO=${proPriceId}`);
console.log(`STRIPE_PRICE_TEAM=${teamPriceId}`);

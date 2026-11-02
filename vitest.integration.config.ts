import { defineConfig } from 'vitest/config';
import path from 'node:path';
import fs from 'node:fs';

// Integration tests run the real API route handlers against the relay-test
// Supabase project. They read ONLY .env.test (never .env.local, which holds
// production keys), and tests/integration/setup.ts refuses to run unless the
// database is relay-test.

function readEnvTest(): Record<string, string> {
  const file = path.resolve(__dirname, '.env.test');
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.int.test.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    env: {
      // Harmless stand-ins so modules that read these at import time load. Nothing
      // here can reach Stripe, Resend or Anthropic.
      STRIPE_SECRET_KEY: 'sk_test_not_real',
      STRIPE_WEBHOOK_SECRET: 'whsec_not_real',
      RESEND_API_KEY: 're_not_real',
      ANTHROPIC_API_KEY: 'sk-ant-not-real',
      CRON_SECRET: 'test-cron-secret',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
      ...readEnvTest(),
    },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});

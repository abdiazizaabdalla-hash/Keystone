import type { MetadataRoute } from 'next';

const BASE_URL = 'https://www.relaytc.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/pricing', '/faq', '/for-agents', '/for-agents/portal', '/for-tcs', '/for-teams', '/for-brokerages', '/terms', '/privacy'].map((path) => ({
    url: `${BASE_URL}${path}`,
  }));
}

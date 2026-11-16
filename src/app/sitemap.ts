import type { MetadataRoute } from 'next';

const BASE_URL = 'https://www.relaytc.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['', '/pricing', '/faq', '/compare', '/security', '/for-tcs', '/for-agents', '/for-brokerages', '/get-started', '/terms', '/privacy'].map((path) => ({
    url: `${BASE_URL}${path}`,
  }));
}

# Parked public pages

Status as of 2026-11-02: the brokerage page is parked; the free agent portal page is live again.

- `for-brokerages/*`: the brokerage (in development) page. Not routed, not type-checked. To bring it back:
  copy it to `src/app/for-brokerages/` (drop the `.txt`), restore its links in `PublicHeader`,
  `PublicMobileMenu`, `PublicFooter`, the home page cards, `sitemap.ts` and `SiteAnalytics`, and remove its
  redirect in `next.config.ts`.
- `for-agents/*`: the original copies of the agent page and free-portal explainer. The live versions are in
  `src/app/for-agents/` (reworded so nothing implies a paid agent plan). Keep this copy only for reference.

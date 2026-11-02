# Parked public pages

These pages were taken off the public site on 2026-11-02 until the agent workspace and the brokerage
product are built to full functionality. They are kept as `.txt` so they are neither routed nor
type-checked. To bring one back: copy it to `src/app/<name>/` (drop the `.txt`), restore its links in
`PublicHeader`, `PublicMobileMenu`, `PublicFooter`, the home page cards, `sitemap.ts` and
`SiteAnalytics`, and remove its redirect in `next.config.ts`.

- `for-agents/page.tsx.txt`, `for-agents/layout.tsx.txt`, `for-agents/portal/*`: the agent audience page and the free-portal explainer.
- `for-brokerages/*`: the brokerage (in development) page.

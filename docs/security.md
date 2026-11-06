# Security

## Identity (brief 4.3, 11.1)
- No accounts. Starting an order creates the host; joining with the session's code creates a guest. Each gets a random 32-byte token in an HttpOnly cookie named per session (`salo_s_<sessionId>`, `SameSite=Lax`, `Secure` when served over https, 31 days). The database stores only SHA-256 hashes (`participant_credentials`); revoked or expired credentials are ignored.
- Host and guest credentials are separate rows and types. Joining only ever creates GUEST credentials; nothing in a request body can choose a role.
- Display names are labels, not identities; two guests may share one.

## Authorization (brief 4, 11.2)
- `src/lib/permissions.ts`: host-only rename, confirm, rounds, close, claim approval, editing others' entries; guests add entries and change only their own.
- Every session endpoint resolves the caller from the cookie; someone without a credential for that session gets `404` (the same as a session that does not exist). Entry ids are always scoped to the caller's session.

## Invitations
- The invite link is `/j/<code>`; the code is 6 characters from a 32-letter alphabet (about a billion values). Looking up a code (the invite page, its metadata and its preview image) allows 40 wrong codes per hour per client address; after that every lookup from that address is refused for the hour. Unknown and ended orders return the same 404. Joining is limited to 30 per hour per address, and `POST /api/sessions/:id/join` also requires the session id to match the code. A browser that already belongs to the order keeps its identity instead of joining again.
- Known limit: a guessing attack spread over many addresses is only slowed, not stopped; codes stop working when the order ends.
- Before joining, a link preview reveals only the order's name, status and round, never dishes or people. Preview crawlers cannot join: joining needs a POST.

## Web protections (brief 11.4)
- CSRF: `SameSite=Lax` cookies plus an Origin check on every non-GET `/api` request (`src/proxy.ts`).
- XSS: React escaping only; no HTML from users is rendered. CSP with a per-request nonce, `object-src 'none'`, `frame-ancestors 'none'`; images only from self and data/blob URLs (the QR code).
- Headers: HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, strict referrer policy, permissions policy, `X-Robots-Tag: noindex` on sessions, invites and API.

## Abuse limits (brief 11.3)
| Limit | Value |
|---|---|
| New orders | 20 / hour / client address |
| Joins | 30 / hour / client address |
| Changes | 120 / minute / participant |
| Event streams | 500 per instance, 12 per client address, 4 per participant; each ends after 15 minutes (the browser reconnects and replays) |
| Invite lookups | 40 wrong codes / hour / client address |
| Request body | 8 KB |
| People per order | 30 |
| Entries | 300 active, 1,000 ever, 300 distinct dishes per order |
| Text | dish 60, size 40, instructions 140, names 40, order name 60; no NUL |
Rate limits live in process memory (one instance) and key on the last `X-Forwarded-For` hop (one trusted proxy; see deployment.md).

## Data minimization and retention
Preview images for unknown or ended invites are a cached static card (fonts read once per process).

Only display names are collected. Retention and cleanup: Phase 5 (closed sessions deleted 7 days after closing, inactive ones after 30 days).

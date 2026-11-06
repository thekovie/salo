# Project log

Running record of decisions, issues, tests and deviations, one section per PR. Newest last.

## 2026-11-06 · Project start

- Brief v1.2 saved verbatim in `docs/brief.md`. Approved plan: milestones M0–M5 mapping to brief phases 0–5, one branch and PR each, merged only after typecheck, lint, tests, build and green CI, and the owner's go-ahead.
- Owner decisions: name **Salo** (from *salu-salo*); logo = top-down round table with a speech-bubble tail and three plates reading as a "typing…" indicator; visual direction **Order ticket**; public repo `thekovie/salo`; link previews must look presentable and say what the link is for.
- Design interview (impeccable): copy voice is plain English with light Taglish touches in empty and success states; landing = tool first plus a short how-it-works; waiter ticket must work both read aloud and shown to the waiter.

## M0 · Foundation (`feat/m0-foundation`)

**Built**
- Next.js 16 / React 19 / Tailwind 4 / TypeScript scaffold, modules ported from heron: CSP with per-request nonce, JSON logger with redaction, in-memory rate limiter, client-IP helper, singleton.
- PostgreSQL schema for every brief section 8 table plus `entry_claims`; migrations `0000_init` and `0001_integrity_triggers` (snapshot immutability, revision never decreases, confirmed-round entries frozen). Migrations run at startup; the app exits with a clear log line if it cannot start.
- `proxy.ts`: CSP for pages, Origin check (CSRF layer) for every non-GET API request. `X-Robots-Tag: noindex` on `/s`, `/j`, `/api`.
- Design world (PRODUCT.md, surface brief with the direction contract): thermal-paper and carbon-copy tokens for light and dark, Fredoka / Nunito Sans / DM Mono self-hosted with `next/font/local`, perforated ticket strip, rubber CONFIRMED stamp.
- Brand: SVG logo + wordmark, favicon, apple icon and PWA icons (including maskable) generated with `ImageResponse`, web manifest.
- Link previews: root metadata (title template, description, Open Graph, Twitter large card, theme colour), landing OG image 1200×630 (logo, tagline, sample ticket labelled "Sample order"), robots (landing only), sitemap.
- Landing page: start button, join-by-code form (forgiving input: lower case, spaces, I/L/O/U look-alikes), sample ticket, how it works.
- Dockerfile (multi-stage, non-root, health check), compose for local + CI, CI with a PostgreSQL service (migration drift check, audit, typecheck, lint, tests, build) and a Docker smoke job.

**Tests**: 24 (env, CSP, logger, rate limiter, client IP, database integrity rules against real PostgreSQL). Docker image built and smoke-tested locally: health 200, CSP nonce on pages, OG image 200.

**Decisions / deviations**
- Google-hosted fonts failed to fetch during the build; fonts are self-hosted from the OFL `@fontsource` files instead (no third-party request at build or run time). Woff copies in `assets/fonts` render link-preview images.
- Rate limiter stays in process memory (one app instance per brief 7.7); move to PostgreSQL only if the app ever runs more than one instance.
- Data-model deviations listed in `docs/data-model.md` (no stored `active_round_id`, `variant` text column, added `entry_claims`, `target_round_id`, `group_id`).
- The start button calls `POST /api/sessions`, which ships in M1.

**Open**: DESIGN.md is written from the built world after M1 ships the workspace (impeccable finish step).

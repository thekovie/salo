# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Groups eating out together in the Philippines: barkadas, families, coworkers. One person (the host) ends up collecting everyone's dishes on a phone while the table talks and a waiter waits. Guests may join from their own phones by scanning a QR code or opening a shared link (Messenger, Viber). Waiters never use the app; they only hear or see the final ticket.

## Product Purpose
Salo collects a table's restaurant order in one place, merges identical dishes into exact counts while keeping every variant and instruction, and produces a clear ticket for the waiter. Success: faster and more accurate than a list in Notes or a Messenger thread, with no wrong quantities and no lost changes. Full specification: `docs/brief.md`.

## Positioning
No restaurant integration, no menu setup, no accounts. A host can use it alone in seconds; guests can add their own dishes live; one person can order for a sub-group. Consolidation is computed from source entries, so nobody's order is silently changed.

## Operating Context
Used at the table, often one-handed, in noisy and variably lit restaurants (bright food courts to dim bars), on mid-range Android phones and iPhones over patchy mobile data. The waiter view is both read aloud by the host and handed or shown to the waiter. Orders come in rounds: a first order, then add-ons.

## Capabilities and Constraints
Next.js PWA, PostgreSQL, Server-Sent Events, self-hosted on Coolify. Host-only: confirm a round, open rounds, end the session. Closed sessions stay read-only for 7 days, then are deleted. Out of scope: payments, bill splitting, menus, AI/OCR, restaurant accounts.

## Brand Commitments
- Name: **Salo** (from *salu-salo*, a shared meal). Tagline: "One table. Everyone's order."
- Logo: top-down round table whose plate dots read as a speech bubble.
- Visual direction pinned by the owner: "Order ticket" (warm paper, tomato red, saffron accents, perforated ticket cards, big tabular quantities, rounded light-weight type, bottom dock, light and dark). The owner dislikes sidebars and heavy type.
- Voice: plain warm English with light Taglish touches in empty states and success messages ("Ayos!", "Kain na"). Buttons, labels and errors stay in plain English.

## Evidence on Hand
None yet: no users, testimonials, metrics or restaurant partners. Never fabricate any of these. Sample dishes in demos (Chicken Katsu, Gyoza, Crispy Pata, Iced Tea) are illustrative.

## Product Principles
1. Adding a dish takes one field and one tap; everything else is optional and hidden until asked for.
2. Counts are sacred: totals always come from source entries, and every pending or failed change is visible.
3. The host stays in control; guests contribute, never override.
4. The ticket is for a stranger: readable at arm's length, out loud, in any light.
5. No setup, no sign-up, nothing to remember after the meal.

## Accessibility & Inclusion
WCAG 2.2 AA: 44px targets, visible focus, screen-reader announcements for sync and save states, status never by colour alone, respects reduced motion and large text.

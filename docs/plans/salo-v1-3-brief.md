# Salo — Product Enhancement & UX Implementation Brief v1.3 (owner's words)

Pasted by the owner on 2026-11-19: "I have some features that needs to be implement or fixed or improved upon, take a look on my implementation brief". Kept verbatim in substance; list formatting compacted. Plan: `docs/plans/salo-v1-3.md`.

---

**Repository:** https://github.com/thekovie/salo · **Application:** https://salo.thekovie.com · **Platform:** Mobile-first, realtime dining coordination PWA · **Status:** Proposed — audit and planning required before implementation

# 1. Executive Summary

Salo is evolving from a collaborative group-ordering application into a lightweight **shared dining coordination platform**. Its purpose is to help friends, families, coworkers, and other dining groups organize their orders, track food deliveries, manage changes, and settle expenses without relying on scattered notes, messages, or manual calculations. The application must remain simple enough for occasional users who only want to record a few dishes, while offering additional functionality when groups need more coordination.

- **A. Product Experience:** Broaden Salo's positioning beyond order collection. Support the dining journey from ordering through bill settlement. Differentiate Salo from ordinary notes and checklist applications. Preserve the application's approachable identity.
- **B. Functional Enhancements:** Improve structured order entry. Introduce consistent shared item pricing. Support unavailable dishes and easier corrections. Introduce in-app notifications. Track served and outstanding food. Improve KKB and receipt reconciliation. Enable convenient session summary sharing.
- **C. UI/UX Quality:** Conduct a comprehensive interface and usability audit. Identify friction in existing workflows. Evaluate navigation and feature discoverability. Improve mobile interaction and accessibility. Ensure new functionality does not introduce unnecessary complexity.

**Primary objective:** Make Salo more useful than a basic shared checklist while remaining just as approachable.

# 2. Updated Product Narrative

**2.1 Product Definition.** Salo is a lightweight, realtime dining coordination application that helps groups organize orders, track food deliveries, manage changes, and settle individual expenses. Instead of repeatedly recording or updating information across notes, conversations, and calculators, Salo provides one shared, consistent view of the dining session.

**2.2 Brand Positioning.** Primary tagline: *One table. Everyone's order.* Expanded value proposition: *Order together, keep track of what's been served, and settle everyone's share—all in one place.* The original tagline should remain unless user research identifies a compelling reason to replace it. Use the expanded value proposition to communicate the application's broader capabilities.

**2.3 Primary Workflow: Collect → Confirm → Track → Settle.** Collect: participants collaboratively enter dishes, quantities, variants, and instructions; Salo consolidates identical preparations while preserving individual attribution. Confirm: the host reviews and confirms the order with the waiter; subsequent changes are tracked without silently modifying confirmed records. Track: the group can see which food has arrived, what remains outstanding, and which items were cancelled or replaced. Settle: participants can review individual expenses, service-charge allocations, and final bill information.

**2.4 Differentiation from Notes and Checklists.** Salo should provide benefits beyond simply recording and checking off items. Its differentiation comes from connecting: structured ordering, automatic consolidation, order attribution, confirmed waiter tickets, corrections and cancellations, served-quantity tracking, shared pricing, KKB calculations. All of these should operate on a consistent underlying data model. Users should not need to re-enter the same information in separate views.

**2.5 Product Design Principles.** 1 Minimal effort: frequent actions must be fast and intuitive. 2 One source of truth: different views should derive from consistent session data. 3 Optional complexity: advanced functionality should appear only when relevant. 4 Collaboration without friction: users should not require accounts or complicated setup. 5 Clear ownership: host and guest responsibilities should remain understandable. 6 Transparent calculations: quantities and monetary amounts must be explainable. 7 Progressive experience: the interface should adapt naturally as the dining session progresses. 8 Useful over elaborate: do not introduce functionality that creates more work than it eliminates.

**2.6 Non-Goals.** Not a restaurant POS system, restaurant inventory platform, payment gateway, general-purpose task manager, waiter communication platform, or restaurant menu database.

# 3. Existing Architecture and Constraints

Before implementation, verify the current source code. Previously reviewed stack: Next.js and TypeScript; PostgreSQL with Drizzle ORM; Server-Sent Events; session-based authentication; HOST and GUEST permissions; PWA; Docker and Coolify; custom UI components; automated testing including Playwright. Existing concepts: sessions and participants; order batches and entries; session-scoped dishes; consolidated orders; multiple rounds; waiter confirmation; immutable confirmed snapshots; corrections; settlement records; KKB calculations; realtime events; retention and expiration.

Architectural expectations: extend the existing application rather than rebuild it; preserve confirmed-order immutability; preserve server-side authorization; reuse established realtime patterns; maintain data integrity under concurrent changes; use database migrations for schema changes; avoid unnecessary dependencies; keep existing sessions compatible where practical. The repository remains the source of truth for implementation details.

# 4. Comprehensive UI/UX Audit (P0 — Mandatory, Phase 0)

This phase must precede major feature implementation. Evaluate Salo as a complete application rather than individual screens in isolation.

**4.1 Audit Scope.**
- **A. Landing and onboarding:** whether users understand Salo's purpose immediately; whether the main CTA is obvious; whether creating and joining sessions is straightforward; whether instructions are excessively long; whether first-time users understand the host/guest model; whether the onboarding tour is genuinely helpful; whether users can discover primary benefits without extensive documentation. Assess whether the landing page communicates the expanded narrative. Do not advertise planned features as existing capabilities before release.
- **B. Order Composer:** ease of adding a basic dish; discoverability of variants and instructions; recipient selection; quantity controls; price entry; existing dish suggestions; input validation; editing and removing entries; keyboard behavior; layout stability; error recovery. Investigate why users currently place variants and instructions directly in the dish-name field.
- **C. Order Management:** individual vs consolidated entries; readability of quantities; group attribution; editing permissions; draft and confirmed states; corrections; review and confirmation flows; waiter-ticket presentation; multiple rounds. The interface must clearly distinguish what has been collected from what has actually been communicated to the waiter.
- **D. Navigation and IA:** can users locate their own orders, the consolidated order, other participants' orders, current round, Food Tracker, KKB, Notifications, session settings. Evaluate the existing tab and sheet structures. Avoid automatically adding permanent navigation tabs for every new feature. Consider contextual navigation based on the current session stage.
- **E. KKB and Billing:** whether users understand KKB; whether prices are easy to enter; whether missing prices are clearly communicated; whether service charges are understandable; whether individual totals are easy to locate; whether shared or unattributed dishes are confusing; whether incomplete calculations are communicated accurately. Avoid presenting incomplete subtotals as finalized bills.
- **F. Realtime Collaboration:** visibility of newly added dishes; clarity of remote changes; save and sync feedback; failed mutation recovery; offline and reconnect states; conflicting changes; host and guest permission feedback. Participants should understand whether an action has actually been saved.
- **G. Session Lifecycle:** creation; joining and sharing; returning; additional rounds; confirming; closing; accessing closed sessions; expiration messaging. Ensure users understand the consequences of ending a session.

**4.2 Mobile Usability Audit.** Widths: 320, 360, 375, 390, 430 px, tablet, desktop. Where practical, real Android and iOS. Inspect: text readability, density, button placement, touch targets, bottom navigation, safe areas, drawers, virtual keyboard overlap, sticky elements, scrolling, focus, long dish names, large participant lists, overflow, large text and zoom. Test short and long sessions: a layout that works for three dishes must also remain understandable with dozens of entries.

**4.3 Accessibility Audit.** Target WCAG 2.2 AA. Review semantic HTML, keyboard navigation, focus visibility, labels, screen-reader announcements, contrast, touch targets, reduced motion, error descriptions, colour-independent status, modal/drawer focus, dynamic content announcements. Automated checks supplement, not replace, manual inspection.

**4.4 UX Heuristic Review.** Nielsen's ten (visibility of status; real-world language; control and freedom; consistency; error prevention; recognition over recall; efficiency; minimalism; error recovery; help and discoverability). For each issue document: screen, problem, repro steps, severity, user impact, recommendation, complexity, components. Severity: **Critical** prevents a primary workflow or risks incorrect orders or billing; **High** substantial confusion, repeated mistakes, difficult recovery; **Medium** avoidable friction or reduced discoverability; **Low** minor visual/consistency/convenience.

**4.5 Deliverables.** Structured report: executive findings; current user journeys; screen-by-screen assessment; issues and severity; accessibility; mobile; IA recommendations; interaction improvements; priorities; testable acceptance criteria. Separate findings from actual inspection vs hypotheses needing user validation. Do not claim real-user testing from code inspection or automated browser tests. Exit criteria: primary workflows reviewed; critical issues documented; discoverability issues identified; prioritized remediation backlog exists; proposed features evaluated against current navigation.

# 5. Functional Enhancement Requirements

**F01 — Order Composer Redesign (P0, Phase 1).** Problem: users frequently enter variants and instructions inside the dish-name field because the structured controls are hidden behind nested panels. Requirements: make **Add variant** visibly accessible; make **Add instructions** visibly accessible; keep optional price entry discoverable; separate recipient selection from dish configuration; preserve the quick-add flow; progressive disclosure for optional inputs; display entered details before submission; suggest previously used variants within the same session; support user-confirmed splitting of plausible comma-separated descriptions; never automatically rewrite dish names; apply consistent interactions to editing screens; maintain mobile keyboard usability. Suggested structure: Dish name; visible optional actions Add variant / Add instructions / Add price; secondary controls Recipient / Quantity / Add. Acceptance: users can discover optional fields without opening recipient settings; basic entry remains fast; variants and instructions are saved separately; legitimate comma-containing names remain supported; existing ordering behavior is preserved.

**F02 — Shared Item Pricing (P0, Phase 2).** Problem: identical dishes ordered by separate participants can have inconsistent prices. Requirements: session-scoped default prices; match by normalized dish identity and relevant preparation attributes; different prices for different variants; automatically inherit matching prices; explicit entry-level overrides; hosts control shared defaults; realtime sync; preserve existing effective prices during migration; integer-centavo calculations; never interpret unknown prices as zero. Resolution: 1 explicit entry override, 2 shared preparation default, 3 unknown. Acceptance: matching preparations inherit consistent prices; overrides preserved; different variants distinguishable; KKB remains accurate.

**F03 — Unavailable Items (P0, Phase 3).** Introduce a **Mark unavailable** workflow supporting: cancelling affected quantities; replacing affected dishes; reviewing affected entries; notifying relevant participants. Draft orders: direct edits with existing undo. Confirmed orders: preserve immutable snapshots; use the existing correction architecture; partial cancellations; distinguish pending and communicated corrections; update effective billing only when corrections are confirmed. Acceptance: unavailable items handled without restarting the session; partial cancellations supported; historical waiter tickets unchanged; relevant participants receive clear updates.

**F04 — Streamlined Order Corrections (P1, Phase 3).** Simplify: cancel quantity; replace item; mark unavailable; review pending corrections. Avoid redundant correction records. Make original, pending, and communicated changes understandable.

**F05 — In-App Notifications (P1, Phase 4).** Notification center from the session header: unread count; chronological; read/unread; mark all as read; timestamps; contextual navigation; responsive drawer or sheet. Events: round confirmed; new round opened; dish unavailable; order corrected; food served; relevant price changes; readiness needs attention; session closes. Rules: avoid persisting routine dish additions; avoid duplicates; aggregate repetitive updates where practical; do not notify users unnecessarily about their own actions; respect participant-specific permissions; session-scoped history. Architecture: reuse SSE; persist meaningful notifications; maintain recipient eligibility and read state; support reconnect and replay; avoid relying exclusively on in-process memory. Browser push is out of initial scope.

**F06 — Food Arrival Tracker (P0, Phase 5).** An integrated continuation of ordering, not an unrelated checklist. Requirements: derive expected items from confirmed orders; track served quantities; partial deliveries; outstanding food; multiple rounds; account for confirmed cancellations and replacements; preserve source-entry attribution; host updates serving progress; participants view progress; SSE sync; persist across refreshes; quick quantity controls; served never exceeds effective expected. Example: "Chicken Katsu — 3 of 5 served — 2 waiting". Views: All / Waiting / Served. Also: session-level progress summary; host marks an entire dish served; correct accidental updates; appropriate notifications; serving state independent from KKB. UX: prominent once an order is confirmed; never forced before confirmation; not required to close a session; outstanding items at close give an informative warning, not a hard block. Acceptance: tracked without re-entering details; partial delivery; outstanding accurate; corrections reflected; easy on mobile.

**F07 — Receipt Reconciliation (P1, Phase 6).** Host enters the final receipt total; compare against Salo's calculated amounts: food subtotal; configured service charge; receipt total; discrepancies; identify incomplete prices; do not auto-distribute unexplained differences; clearly communicate incomplete reconciliation.

**F08 — Price Completion Indicator (P1, Phase 6).** e.g. "8 of 10 preparations priced", "2 items need prices", "All prices complete"; quick access to unresolved prices.

**F09 — Session Summary Sharing (P1, Phase 6).** **Copy summary**: session name; participant names; individual food subtotals; service-charge shares; individual totals; unresolved shared or unpriced items; overall total where calculable. Messenger-friendly plain text.

# 6. Future Enhancements (do not block this release)
Shared food cost allocation across selected participants with exact centavo rounding; activity history from existing events; browser/PWA push notifications (only after in-app notifications are stable).

# 7. Information Architecture and Navigation
Do not assume all features require permanent navigation entries. Before confirmation emphasize adding dishes, participants, reviewing, confirming. After confirmation surface Food Tracker, outstanding items, additional rounds, corrections, KKB. Near completion emphasize outstanding food, pricing completeness, receipt reconciliation, final summary, ending the session. Adapt to session state without unexpectedly moving controls or hiding important information. Requirements: predictable navigation; minimize permanent controls; primary actions reachable; avoid feature overload; consistent back-navigation; drawers and modals never trap users; session context remains visible.

# 8. Data Model and Realtime Architecture
Extend existing Drizzle schemas. Logical entities: shared pricing (session, preparation identity, default price, revision, update metadata); food arrival (source-entry or replacement identity, served quantity, revision, metadata); notifications (id, session, event type, subject reference, recipient eligibility, read state, dedup identity, timestamp); receipt reconciliation (amount, session, revision, metadata). Requirements: session-scoped ownership; cascading deletion; immutable confirmed snapshots; safe concurrent writes; extend mutation idempotency; SSE reconnect and replay; server-side validation. Reconcile suggested endpoints/events with the existing API during the technical audit.

# 9. Permissions and Security

| Action | Host | Guest |
|---|---|---|
| Add dishes | Yes | Yes |
| Enter variants/instructions | Yes | Yes |
| Edit draft entries | Any permitted entry | Own submissions |
| Manage shared prices | Yes | No |
| Edit entry prices | Yes | Own submissions |
| Mark items unavailable | Yes | No |
| Confirm corrections | Yes | No |
| Update food arrivals | Yes | No |
| View food tracking | Yes | Yes |
| View relevant notifications | Yes | Yes |
| Mark own notifications read | Yes | Yes |
| Set receipt total | Yes | No |
| Close session | Yes | No |

Server-side checks remain authoritative. Notifications and views must not expose unauthorized participant information.

# 10. Testing and UX Validation
**10.1 Automated:** structured composer inputs; dish normalization; price inheritance and overrides; partial cancellations; confirmed-order immutability; notification recipients; notification dedup; food arrival quantities; concurrent updates; receipt reconciliation; session restoration; retention; existing ordering and KKB regressions.
**10.2 E2E journeys:** A Simple order (two dishes, no advanced fields, stays quick). B Group order (several join, variants, consolidate, host confirms). C Unavailable item (confirmed dish unavailable, host records it, affected participant gets an update). D Food delivery (several batches, host tracks, checks outstanding). E Bill settlement (prices and receipt total, participants review amounts). F Disconnection (participant loses connectivity mid-update; recover without silently losing changes).
**10.3 Usability testing** with representative users when possible (tasks: start/join; basic dish; dish with variant; instructions; identify someone else's order; locate the confirmed order; check missing food; find KKB total; review a notification). Track completion, time, interactions, misclicks, incorrect field use, assistance, confusion. Avoid inventing performance improvements or research findings.

# 11. Roadmap

| Phase | Workstream | Priority |
|---|---|---|
| 0 | Comprehensive UI/UX audit and implementation planning | P0 |
| 1 | Composer UX redesign and critical usability fixes | P0 |
| 2 | Shared item pricing | P0 |
| 3 | Unavailable items and correction improvements | P0 |
| 4 | In-app notifications | P1 |
| 5 | Food arrival tracker | P0 |
| 6 | Billing, summary sharing, and UX refinements | P1 |
| 7 | Final usability validation and regression audit | P0 |

Each phase must satisfy its acceptance criteria. Critical audit issues are addressed before or alongside the relevant phase. Do not postpone serious usability problems merely because they are outside the requested features, but avoid an uncontrolled redesign.

# 12. Execution instructions (summary)
Understand the repo (AGENTS.md, PRODUCT.md, DESIGN.md, HANDOFF.md, docs/*, composer.tsx, edit-dish-sheet.tsx, workspace.tsx, kkb-view.tsx, src/lib/kkb.ts, schema.ts, routes, mutations, permissions, events, tests) → audit (browser inspection where available; otherwise report the limitation and separate code-review findings from observed behaviour) → audit + plan (file-level plan, migrations, realtime, tests, dependencies, risks); no major implementation before review → implement by phase → verify each phase (lint, typecheck, tests, build, mobile, a11y, realtime, regressions) → document results; never claim testing that was not executed.

# 13. Definition of Done
Product: communicates the dining-coordination purpose; narrative matches released capabilities; journey feels connected. Usability: audit complete; critical issues fixed; workflows discoverable; usable on mobile; a11y validated. Ordering: variants/instructions easy; basic ordering fast; shared prices consistent; unavailable food safe; confirmed history reliable. Tracking: partial deliveries; outstanding easy to find; served quantities accurate; participants see updates. Collaboration: notifications reliable; read states persist; realtime in sync; permissions enforced. Billing: KKB accurate; missing prices identified; receipt discrepancies visible; summaries shareable. Engineering: tests pass; existing behaviour preserved; DB changes safe; realtime/concurrency satisfied; no unresolved critical regression.

# 14. Final Product Direction
Salo should not compete with Notes by offering more elaborate checkboxes. It should reduce the manual coordination work groups do before, during, and after a shared meal, keeping orders, quantities, attribution, corrections, serving progress, and expenses connected. **The goal is not to make Salo feature-rich. The goal is to make shared dining easier.**

# Salo v1.4 brief (owner, 2026-11-23, verbatim)

Owner's message: "I want you to look into the implementation brief:"

# Salo v1.4 — Comprehensive Implementation Brief

**Project:** Salo — Shared Dining Coordination  
**Repository:** `thekovie/salo`  
**Application:** https://salo.thekovie.com/  
**Target Version:** v1.4  
**Status:** Proposed for implementation  
**Primary Objective:** Improve billing accuracy, pricing usability, collaborative food tracking, PWA continuity, and overall dining coordination without compromising Salo's simplicity.

---

# 1. Product Vision

Salo is a lightweight, collaborative dining coordination application for friends, families, and coworkers.

Its purpose is to help groups organize their restaurant orders, communicate them accurately to the waiter, monitor food arrivals, and determine how much everyone owes.

**Existing tagline:**

*One table. Everyone's order.*

**Extended value proposition:**

*Order together, track what's served, and settle everyone's share—all in one place.*

Salo should continue supporting the following core journey:

**Collect → Confirm → Track → Reconcile → Settle**

The application must remain:

- Mobile-first and PWA-friendly.
- Fast enough to use while dining.
- Accessible to users with varying levels of technical familiarity.
- Usable without creating an account.
- Suitable for both individual hosts and larger groups.
- Reliable under intermittent mobile connectivity.
- Simple for users who only need collaborative ordering.

The objective of v1.4 is not to transform Salo into a restaurant POS, financial management system, or food-delivery application.

Every improvement must directly support the dining coordination experience.

---

# 2. Existing Architecture and Implementation Constraints

Before implementing any feature, inspect the current repository.

Review:

- `AGENTS.md`
- `PRODUCT.md`
- `DESIGN.md`
- `HANDOFF.md`
- `PROJECT_LOG.md`
- `docs/architecture.md`
- `docs/data-model.md`
- `docs/api.md`
- `docs/realtime.md`
- `docs/security.md`
- `docs/ux-specification.md`
- Relevant existing tests and migrations.

## 2.1 Current technology

The existing application uses:

- Next.js with React and TypeScript.
- PostgreSQL with Drizzle ORM.
- Server-Sent Events for realtime coordination.
- An installable Progressive Web App.
- Existing session and participant identity mechanisms.
- Optimistic mutations, idempotency, and direct-save workflows.
- Coolify-based self-hosted deployment.

Preserve this architecture unless a concrete limitation makes a change necessary.

Do not introduce additional infrastructure, authentication systems, databases, or state-management frameworks without justification.

## 2.2 Existing features that must be preserved

- Session creation and joining through invite links or QR codes.
- Host and guest participation.
- Individual and group order attribution.
- Collaborative dish entry.
- Dish variants and preparation instructions.
- Consolidated waiter tickets.
- Confirmed rounds and immutable snapshots.
- Corrections, replacements, and unavailable-item handling.
- Realtime synchronization and offline change handling.
- Food arrival tracking.
- In-app notifications.
- Session-scoped shared prices.
- Individual price overrides.
- KKB calculation and service-charge allocation.
- Receipt-total comparison.
- Pricing-completeness indicators.
- Copyable and shareable order summaries.
- Mobile-first interface and accessibility improvements.

Do not rebuild functionality that is already present.

## 2.3 Architecture principles

1. Preserve confirmed waiter tickets as immutable historical records.
2. Use one authoritative effective-order calculation.
3. Separate food/order state from monetary settlement state.
4. Preserve user-entered prices and corrections.
5. Use integer centavos for monetary calculations.
6. Require explicit user intent for consequential changes.
7. Make offline failures and unresolved operations visible.
8. Enforce permissions on the server.
9. Maintain compatibility with existing sessions and stored records.
10. Keep features optional when not relevant to a dining session.

---

# 3. Phase 0 — Mandatory Technical and UI/UX Audit

**Priority: P0**

No major implementation should begin before evaluating the latest repository state.

The previous v1.3 implementation included substantial architectural and interface changes. The new features must integrate into those changes rather than create parallel systems.

## 3.1 Technical audit

Inspect:

- Session and participant models.
- Existing role and capability checks.
- Food tracking and serving mutations.
- Concurrent serving updates.
- Entry settlements and shared pricing.
- KKB computation and service charges.
- Receipt reconciliation.
- Confirmation and correction workflows.
- Notifications.
- Existing sharing and export functionality.
- PWA manifest, invitations, and session resumption.
- Reconnect handling and idempotency.
- Database integrity and migration patterns.

Identify which proposed features can reuse current models, APIs, and UI components.

## 3.2 UI/UX audit

Evaluate these user journeys:

1. Host creates an order.
2. Guest joins through a link or QR code.
3. Participants add dishes and variants.
4. Participants review their orders.
5. Host confirms the round.
6. Group tracks food arrivals.
7. Host enters missing prices.
8. Restaurant provides the actual bill.
9. Host records discounts and adjustments.
10. Guests review their individual KKB.
11. Group settles outstanding balances.
12. Session ends or is transferred to another host.

Review at minimum:

- 320px
- 360px
- 375px
- 390px
- 430px
- Tablet layouts
- Desktop layouts

Check mobile keyboard behavior, sticky controls, sheet and drawer accessibility, screen-reader labeling, focus restoration, contrast, touch-target sizes, and dense order lists.

## 3.3 Required audit deliverables

Before coding, produce:

- A technical gap assessment.
- A UI/UX audit report.
- A feature-to-existing-component mapping.
- A proposed database and API change plan.
- A prioritized implementation sequence.
- A regression-risk assessment.

Clearly distinguish observations verified through code inspection, browser testing, and real-device testing.

Do not claim real-user validation unless actual users participated.

---

# 4. Feature Implementation Requirements

## F01 — Pricing Visibility and Quick Entry

**Priority: P0**  
**Category:** UX / Billing

### Problem

Salo supports per-entry prices and shared preparation prices, but price-entry actions may not be sufficiently prominent.

Users can complete their orders without realizing that the host still needs to enter prices before KKB becomes accurate.

### Requirements

Introduce a prominent but non-intrusive pricing entry point after round confirmation.

The host should see:

- Pricing completeness.
- Number of unpriced preparations.
- A clearly labeled **Enter prices** action.
- Direct access to unresolved prices.
- A clear indication when pricing is complete.

Implement a compact quick-entry interface.

It should:

- Prioritize unpriced preparations.
- Display dish names and variants.
- Display quantities.
- Allow inline price entry.
- Reuse existing shared-price defaults.
- Respect per-entry overrides.
- Show inherited prices clearly.
- Preserve incomplete values when connectivity fails.
- Show save and conflict states.

Do not require prices before confirming orders.

### Acceptance criteria

- The host can identify missing prices without navigating through multiple tabs.
- The host can enter several prices quickly on mobile.
- A shared preparation price correctly propagates to eligible entries.
- Existing overrides remain unchanged.
- Guests can identify whether their KKB is incomplete.
- Pricing reminders do not interrupt ordering.

---

## F02 — Receipt Discounts and Adjustments

**Priority: P0**  
**Category:** Billing

### Problem

Restaurants frequently apply discounts after the meal, including:

- Senior citizen discounts.
- PWD discounts.
- Restaurant privilege-card benefits.
- Promotions.
- Other restaurant-issued adjustments.

The current receipt reconciliation primarily compares the calculated amount against the restaurant's actual total.

It does not comprehensively represent these adjustments.

### Requirements

Allow the host to record adjustments based on the restaurant's final receipt.

Support:

- Fixed-amount discounts.
- Percentage-based discounts where the applicable basis is known.
- Additional charges.
- Credits and other adjustments.
- Optional adjustment descriptions.

Suggested categories:

- Senior citizen
- PWD
- Privilege card
- Promotion
- Other

Categories are descriptive labels, not automatic eligibility determinations.

### Critical accounting rule

The restaurant's final receipt is authoritative.

If the host enters a final receipt total that already includes a discount, Salo must not subtract that discount again.

Separate:

1. Original calculated subtotal.
2. Recorded adjustments.
3. Calculated adjusted total.
4. Actual restaurant receipt total.
5. Reconciliation discrepancy.

Never silently force a discrepancy to zero.

### Non-goals

Do not implement a statutory eligibility engine or automatically compute senior/PWD tax benefits without all necessary information.

Do not store senior/PWD identification numbers, images, or supporting documents.

### Acceptance criteria

- Host can record and edit adjustments.
- Adjustments affect final KKB only when explicitly allocated.
- Discounts cannot be applied twice.
- Calculated and actual totals remain independently visible.
- All calculations use integer centavos.
- Historical orders and original prices remain intact.

---

## F03 — Flexible Discount Allocation

**Priority: P0**  
**Category:** Billing

### Problem

When a restaurant grants a discount, the benefit may apply to the entire table or only specific individuals.

The system must not assume that every discount should be equally distributed.

### Requirements

Support these allocation methods:

**A. Proportional allocation**

Distribute the amount according to the participants' eligible food subtotals.

Useful for whole-table privilege-card promotions.

**B. Equal allocation**

Divide the discount equally among selected participants.

**C. Individual allocation**

Assign the discount to one participant.

Useful when a discount belongs to an eligible individual's consumption.

**D. Manual allocation**

Let the host specify exact amounts for selected participants.

**E. Unallocated**

Preserve the adjustment as unresolved until the host decides.

### Calculation rules

- Use integer centavos.
- Distribute rounding remainders deterministically.
- Never allocate a larger discount than the eligible amount without explicit handling.
- Do not create negative payable balances by accident.
- Preserve original per-person subtotals.
- Display how each discount affects each participant.
- Distinguish discount beneficiaries from the people paying the final bill.

### Acceptance criteria

- Final allocations reconcile with the applicable restaurant total.
- An unresolved adjustment is visibly marked incomplete.
- Changing allocation methods does not duplicate the discount.
- Participants can see the adjustments affecting their share.
- No hidden discount redistribution occurs.

---

## F04 — Collaborative Food Tracking and Co-hosts

**Priority: P0**  
**Category:** Collaboration / Permissions

### Problem

Currently, food tracking is primarily managed by the host.

For larger dining groups, this creates an unnecessary bottleneck.

### Proposed solution

Introduce an optional **Co-host** role.

Co-hosts assist with food tracking but do not receive complete administrative privileges.

### Permission model

| Capability | Host | Co-host | Guest |
|---|---|---|---|
| Add dishes | Yes | Yes | Yes |
| View orders | Yes | Yes | Yes |
| View serving status | Yes | Yes | Yes |
| Update serving quantities | Yes | Yes | No |
| Undo serving updates | Yes | Yes | No |
| Confirm rounds | Yes | No | No |
| Correct confirmed orders | Yes | No | No |
| Manage participants | Yes | No | No |
| Manage billing adjustments | Yes | No | No |
| Assign co-hosts | Yes | No | No |
| End session | Yes | No | No |

### Requirements

The host can:

- Promote guests to co-hosts.
- Revoke co-host permissions.
- View which participants are co-hosts.

Co-hosts can:

- Mark portions as served.
- Update partial-serving quantities.
- Undo incorrect serving updates.
- View serving progress.

### Technical requirements

- Implement explicit capability checks such as `serving.update`.
- Enforce permissions in server-side mutations.
- Revalidate capabilities on every write.
- Ensure revoked co-hosts cannot continue updating food.
- Handle simultaneous serving changes atomically.
- Clamp served quantities to valid bounds.
- Preserve idempotency on retries.
- Record the actor responsible for serving updates when practical.

### Non-goal

Do not allow guests to independently mark their personal portions as received in this phase.

That requires a more granular per-participant serving model and should be evaluated separately.

---

## F05 — Multiple Receipt Reconciliation

**Priority: P1**  
**Category:** Billing

### Problem

Restaurants may issue separate receipts for senior/PWD diners or privilege-card transactions.

This usually happens after ordering, when the waiter prepares the final bill.

### Requirements

Allow one dining session to record multiple restaurant receipts.

Each receipt should support:

- Optional descriptive label.
- Actual total amount.
- Associated participants or relevant allocations.
- Recorded adjustments.
- Reconciliation status.

Example:

- Main table receipt
- Senior citizen receipt
- PWD receipt

The receipts should be created when needed, not before ordering.

### Safeguards

- Never double-count the same item or payment obligation.
- Never assume a separate receipt automatically belongs entirely to one participant.
- Keep unassigned amounts visible.
- Ensure total receipt amounts reconcile with participant obligations.
- Preserve the standard single-receipt workflow as the default.

Avoid building a complete billing-group engine unless the simpler receipt-based approach proves insufficient.

---

## F06 — Shared Dish Cost Splitting

**Priority: P1**  
**Category:** KKB

### Problem

Shared food is common in family and group dining.

A single dish may be ordered by one person but consumed and paid for by several people.

### Requirements

Allow the host to allocate a shared item's cost among selected participants.

Initially support:

- Equal division.
- Selected participants.
- Explicit payer assignment.

Custom amounts may be implemented if necessary to support actual dining scenarios.

### Rules

- Preserve the original source order.
- Do not change the waiter ticket.
- Separate who submitted the order from who pays.
- Prevent duplicate billing.
- Recalculate shares when the item's price changes.
- Handle cancellation and replacement correctly.
- Use deterministic rounding.

Shared-cost allocation must also be compatible with receipt discounts.

A participant sharing the cost of food does not automatically establish eligibility for a statutory discount.

---

## F07 — Payment Settlement Tracking

**Priority: P1**  
**Category:** KKB / Settlement

### Problem

Salo calculates what participants owe but does not comprehensively track whether they have paid.

### Requirements

Introduce optional settlement tracking after billing amounts are finalized.

Support:

- Unpaid
- Partially paid
- Paid

Allow the authorized host to record:

- Payment amount.
- Payer.
- Recipient or payee, when relevant.
- Optional payment method.
- Optional note.

Show:

- Total obligation.
- Amount paid.
- Remaining balance.

### Safeguards

Do not reset recorded payments if a bill changes.

Instead, recalculate the remaining balance.

Avoid allowing ordinary guests to mark themselves paid without an explicit authorization mechanism.

### Non-goals

- No GCash or Maya integration.
- No payment processing.
- No stored card information.
- No bank-account management.

---

## F08 — Participant Order Verification Improvements

**Priority: P1**  
**Category:** Ordering UX

### Problem

Participants should be able to verify their orders before the host confirms them with the waiter.

Existing readiness functionality already addresses part of this.

### Requirements

Improve the existing readiness workflow rather than introducing a duplicate confirmation system.

Provide a convenient **My order** review showing:

- Dish names.
- Quantities.
- Variants.
- Preparation notes.
- Assigned participant.
- Current round.
- Readiness status.

Allow participants to:

- Correct their draft items when permitted.
- Identify mistakes before confirmation.
- Clearly indicate readiness.

The host should see which participants have responded.

Readiness must remain appropriately scoped to the active round.

Do not add mandatory confirmation steps for guests who are not actively participating.

---

## F09 — Host Transfer and Recovery

**Priority: P1**  
**Category:** Session Management

### Problem

Salo depends on one host for consequential actions.

If that participant leaves or loses access to their device, coordination may become difficult.

### Requirements

Introduce an explicit host-transfer workflow.

The current host should be able to:

1. Select another active participant.
2. Review the transfer consequences.
3. Confirm the transfer.
4. Relinquish host authority.

The new host should receive the appropriate capabilities immediately.

### Security requirements

- Only the active host can initiate a normal transfer.
- Transfer must be atomic.
- Never allow two primary hosts accidentally.
- Update permissions across connected devices.
- Reject stale writes from the former host.
- Record the transfer event.

Lost-device recovery should be evaluated separately.

Do not implement insecure automatic takeover, predictable PINs, or unrestricted host reassignment.

---

## F10 — PWA Deep Linking and Invite Continuity

**Priority: P1**  
**Category:** PWA / Mobile UX

### Problem

Users who installed Salo as a PWA may still open shared invitations through a browser.

This interrupts the installed-app experience.

### Requirements

Review the PWA manifest and invite routing.

Where supported:

- Define the proper PWA scope.
- Support installed-app link capture.
- Evaluate launch-handler behavior.
- Preserve the destination invitation.
- Avoid opening unnecessary duplicate application windows.

### Android

Test link handling through:

- Chrome.
- Messenger.
- Other external applications.
- Installed Salo PWA.

Use supported browser and OS mechanisms.

Do not assume every Android application will automatically hand off links to the installed PWA.

### iOS

Maintain a reliable browser fallback.

Do not claim ordinary external HTTPS links can always force-launch a Home Screen PWA.

Consider:

- Clear installed-app guidance.
- Session resumption.
- Invite continuity.
- Browser/PWA storage isolation.

Never use an unreliable custom URI scheme solely to imitate native deep linking.

### Acceptance criteria

- Invitations open the correct session.
- Installed PWA launch works where supported.
- Browser fallback remains usable.
- No invite codes are lost.
- Existing sessions are not silently overwritten.
- Android and iOS behavior is documented accurately.

---

## F11 — Pricing and Billing UX Consistency

**Priority: P1**  
**Category:** UI/UX

### Problem

Introducing discounts, receipt adjustments, and settlement features may create a fragmented interface if each feature adds a separate screen or navigation entry.

### Requirements

Treat pricing and settlement as one connected workflow.

Recommended sequence:

1. Complete missing prices.
2. Review the restaurant's actual receipt.
3. Record discounts and other adjustments.
4. Allocate the amounts.
5. Review final individual shares.
6. Optionally record payments.

This should not be a mandatory wizard.

Users should be able to jump directly to relevant actions.

### UX principles

- Surface the next appropriate action contextually.
- Avoid excessive tabs.
- Avoid permanent warning banners.
- Use plain-English terminology.
- Distinguish estimates from final obligations.
- Display unresolved amounts explicitly.
- Keep guest KKB access straightforward.
- Preserve host and guest navigation consistency.

Use existing Salo design components whenever practical.

---

## F12 — Offline and Realtime Reliability Improvements

**Priority: P1**  
**Category:** Engineering / Reliability

### Problem

Additional collaborative features introduce more concurrent mutations and financial state.

The existing realtime and reconnect architecture must be validated against these requirements.

### Requirements

Audit and strengthen:

- Server-Sent Events delivery.
- Reconnection behavior.
- Offline change queues.
- Direct-save retries.
- Idempotency keys.
- Concurrent serving updates.
- Notification read-state synchronization.
- Stale price revisions.
- Simultaneous adjustment changes.
- Conflict handling.
- Session revision behavior.

### Critical scenarios

Test:

- Two co-hosts mark the same dish served simultaneously.
- Host revokes a co-host while an update is pending.
- A discount save succeeds but its response is lost.
- The client retries a saved receipt adjustment.
- Two devices edit the same bill.
- The host switches networks during settlement.
- A participant reconnects after several corrections.
- An order closes while changes remain queued.

### Acceptance criteria

No duplicate serving increments, duplicated discounts, lost payments, silently overwritten prices, or invalid totals.

Preserve existing working infrastructure and apply targeted improvements only.

---

## F13 — Completed-Session Export

**Priority: P2**  
**Category:** Sharing / History

### Problem

After a dining session ends, users may want a permanent record before the session expires.

### Requirements

Extend existing sharing features to optionally include:

- Session name.
- Dining date.
- Confirmed orders.
- Corrections.
- Final serving status.
- Individual KKB.
- Recorded discounts.
- Final receipt totals.
- Payment settlement status, if available.

Use existing text/image sharing functionality where suitable.

A printable or PDF export may be considered if there is sufficient demand.

Do not require accounts or permanent cloud history.

Preserve the existing retention policy.

---

## F14 — Large-Order Navigation and Usability

**Priority: P2**  
**Category:** UI/UX

### Problem

Large tables can accumulate numerous entries, corrections, rounds, and served records.

### Requirements

Evaluate usability with realistic large dining sessions.

Potential improvements:

- Search or filtering for preparations.
- Collapsible sections.
- Prioritization of outstanding food.
- Improved round navigation.
- Faster access to individual participant orders.
- Clearer correction-history references.
- More compact summary cards.
- Reduced repetitive scrolling.

Do not implement every possible filter.

Only retain enhancements that measurably improve large-order navigation.

Maintain accessibility and keyboard focus when rows or sections change dynamically.

---

## F15 — Logo Redesign and Brand Identity Refresh

**Priority: P2 — Final Implementation Phase**  
**Category:** Branding / Visual Identity

### Problem

Salo's existing logo resembles a messaging application because its round-table concept incorporates speech-bubble imagery.

The visual identity should communicate shared dining more clearly.

### Recommended direction

**The Shared Table**

A minimalist top-down illustration of a circular dining table with three or four plates and an optional central serving dish.

The logo should visually communicate people gathering around one table.

### Design requirements

- Remove speech-bubble silhouettes.
- Avoid chat/message icons.
- Avoid generic fork-and-spoon restaurant branding.
- Preserve Salo's tomato-red and warm-paper palette.
- Use simple, recognizable geometry.
- Remain identifiable at small sizes.
- Support light and dark contexts.
- Work in monochrome.
- Support maskable PWA icons.

### Required deliverables

- Primary logo.
- Compact icon.
- Favicon.
- Apple touch icon.
- PWA icons.
- Maskable icon.
- Light and dark variants.
- Monochrome variant.

### Implementation requirements

Update relevant existing assets and metadata without unnecessarily changing the application's UI architecture.

Maintain the existing name and tagline:

**Salo — One table. Everyone's order.**

Do not replace the established typography, layout system, or application color palette unless a specific compatibility issue requires it.

### Implementation timing

This feature must be implemented **last**, after functional development, regression testing, and usability validation.

Complete the branding refresh as a separate focused change before the final release.

---

# 5. Data Model and API Design

Do not immediately create all proposed tables.

First inspect the existing Drizzle schema and determine which entities can be extended safely.

Potential concepts include:

- Participant capabilities or roles.
- Serving-update actor metadata.
- Receipt adjustments.
- Adjustment allocations.
- Multiple receipt records.
- Shared-item cost allocations.
- Settlement payment records.
- Host-transfer history.

## 5.1 Financial data separation

The application must distinguish:

**Original order**

What was entered and confirmed.

**Effective order**

The confirmed quantities after applicable communicated corrections.

**Price**

The applicable unit price and existing overrides.

**Cost allocation**

Which participants are responsible for paying for a food item.

**Adjustment**

A restaurant-issued credit, discount, or additional charge.

**Receipt**

The actual amount charged by the restaurant.

**Payment**

Money already paid toward an obligation.

Do not collapse these independent concerns into one mutable amount.

## 5.2 Monetary invariants

Establish explicit invariants for:

- Sum of allocated item costs.
- Sum of recorded adjustments.
- Sum of participant obligations.
- Sum of restaurant receipt totals.
- Sum of recorded payments.
- Remaining outstanding balances.

Handle incomplete pricing separately from mathematical zero.

For example, an unpriced dish must never be treated as a free dish.

## 5.3 Migration requirements

- Prefer additive migrations.
- Preserve existing session and settlement records.
- Avoid destructive backfills.
- Maintain existing foreign-key and retention behavior.
- Ensure new records are removed under session cleanup policies.
- Include database-level integrity checks where appropriate.

---

# 6. Roles and Authorization

Extend the existing permission system using capabilities rather than relying exclusively on role-name comparisons.

Recommended capabilities:

- `serving.view`
- `serving.update`
- `participant.cohost.assign`
- `participant.cohost.revoke`
- `billing.price.update`
- `billing.adjustment.update`
- `billing.allocation.update`
- `billing.receipt.update`
- `settlement.record`
- `session.host.transfer`

Use the existing permission conventions and adapt naming to the repository.

All sensitive mutations must be checked server-side.

Do not assume a disabled button is sufficient authorization.

The host should remain the only participant with full administrative authority.

---

# 7. Notifications and Realtime Events

Reuse the existing notification center and realtime architecture.

Potential new events:

- Co-host assigned.
- Co-host revoked.
- Host transferred.
- Receipt adjustment recorded.
- Shared cost allocation updated.
- Final KKB recalculated.
- Payment status updated.

Avoid generating notifications for every minor price-field change.

Notifications should be meaningful, targeted, and non-redundant.

A participant whose final payable amount changes should be able to understand what changed.

Do not send repeated alerts for the same underlying event.

---

# 8. Comprehensive Testing Requirements

## 8.1 Unit tests

Cover:

- Shared preparation price inheritance.
- Individual overrides.
- Discount allocation.
- Exact-cent rounding.
- Negative or excessive adjustment prevention.
- Multiple receipt reconciliation.
- Shared-item allocation.
- Partial payments.
- Remaining-balance computation.
- Capability resolution.
- Effective-order consistency.

## 8.2 Integration tests

Cover:

- Role promotion and revocation.
- Host transfer.
- Authorized and unauthorized writes.
- Concurrent serving updates.
- Receipt adjustment persistence.
- Idempotent mutations.
- Session cleanup.
- Database constraints.
- Realtime propagation.

## 8.3 End-to-end tests

Include at least these scenarios:

1. One host records a simple order without using KKB.
2. Several guests add dishes and confirm readiness.
3. Host enters missing prices after confirmation.
4. A restaurant gives a whole-table privilege-card discount.
5. One participant receives an individual discount.
6. Restaurant issues two separate receipts.
7. Several participants split a shared platter.
8. Two co-hosts update serving counts.
9. Host revokes a co-host while they are active.
10. Group tracks partial and full payments.
11. Host transfers control to another participant.
12. Android user opens a session invitation with the PWA installed.
13. iPhone user opens an invitation through Messenger.
14. User loses connectivity while editing a bill.
15. Session ends and a final summary is shared.

## 8.4 Accessibility and responsive testing

Validate:

- 320px through desktop widths.
- Dark and light mode.
- Touch targets.
- Keyboard navigation.
- Focus restoration.
- Screen-reader announcements.
- Reduced motion.
- Virtual keyboard behavior.
- Long dish names.
- Large participant lists.
- Empty, partial, complete, and error states.

Target WCAG 2.2 AA.

## 8.5 Real-world validation

Conduct a real dining pilot with approximately 7–12 participants.

Observe:

- Ordering completion time.
- Incorrect orders and corrections.
- Food tracking accuracy.
- Number of host interventions.
- Pricing completion time.
- Difficulty entering receipt discounts.
- Accuracy of final KKB allocations.
- Guest understanding of amounts owed.
- Whether participants would choose Salo over Notes or Messenger.

Do not fabricate usability results.

---

# 9. Implementation Roadmap

## Phase 0 — Audit and Architecture Review

- Complete repository audit.
- Identify reusable components.
- Validate current KKB calculations.
- Define the permission model.
- Produce file-level implementation plans.
- Resolve architectural questions before migrations.

## Phase 1 — Pricing Experience

**F01 and relevant F11 work**

Deliver:

- Prominent pricing entry point.
- Missing-price checklist.
- Quick-entry interface.
- Improved pricing status indicators.
- Consistent price-editing UX.

## Phase 2 — Discounts and Receipt Adjustments

**F02 and F03**

Deliver:

- Receipt adjustments.
- Discount categories.
- Allocation methods.
- Accurate final payable calculation.
- Reconciliation safeguards.

## Phase 3 — Collaborative Serving

**F04**

Deliver:

- Co-host role.
- Promote/revoke actions.
- Serving capabilities.
- Concurrent update protection.
- Realtime status propagation.

## Phase 4 — Advanced KKB

**F05 and F06**

Deliver:

- Multiple receipt support.
- Shared dish cost allocation.
- Accurate cross-receipt reconciliation.

## Phase 5 — Payment Settlement

**F07**

Deliver:

- Optional payment recording.
- Partial payment support.
- Outstanding balance computation.
- Payment status display.

## Phase 6 — Session Coordination

**F08 and F09**

Deliver:

- Improved personal order verification.
- Host transfer.
- Safe permission transitions.
- Recovery architecture assessment.

## Phase 7 — PWA and Reliability

**F10 and F12**

Deliver:

- Improved installed-PWA link handling.
- Invite continuity.
- Android/iOS testing.
- Reconnect and concurrency regression fixes.

## Phase 8 — UX and Export Refinements

**Remaining F11, F13, and F14**

Deliver:

- Billing workflow consistency.
- Optional completed-session export.
- Validated large-order usability improvements.
- Final accessibility audit.

## Phase 9 — Functional Validation and Stabilization

Before branding work:

- Complete full regression testing.
- Validate financial calculations.
- Verify data integrity.
- Conduct mobile device testing.
- Conduct real-table usability testing.
- Address critical defects.
- Validate production deployment and backups.

## Phase 10 — Logo and Brand Refresh

**F15 — FINAL PHASE**

Deliver:

- New Shared Table logo.
- Updated icon assets.
- Favicon and PWA branding.
- Light, dark, and maskable variants.
- Final visual consistency review.

No major functional changes should be bundled into this phase.

---

# 10. Explicit Non-goals

The following are not part of this implementation:

- Restaurant POS integration.
- Restaurant-managed digital menus.
- AI receipt scanning.
- Automatic statutory eligibility verification.
- Payment gateway processing.
- Bank or e-wallet integrations.
- Public restaurant profiles.
- Loyalty systems.
- Mandatory user accounts.
- Permanent personal transaction history.
- Full-featured group expense accounting.
- Restaurant inventory management.
- General-purpose messaging.
- Native mobile app development.

These can only be reconsidered if validated user needs justify them.

---

# 11. Definition of Done

A feature is complete only when:

1. Its intended user workflow works end to end.
2. Existing ordering behavior remains intact.
3. Host and guest permissions are correct.
4. Its data model and API contracts are documented.
5. Financial calculations are mathematically consistent.
6. Concurrent and offline behavior is handled.
7. Accessibility requirements are satisfied.
8. Responsive layouts are verified.
9. Unit, integration, and E2E tests pass.
10. Relevant documentation is updated.
11. Critical regressions are resolved.
12. The change has been reviewed and approved before merging.

Successful compilation alone is not sufficient.

---

# 12. Instructions for GitHub Copilot

Before implementing anything:

1. Read the repository's existing project instructions and architecture documentation.
2. Review the latest code, not assumptions from previous versions.
3. Compare each requested feature with existing functionality.
4. Identify redundant or unnecessary implementations.
5. Produce a technical assessment and actionable implementation plan.
6. Describe proposed database changes and financial invariants.
7. Identify affected components and API routes.
8. Present the sequence of work for review.

During implementation:

- Work incrementally, following repository branch and PR conventions.
- Keep features isolated where possible.
- Avoid unrelated refactors.
- Prefer existing components and utilities.
- Preserve backward compatibility.
- Do not silently change confirmed orders.
- Do not introduce unnecessary dependencies.
- Maintain strong typing and explicit validation.
- Run the repository's existing quality checks.
- Add focused tests for every consequential change.
- Update documentation after each completed phase.

Before merging:

- Report exactly which files changed.
- Explain any migrations.
- Summarize the implemented user-facing behavior.
- Report tests run and their actual results.
- Document remaining limitations or known issues.
- Identify any manual production validation required.

**Do not begin a broad implementation until the Phase 0 findings and architecture plan have been reviewed.**

---

# 13. Final Product Direction

Salo should become a more complete dining coordination application without losing the simplicity that makes it useful.

The next release must improve four fundamental outcomes:

**Ordering:** Everyone's food is recorded correctly.

**Tracking:** Authorized participants can coordinate food arrivals without relying entirely on the host.

**Billing:** Restaurant discounts, separate receipts, and shared expenses can be reflected fairly and accurately.

**Settlement:** Everyone understands what they owe and, when needed, whether they have paid.

The PWA experience must remain reliable and accessible, while the final branding refresh should make Salo immediately recognizable as a shared dining application.

**Guiding principle:**

*Make shared dining easier—not more complicated.*

**Salo — One table. Everyone's order.**

---

# Salo v1.4 — Implementation Brief Addendum

**Implementation agent:** Claude Code  
**New features:** F16 and F17  
**Branding:** F15 must remain the final implementation phase.

This addendum extends the existing Salo v1.4 Comprehensive Implementation Brief. All prior feature requirements (F01–F15), architectural constraints, and acceptance criteria remain in effect.

---

## F16 — Restaurant Menu Link Sharing & URL Safety

**Priority:** P1  
**Category:** Dining UX / Security

### Objective

Allow the host to provide an optional restaurant menu URL that guests can easily access while ordering.

The purpose is to reduce the need for participants to independently search for the restaurant menu or repeatedly ask the host for it.

This is a link-sharing feature, not restaurant menu integration.

### Functional requirements

**Host capabilities**

- Add a restaurant menu URL.
- Edit or remove the URL.
- See the current URL and its validation status.
- Optionally provide a short menu label, such as "Main Menu" or "Drinks Menu".
- Share the same link with all participants through the session.

**Guest capabilities**

- View the current restaurant menu link.
- Open the menu externally.
- See the destination domain before opening it.
- Receive realtime updates when the host changes or removes the link.

**Placement**

- Provide menu management within the host's session options.
- Show a discoverable **View menu** action near the top of the Order screen when a menu link is available.
- Avoid adding a permanent navigation tab.
- Do not display empty menu controls when no URL is configured.

### URL validation and safety

Treat all host-submitted URLs as untrusted input.

Implement the following safeguards:

1. Validate URLs server-side using a standards-compliant URL parser.
2. Allow only HTTPS destinations by default.
3. Reject unsupported protocols, including `javascript:`, `data:`, `file:`, and custom URI schemes.
4. Reject embedded credentials and malformed hostnames.
5. Reject localhost, loopback, private, link-local, and reserved IP destinations, including non-obvious encoded IPv4 and IPv6 representations.
6. Apply sensible URL-length limits.
7. Store the validated URL as plain data, not executable markup.
8. Render link labels as escaped text.
9. Never inject the URL into unsafe HTML.
10. Rate-limit menu URL changes.
11. Apply host-only authorization for add, edit, and removal operations.

**Avoid server-side URL fetching unless strictly necessary.**

For the initial implementation, do not crawl the menu website, download menu files, fetch Open Graph metadata, or follow arbitrary redirects from Salo's backend.

If server-side fetching is later justified, implement a dedicated SSRF-resistant fetch mechanism with destination validation, redirect controls, DNS rebinding protections, timeouts, and response-size limits.

### Malicious URL detection

Evaluate optional integration with an established malicious-URL reputation service.

Requirements:

- Evaluate provider terms, pricing, latency, and privacy implications before selecting one.
- Check URLs when created or changed.
- Block links identified as malicious.
- Define an explicit policy for lookup failures or unavailable verdicts.
- Never treat a URL with no known threat match as guaranteed safe.
- Do not advertise links as "verified safe".
- Prefer wording such as "Link checked" or display the destination domain.
- Do not claim to have performed reputation checking when only URL-format validation occurred.

The reputation service must not become an unnecessary dependency that makes ordinary order creation unreliable.

### External-link behavior

- Open links only through deliberate user interaction.
- Do not automatically navigate guests to the host's chosen website.
- Do not embed arbitrary restaurant websites in an iframe.
- Avoid routing external websites through a Salo-hosted open redirect.
- Show the domain or clear external-link indication.
- Apply `rel="noopener noreferrer"` when opening a new browser context.
- Provide a way for users to report a suspicious menu URL.

### Data and API

Inspect the current session model first.

Prefer a small additive change, such as an optional session-scoped menu URL, rather than introducing a complete restaurant or menu database.

Ensure:

- Host-only mutation.
- Appropriate validation.
- Realtime synchronization.
- Safe removal.
- Existing retention behavior.
- No effect on confirmed order history or KKB.

### Tests

Cover:

- Valid HTTPS restaurant URLs.
- Invalid and unsupported schemes.
- Embedded credentials.
- Localhost and private network destinations.
- IPv6 and encoded-IP edge cases.
- Malformed and excessive-length URLs.
- Unauthorized guest updates.
- Host editing/removing a URL.
- Realtime propagation to guests.
- Reputation-service errors when enabled.
- Safe external-link behavior.
- Mobile accessibility.

### Non-goals

- Menu scraping.
- Restaurant menu synchronization.
- Product catalogs.
- Automatic dish extraction.
- Menu image hosting.
- Restaurant accounts.
- Ordering directly through the restaurant website.
- Guaranteed malware-free external browsing.

---

## F17 — Animated Room Creation and Bot-Verification Experience

**Priority:** P1  
**Category:** UX / Motion / Onboarding

### Objective

Improve the visual experience while Cloudflare Turnstile verifies the request and Salo creates a new dining session.

The existing generic loading state should feel more polished, welcoming, and aligned with Salo's dining identity.

### Existing implementation

Inspect and preserve:

- `src/components/landing/start-form.tsx`
- `src/components/landing/bot-check.tsx`
- `src/server/auth/turnstile.ts`
- The `/new` route
- The session creation API and existing Turnstile tests.

Do not replace the existing security verification merely for visual design purposes.

### Proposed animation

Create a lightweight, original animation based on Salo's shared-table identity.

Suggested direction:

- A top-down circular dining table.
- Small plates or serving elements appearing or moving gently.
- Warm tomato-red and cream colors.
- Subtle, smooth transitions.
- Minimal visual complexity.
- No large animated backgrounds.

Use CSS or lightweight SVG animation where practical.

Avoid adding a substantial animation dependency solely for this screen.

### User-visible states

**State 1 — Verification**

Primary message:

"Preparing your table…"

Supporting message:

"Just a quick security check before we start."

Show the existing Turnstile widget when user interaction is required.

**State 2 — Room creation**

Primary message:

"Setting up your table…"

Supporting message:

"Getting everything ready for your order."

**State 3 — Success**

Transition directly to the created dining session.

A brief transition may be shown if it does not delay navigation.

**State 4 — Error**

Provide a clear explanation and actionable retry option.

Examples:

- Verification could not finish.
- Connection was lost.
- Session creation failed.

Do not replace meaningful error messages with decorative animation.

### Security requirements

- Preserve Cloudflare Turnstile.
- Preserve server-side Siteverify validation.
- Continue checking the configured action and hostname.
- Preserve session-creation rate limiting.
- Preserve idempotency behavior.
- Handle token expiry and failed verification.
- Never treat animation completion as proof of verification.
- Never bypass verification when Turnstile fails.
- Never display a fake success state before the server confirms room creation.

### Performance requirements

- Do not introduce artificial waiting periods.
- Start verification as early as practical.
- Keep animation lightweight.
- Avoid excessive JavaScript or CPU usage.
- Pause unnecessary animation when the page is not visible, where practical.
- Respect `prefers-reduced-motion`.
- Ensure readable status text with assistive technologies.
- Prevent disruptive repeated screen-reader announcements.

### UX requirements

- Work at 320px and larger viewport widths.
- Support light and dark mode.
- Maintain consistent Salo typography.
- Avoid unnecessary layout shifts.
- Ensure any interactive Turnstile challenge remains accessible and unobstructed.
- Display a usable fallback if motion is disabled or unavailable.
- Provide a clear retry path after failure.

### Tests

Cover:

- Successful verification and creation.
- Verification timeout.
- Expired token.
- Failed token.
- Network interruption.
- Session creation failure.
- Retry behavior.
- No duplicate room creation.
- Reduced-motion preference.
- Keyboard navigation.
- Screen-reader status announcements.
- Narrow mobile layouts.
- Browser and installed-PWA contexts.

### Acceptance criteria

- The creation screen feels visually consistent with Salo.
- The animation does not make verification slower.
- Security behavior remains unchanged.
- Users understand what is happening.
- Users can recover from failures.
- The created room opens immediately after successful completion.

---

## Updated Implementation Roadmap

Keep the original F01–F15 feature requirements, with the following scheduling changes:

**Phase 0 — Audit and architecture review**

Include an assessment of menu URL security and the existing Turnstile creation flow.

**Phase 1–7 — Core functional implementation**

Preserve the previous implementation sequence for pricing, discounts, collaborative serving, KKB, session coordination, and PWA reliability.

**Phase 8 — UX and integration improvements**

Complete remaining billing UX refinements and implement:

- F16 — Restaurant Menu Link Sharing & URL Safety.
- F17 — Animated Room Creation and Bot-Verification Experience.

**Phase 9 — Final functional validation**

Complete security, accessibility, realtime, billing, and end-to-end regression tests.

**Phase 10 — Logo and Brand Identity Refresh**

Implement F15 last.

If the final Shared Table logo changes iconography used in the room-creation animation, align the animation to the approved final logo during this phase without changing its verification behavior.

---

## Claude Code Execution Instructions

Claude Code is the implementation agent for this project.

Before implementation:

1. Read `CLAUDE.md` if present, then `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, `HANDOFF.md`, and relevant architecture documentation.
2. Inspect the current repository and recent implementation history.
3. Confirm which requested features already exist or are partially implemented.
4. Avoid implementing duplicate workflows.
5. Produce a technical audit and prioritized implementation plan.
6. Propose all necessary schema and API changes.
7. Identify security-sensitive work.
8. Surface unresolved architectural decisions before consequential migrations.

During implementation:

- Follow the repository's existing branching and PR conventions.
- Implement changes incrementally.
- Preserve the existing design system.
- Reuse existing components.
- Maintain strict server-side authorization.
- Protect financial calculations and confirmed-order integrity.
- Add relevant unit, integration, and E2E tests.
- Document changes and remaining limitations.
- Run typecheck, lint, tests, and build after each meaningful phase.
- Never silently change the scope or introduce new infrastructure.

After each phase, report:

- What was implemented.
- Which files changed.
- Database migrations, if any.
- Tests executed and their actual results.
- Known limitations.
- Manual verification required.
- Any security or operational concerns.

Do not treat successful compilation as proof of complete functionality.

**Begin with Phase 0. Do not implement the entire v1.4 brief as one unreviewed change.**

---

## Final Principle

Salo should remain simple for ordinary group dining while becoming more capable when coordination, pricing, or billing becomes complex.

Menu sharing must not expose users or the Salo infrastructure to unnecessary security risks.

Room-creation animations must improve perceived usability without delaying the user or weakening bot protection.

**The logo redesign remains the final implementation task.**

# Group Ordering App
## Final Product Requirements Document & Technical Implementation Brief

**Version:** 1.2  
**Status:** Finalized Development Baseline  
**Date:** November 6, 2026  
**Platform:** Mobile-first Progressive Web Application  
**Deployment:** Self-hosted on GreenCloud VPS using Coolify  

---

# 1. Executive Summary

Develop a lightweight, collaborative, consumer-facing web application that helps friends, coworkers, families, and other groups consolidate restaurant orders before communicating them to a waiter.

The application must support:

1. A single person collecting everyone's orders.
2. Multiple people contributing through a QR code or shared link.
3. One person submitting a collective order for several people.
4. Any combination of these workflows within the same session.

The application automatically organizes dishes, consolidates identical items and quantities, preserves special instructions, and produces a clear waiter-facing order summary.

The restaurant does not need to participate in the platform.

**Product promise: One table. Everyone's order. No confusion.**

## 1.1 Core problem

When dining in groups, someone often becomes responsible for collecting dishes, counting quantities, remembering modifications, and communicating the group's order.

This becomes increasingly inconvenient with larger groups, repeated dishes, subgroup orders, and last-minute additions.

The application should make this process faster and more accurate than manually maintaining a list in Notes or Messenger.

## 1.2 Product differentiation

The application is not another food-delivery platform or restaurant POS system.

Its differentiators are:

- No restaurant integration.
- No mandatory menu configuration.
- No account registration.
- Rapid manual order collection.
- Optional QR-based collaboration.
- Flexible collective group orders.
- Automatic quantity consolidation.
- Clear waiter handoff.
- Safe additional-order rounds.
- Real-time updates with recovery from network interruptions.

---

# 2. Finalized Product Decisions

These decisions are approved and must be followed unless explicitly revised.

| Requirement | Final decision |
|---|---|
| Primary platform | Mobile-first web app / PWA |
| Frontend | Next.js, React, TypeScript |
| UI framework | Tailwind CSS + accessible components |
| Database | Dedicated self-hosted PostgreSQL instance |
| ORM | Drizzle ORM |
| Real-time updates | Server-Sent Events (SSE) |
| Mutations | Authenticated HTTP endpoints |
| Hosting | Existing GreenCloud VPS |
| Deployment | Docker through Coolify |
| Authentication | Anonymous session-based credentials |
| Order attribution | Optional |
| Group ordering | Simple group labels, optional members |
| Host-only actions | Order confirmation, round management, session closure |
| Closed-session history | Seven days |
| Restaurant integration | None |
| Digital menu | Not required |
| Payment processing | Excluded |
| Bill splitting | Excluded |
| AI/OCR | Excluded from MVP |
| Redis | Not required |
| External database services | Not required |

The application must not use Coolify's internal database.

---

# 3. Product Goals

## 3.1 Primary goals

- Minimize the time required to collect a group order.
- Consolidate identical dishes accurately.
- Reduce omitted items and incorrect quantities.
- Support both manual and collaborative ordering.
- Preserve original contributions and optional attribution.
- Generate a waiter-friendly order.
- Maintain reliable real-time synchronization.

## 3.2 Success metrics

During usability testing, measure:

- Time to create a session.
- Time to record ten verbal dish orders.
- Number of quantity errors.
- Number of missing or duplicated items.
- Accuracy of variant handling.
- Completion rate of QR joining.
- Time required to generate the waiter summary.
- Number of user corrections.
- Perceived ease of use compared with Notes.

Do not claim measurable usability improvements without real user testing.

---

# 4. User Roles and Permissions

## 4.1 Host

The person who creates the session becomes its host.

The host can:

- Add, modify, and remove draft orders.
- Enter dishes on behalf of other people.
- Create collective order entries.
- Invite participants.
- View and organize all contributions.
- Manage entry attribution.
- Resolve duplicate submissions.
- Review the consolidated order.
- Confirm an order with the waiter.
- Create additional order rounds.
- Record corrections.
- Close the session.

**Only the host can confirm an ordering round.**

## 4.2 Guest

Guests join using the shared link or QR code.

They can:

- Enter a display name.
- Add their own dishes.
- Edit their own draft contributions.
- View consolidated totals.
- View permitted order history.
- Mark themselves ready.
- Request ownership of host-created entries.

Guests cannot confirm rounds, close sessions, or modify other participants' entries without authorization.

## 4.3 Identity rules

No permanent account is required.

Each participant receives a securely generated session-specific identity.

Display names are not authentication credentials.

Two participants may have identical display names but must have distinct internal identities.

---

# 5. Complete User Journey

## 5.1 Landing page

The landing page contains:

**Primary action:** Start an order.

Secondary actions:

- Join an existing order.
- Resume an active session when available.

No login, restaurant registration, or setup questionnaire.

## 5.2 Session creation

Selecting Start an order must:

1. Create a secure session.
2. Create a host identity.
3. Generate a separate host credential.
4. Create Round 1 in draft state.
5. Open the main workspace.

The restaurant name and session name are optional.

The user must not be required to provide the number of diners.

## 5.3 Main workspace

The main workspace contains:

- Session name.
- Current round.
- Session status.
- Invite action.
- Quick dish entry.
- Consolidated order list.
- Total item count.
- Review order action.

The consolidated order is the default view.

Other available views:

- By person.
- By group.
- Round history.

## 5.4 Quick order entry

The primary form displays:

- Dish name.
- Quantity.
- Add button.

Quantity starts at one.

Secondary controls are available through progressive disclosure:

- Ordered for.
- Collective group label.
- Size or variant.
- Preparation instructions.

A person should be able to add an unassigned dish without creating any participants.

After successful submission:

- Clear the dish name.
- Reset quantity to one.
- Clear preparation instructions.
- Preserve the selected recipient during consecutive entry.
- Return focus to the dish input where appropriate.
- Display save confirmation.

## 5.5 Dish suggestions

Previously entered dishes should appear as autocomplete suggestions.

Matching must be conservative.

For example:

- "Chicken Katsu" and "chicken katsu" may refer to the same canonical dish.
- "Chicken Katsu" and "Chicken Cutlet" must not be automatically considered equivalent.
- Different sizes and preparation instructions must remain distinguishable.

Avoid AI-powered similarity matching in the MVP.

## 5.6 Inviting friends

The host selects Invite.

Display:

- QR code.
- Copyable session link.
- Optional short join code.

Guests scan or open the link, enter their display name, and join.

The invitation must not grant host privileges.

## 5.7 Manual ordering

The host can record all orders without sharing the session.

Example:

- Chicken Katsu ×2.
- Gyoza ×3.
- Iced Tea ×4.

Attribution may be omitted entirely.

## 5.8 Individual ordering

Entries may optionally be attributed to a person.

Example:

Miguel:

- Chicken Katsu ×2.

Rafa:

- Chicken Katsu ×1.

The consolidated total is Chicken Katsu ×3.

## 5.9 Collective group ordering

One person may order on behalf of multiple diners.

Example:

**Miguel's Group**

Optional members: Miguel, Rafa, JD.

- Chicken Katsu ×2.
- Gyoza ×1.
- Iced Tea ×3.

The system must not assume which member receives each dish.

A collective group may have a label without registered members.

Avoid complex group-management requirements.

## 5.10 Hybrid ordering

Manual and QR-based contributions occur in the same session.

A host may record several entries while other guests add their own dishes.

The server synchronizes accepted changes across devices.

If a guest discovers their order was already recorded by the host, the application should support reviewing and claiming that entry with host approval.

Do not automatically merge entries based only on matching names.

## 5.11 Readiness

Guests can optionally mark themselves ready.

The host sees a readiness summary.

Readiness is advisory and must not prevent the host from proceeding.

Readiness should be scoped to the active round rather than treated as a permanent participant state.

Adding or changing an order after marking ready should make the participant's readiness stale or reset it.

## 5.12 Review order

The review view includes:

- Consolidated dishes.
- Quantities.
- Variations.
- Special instructions.
- Total item count.
- Potential duplicates.
- Outstanding synchronization issues.
- Optional readiness indicators.

The host must be able to correct draft entries before proceeding.

## 5.13 Waiter view

The waiter view should contain only the information needed to communicate the order.

Example:

**Round 1**

- Chicken Katsu ×3
  - Regular ×2
  - No sauce ×1
- Gyoza ×2
- Crispy Pata ×1
- Iced Tea ×4

Total: 10 items.

Provide large, readable quantities and straightforward formatting.

Support copying the order as text.

Showing the waiter view must not confirm the order automatically.

## 5.14 Confirmation

After the waiter accepts the order, the host selects:

**Confirmed with waiter**

Confirmation must:

1. Validate the current round.
2. Ensure the host has the latest committed revision.
3. Reject confirmation if unresolved mutations may affect the order.
4. Persist a consistent confirmed snapshot.
5. Change the round status to CONFIRMED.
6. Prevent direct modification of confirmed entries.

Guests cannot confirm rounds.

## 5.15 Additional orders

The host may create subsequent rounds.

Example:

Round 1, confirmed:

- Chicken Katsu ×3.
- Gyoza ×2.

Round 2, draft:

- Iced Tea ×2.
- Extra Rice ×3.

The Round 2 waiter view shows only the new entries and any explicit corrections.

Round 1 remains preserved.

## 5.16 Session closure

When finished, the host selects End session.

The application:

- Makes the session read-only.
- Preserves confirmed history for seven days.
- Prevents new mutations.
- Schedules data deletion according to the retention policy.

A host must not be required to perform billing or payment tasks.

---

# 6. Core UX Requirements

## 6.1 Speed-first design

Do not force users through multiple screens to add a dish.

The most common actions should require very few interactions.

## 6.2 Progressive disclosure

Only show recipient, group, and instruction fields when needed.

## 6.3 Safe quantities

Use obvious increase/decrease controls.

Do not allow negative quantities.

A quantity reaching zero should remove or deactivate the relevant draft entry through a reversible operation.

## 6.4 Source integrity

Consolidated totals are computed from source contributions.

Editing a consolidated line containing multiple contributors must not arbitrarily change someone's entry.

## 6.5 Error recovery

Provide Undo for accidental draft changes and clear validation errors.

## 6.6 Synchronization feedback

Clearly distinguish:

- Saving.
- Saved.
- Reconnecting.
- Unsynced.
- Conflict.
- Failed.

Do not silently discard pending changes.

## 6.7 Mobile accessibility

Target WCAG 2.2 AA.

Provide:

- Keyboard support.
- Accessible labels.
- Adequate contrast.
- Comfortable touch targets.
- Screen-reader status announcements.
- Visible focus indicators.
- Clear error messages.
- Readable waiter summaries.

Prefer 44 × 44 CSS-pixel targets for common interactive controls where feasible.

## 6.8 Confirmation and destructive actions

Confirmed rounds cannot be silently edited.

Session closure and destructive operations must communicate their effects clearly.

Avoid excessive confirmation dialogs for routine draft changes.

---

# 7. Technical Architecture

## 7.1 Frontend

Use:

- Next.js App Router.
- React.
- TypeScript.
- Tailwind CSS.
- Accessible component primitives, such as shadcn/ui.
- Responsive PWA capabilities.

Prefer server-rendered initial session data with client-side interactivity where needed.

Keep business rules outside presentation components.

## 7.2 Backend

Use Next.js server-side route handlers with structured service-layer logic.

Responsibilities:

- Session creation.
- Anonymous identity and permissions.
- Dish management.
- Order mutations.
- Consolidation.
- Round transitions.
- Confirmed snapshots.
- Event persistence.
- Cleanup.

Use Zod or equivalent runtime request validation.

## 7.3 Database

**Deploy a dedicated PostgreSQL instance for the Group Ordering App.**

Requirements:

- Separate from Coolify's internal `coolify-db`.
- Separate database credentials.
- Dedicated persistent storage.
- Private Docker-network access.
- No public exposure of port 5432.
- Automated migrations.
- Independent backups.

Use Drizzle ORM.

The application database must not share Coolify's management database.

## 7.4 Real-time synchronization

Use:

**Authenticated HTTP mutations + Server-Sent Events + PostgreSQL.**

The server owns the authoritative data.

SSE delivers notifications about committed changes.

All database-changing operations must pass through authenticated, validated server endpoints.

### Standard mutation flow

1. Client creates a mutation with an idempotency key.
2. Client submits the mutation over HTTP.
3. Server validates identity and permissions.
4. Server verifies session and round status.
5. Server applies the mutation in a database transaction.
6. Server increments the session revision.
7. Server records a durable event in the same transaction.
8. Transaction commits.
9. Server returns the authoritative result.
10. Connected clients receive the corresponding event through SSE.

Clients may optimistically display pending changes, but must distinguish them from committed server state.

## 7.5 SSE behavior

Provide a session-scoped event stream.

Suggested endpoint:

`GET /api/sessions/:id/events`

Events should contain:

- Event ID.
- Session ID.
- Event type.
- Session revision.
- Timestamp.
- Minimal payload or entity reference.

Supported notifications include:

- Entry added.
- Entry updated.
- Entry removed.
- Participant joined.
- Readiness changed.
- Attribution changed.
- Round confirmed.
- Round opened.
- Session closed.

Events are emitted only after successful database commitment.

## 7.6 Reconnection and recovery

Clients must:

- Track the last acknowledged event ID.
- Reconnect after connection interruption.
- Replay missed events when available.
- Fetch the authoritative snapshot when replay is unavailable.
- Deduplicate repeated events.
- Reconcile pending mutations.

The SSE implementation must support Last-Event-ID or an equivalent cursor mechanism.

Missed events must not silently corrupt the displayed totals.

## 7.7 SSE implementation constraints

Start with one application instance.

A PostgreSQL-backed event log should provide recoverable event history.

PostgreSQL LISTEN/NOTIFY may serve as a low-latency notification mechanism, but cannot be the only event store because notifications are not durably replayable.

Do not rely exclusively on process-local event emitters.

Avoid Redis unless later scaling justifies it.

## 7.8 Proxy requirements

Test streaming through Coolify's reverse proxy.

Ensure:

- Appropriate HTTP streaming.
- No unintended response buffering.
- Connection heartbeats.
- Idle timeout compatibility.
- Proper client disconnect handling.
- Reconnection after deployments.
- Reasonable connection limits.

---

# 8. Database Design

Use UUIDs or another collision-resistant identifier scheme.

Apply foreign keys, uniqueness constraints, and appropriate indexes.

## 8.1 sessions

- id
- title
- status
- active_round_id
- revision
- created_at
- updated_at
- closed_at
- expires_at

## 8.2 participants

- id
- session_id
- display_name
- role
- created_at
- last_seen_at

Unique internal identities must be maintained even when display names match.

## 8.3 participant_credentials

- id
- session_id
- participant_id
- credential_type
- credential_hash
- created_at
- revoked_at
- expires_at

Do not store raw authentication credentials.

## 8.4 rounds

- id
- session_id
- round_number
- status
- revision
- created_at
- confirmed_at
- confirmed_by

Only one draft round may be active per session.

## 8.5 participant_round_readiness

- participant_id
- round_id
- ready
- acknowledged_revision
- updated_at

Readiness should be associated with a particular round and order revision.

## 8.6 dishes

- id
- session_id
- canonical_name
- normalized_name
- created_at

Dish names should use conservative normalization.

## 8.7 order_batches

- id
- session_id
- round_id
- submitted_by
- attribution_type
- attributed_participant_id
- collective_label
- created_at

Attribution types:

- INDIVIDUAL
- GROUP
- TABLE
- UNASSIGNED

A batch can contain multiple entries.

## 8.8 order_groups

Optional lightweight group metadata:

- id
- session_id
- label
- created_by
- created_at

## 8.9 order_group_members

Optional membership association:

- group_id
- participant_id

Group membership must not be required for collective orders.

## 8.10 order_entries

- id
- batch_id
- round_id
- dish_id
- quantity
- variant_data
- special_instructions
- revision
- created_at
- updated_at
- deleted_at

Quantities must be valid positive integers for active entries.

## 8.11 confirmed_round_snapshots

- id
- round_id
- snapshot_revision
- snapshot_data
- confirmed_by
- confirmed_at

Snapshots must remain immutable.

## 8.12 order_corrections

- id
- session_id
- source_round_id
- source_entry_id
- correction_type
- quantity_delta
- replacement_data
- explanation
- created_by
- created_at
- communicated_at

Corrections must be distinguishable from ordinary new orders.

## 8.13 mutation_records

- id
- session_id
- actor_id
- idempotency_key
- mutation_type
- result_reference
- created_at

Enforce appropriate uniqueness for idempotency.

## 8.14 session_events

- id
- session_id
- revision
- event_type
- payload
- created_at

Persist events transactionally with the mutations they describe.

## 8.15 Database constraints

Enforce:

- Valid session states.
- Valid round states.
- Positive quantities.
- Referential integrity.
- Unique round numbers within sessions.
- At most one active draft round.
- Unique mutation identifiers within their defined scope.
- Monotonic session revision changes.
- Confirmation integrity.

Do not rely solely on frontend validation.

---

# 9. Consolidation Logic

The application must preserve every accepted source entry until its applicable retention or correction rules permit deletion.

The consolidated view is derived from those entries.

For each distinct canonical dish preparation:

**Consolidated quantity = sum of valid active source-entry quantities.**

Use a stable dish identity and normalized preparation attributes.

### Examples

**Equivalent:**

- Chicken Katsu ×1.
- chicken katsu ×2.

Consolidated:

- Chicken Katsu ×3.

**Different preparation:**

- Chicken Katsu, regular ×2.
- Chicken Katsu, no sauce ×1.

Display these separately or as clearly separated variants under one dish heading.

**Different size:**

- Iced Tea, regular ×1.
- Iced Tea, large ×1.

Do not merge them into one indistinguishable line.

Manual reassignment or merging must be reversible while entries are drafts.

Source attribution must remain intact.

---

# 10. API Requirements

Suggested API endpoints:

## Sessions

- `POST /api/sessions`
- `GET /api/sessions/:id`
- `POST /api/sessions/:id/join`
- `POST /api/sessions/:id/close`

## Participants

- `GET /api/sessions/:id/participants`
- `PATCH /api/sessions/:id/participants/:participantId`
- `POST /api/sessions/:id/claims`
- `POST /api/sessions/:id/claims/:claimId/approve`

## Dishes

- `GET /api/sessions/:id/dishes`
- `POST /api/sessions/:id/dishes`

## Orders

- `POST /api/sessions/:id/entries`
- `PATCH /api/sessions/:id/entries/:entryId`
- `DELETE /api/sessions/:id/entries/:entryId`
- `GET /api/sessions/:id/orders/summary`
- `GET /api/sessions/:id/orders/by-person`
- `GET /api/sessions/:id/orders/by-group`

## Rounds

- `GET /api/sessions/:id/rounds`
- `POST /api/sessions/:id/rounds`
- `POST /api/sessions/:id/rounds/:roundId/confirm`
- `POST /api/sessions/:id/corrections`

## Real-time

- `GET /api/sessions/:id/events`
- `GET /api/sessions/:id/sync`

Each endpoint must implement appropriate authorization, validation, state checks, and consistent error handling.

Mutating endpoints must support safe retry behavior.

Do not allow a client to elevate its role through request payloads.

---

# 11. Security and Privacy

## 11.1 Anonymous authentication

Use cryptographically secure session credentials.

Host credentials must be separate from invitation credentials.

Prefer Secure, HttpOnly cookies with appropriate SameSite settings.

## 11.2 Authorization

Verify permissions on the server for every protected operation.

Invitation access does not imply host authority.

## 11.3 Abuse protection

Implement:

- Rate limits for session creation.
- Rate limits for joining.
- Request size limits.
- Quantity limits.
- Reasonable participant limits.
- Reasonable entry limits.
- Input validation.
- Output escaping.

## 11.4 Web security

Require:

- HTTPS.
- CSRF protections appropriate to cookie authentication.
- Protection against XSS.
- Safe user-generated text rendering.
- Secret management through environment variables.
- Restricted database connectivity.

## 11.5 Data minimization

Do not require:

- Legal names.
- Phone numbers.
- Email addresses.
- Payment details.
- Restaurant account credentials.

Optional display names are sufficient.

---

# 12. Data Retention and Backups

## 12.1 Closed sessions

Closed sessions remain available in read-only mode for seven days.

After seven days, the cleanup process must remove the associated application records from the live database.

## 12.2 Inactive sessions

Sessions that are never explicitly closed should use a separate configurable inactivity policy.

Default proposal: expire after thirty days of inactivity.

This does not override the seven-day post-closure retention requirement.

## 12.3 Database backups

Use independent PostgreSQL backups through Coolify or an equivalent mechanism.

Requirements:

- Daily scheduled backups.
- Off-VPS backup destination.
- Limited retention.
- Backup failure alerts.
- Documented restoration procedure.
- Periodic restoration testing.

A database stored on the same VPS as its only backup is not an acceptable production backup strategy.

Backup retention must be documented separately from live-session deletion.

---

# 13. VPS Deployment Architecture

## 13.1 Confirmed infrastructure

Existing VPS:

- Provider: GreenCloud.
- Installed RAM: 8 GB.
- SSD: 60 GB.
- Docker installed.
- Coolify installed.
- Reverse proxy available.

Last observed capacity:

- Approximately 5.4 GiB memory available.
- Approximately 46 GB disk available.
- Minimal swap utilization.

This is sufficient for the expected initial application workload, subject to actual testing.

## 13.2 Deployment layout

Deploy two primary application resources:

**Resource A — Group Ordering App**

- Next.js.
- API route handlers.
- SSE event stream.
- Background cleanup mechanism.

**Resource B — Dedicated PostgreSQL**

- Independent PostgreSQL instance.
- Dedicated persistent volume.
- Private network access.
- Independent backup configuration.

Do not connect to `coolify-db`.

Do not expose the application database directly to the internet.

## 13.3 Initial resource limits

Initial planning values:

- Next.js runtime: 512 MiB memory.
- PostgreSQL: 512 MiB memory.

These are starting limits to evaluate, not guaranteed optimal values.

Production builds may need more resources than application runtime.

Adjust after observing actual memory use and testing concurrent sessions.

## 13.4 Docker

Use a production-ready multi-stage Docker build.

Requirements:

- Minimize final image size.
- Avoid unnecessary development dependencies.
- Run as a non-root application user where practical.
- Provide a meaningful health-check endpoint.
- Support graceful shutdown.
- Configure application logging.
- Persist PostgreSQL data outside the container filesystem.

## 13.5 Coolify

Deploy the application and PostgreSQL as independently managed resources.

Configure:

- Production environment variables.
- Internal database connectivity.
- Domain and HTTPS.
- Health checks.
- Automatic restart policies.
- Resource limits.
- Backup schedules.
- Deployment logs.

## 13.6 Operations

Monitor:

- Available RAM.
- Disk utilization.
- Container restarts.
- Database availability.
- SSE connection failures.
- Reconnection frequency.
- Database backup status.
- Application errors.

Initially alert on sustained resource pressure rather than brief spikes.

---

# 14. Performance Targets

The following are targets requiring verification.

- Local controls respond without noticeable delay.
- Committed order changes propagate to connected clients through SSE without periodic polling.
- Target visibility within one second under healthy conditions.
- Recover missed updates after network interruptions.
- Support at least twenty concurrent participants in a session.
- Support at least one hundred order entries without significant UI degradation.
- Preserve accurate totals under concurrent mutations.

Do not represent these numbers as achieved benchmarks before testing.

---

# 15. Testing and Validation

## 15.1 Unit tests

Test:

- Dish normalization.
- Canonical identity.
- Preparation variant comparison.
- Quantity aggregation.
- Attribution.
- Permission rules.
- Round lifecycle.
- Correction calculations.
- Validation rules.

## 15.2 Integration tests

Test:

- Session creation.
- Guest joining.
- Anonymous credentials.
- Host-only permissions.
- Source-entry ownership.
- Idempotent submissions.
- Concurrent mutations.
- Optimistic locking.
- Round confirmation.
- Session closure.
- Retention cleanup.

## 15.3 SSE tests

Test:

- Multiple clients receiving updates.
- Connection interruptions.
- Duplicate event handling.
- Missed-event replay.
- Snapshot resynchronization.
- Server restarts.
- Proxy idle timeouts.
- Unauthorized subscriptions.
- Confirmation events.
- Closed-session behavior.

## 15.4 End-to-end tests

Use Playwright or equivalent.

Required scenarios:

1. Host-only ordering.
2. QR collaboration.
3. Collective group ordering.
4. Hybrid contributions.
5. Similar dish consolidation.
6. Preparation variants.
7. Accidental changes and Undo.
8. Duplicate-submission protection.
9. Waiter review.
10. Host-only confirmation.
11. Additional ordering rounds.
12. Network recovery.
13. Session closure.
14. Expiration and deletion.

## 15.5 Accessibility testing

Combine automated accessibility audits with keyboard and screen-reader testing.

## 15.6 Real-world usability testing

Compare the application against ordinary note-taking.

Measure time, accuracy, error recovery, and user confidence.

Real-world UX validation remains an implementation milestone, not a completed achievement.

---

# 16. Implementation Roadmap

## Phase 0 — Project foundation

Deliver:

- Next.js project.
- TypeScript configuration.
- Tailwind CSS.
- Accessible UI components.
- PostgreSQL integration.
- Drizzle schema and migrations.
- Docker support.
- Environment examples.
- Testing infrastructure.

## Phase 1 — Standalone ordering

Implement:

- Session creation.
- Manual quick entry.
- Dish suggestions.
- Quantity controls.
- Draft editing.
- Optional attribution.
- Accurate consolidation.
- Waiter preview.

The application must already be useful for one person.

## Phase 2 — Collaborative sessions

Implement:

- QR invitations.
- Anonymous participants.
- Guest permissions.
- HTTP mutations.
- SSE streaming.
- Durable events.
- Synchronization.
- Reconnection.
- Concurrency handling.

## Phase 3 — Group and hybrid workflows

Implement:

- Collective orders.
- Group labels.
- Optional members.
- By-person/group views.
- Host-created entries.
- Claim approval.
- Duplicate-resolution interactions.

## Phase 4 — Confirmation and order rounds

Implement:

- Order review.
- Waiter presentation.
- Host-only confirmation.
- Confirmed snapshots.
- Additional rounds.
- Corrections.
- Session closure.

## Phase 5 — Production hardening

Implement and verify:

- Security protections.
- Automated testing.
- Accessibility.
- Performance.
- SSE deployment behavior.
- Database backup and restoration.
- Cleanup scheduling.
- Usability testing.
- Production monitoring.

---

# 17. Repository Documentation

The repository must include:

**README.md**

Project overview, prerequisites, development setup, and commands.

**docs/architecture.md**

Technical architecture, component responsibilities, and data flow.

**docs/data-model.md**

Database schema, relationships, integrity rules, and consolidation.

**docs/ux-specification.md**

Approved user journeys, screens, interactions, and error states.

**docs/api.md**

Endpoints, request validation, authorization, and error responses.

**docs/realtime.md**

SSE implementation, events, revisions, replay, and reconnect behavior.

**docs/security.md**

Authentication, authorization, abuse controls, and retention.

**docs/deployment.md**

Docker, Coolify, PostgreSQL, environment configuration, and backups.

**docs/testing.md**

Test coverage, scenarios, expected results, and verification commands.

**HANDOFF.md**

Current implementation progress, completed phases, important decisions, unresolved issues, known limitations, and next steps.

Documents must reflect implemented behavior rather than hypothetical capabilities.

---

# 18. Development Guidelines for Claude Code / GitHub Copilot

Treat this document as the approved product specification.

Before implementing a feature:

1. Review related requirements.
2. Check existing implementation.
3. Identify affected components and data structures.
4. Confirm consistency with the approved UX.
5. Define tests for the expected behavior.

During implementation:

- Preserve source-entry integrity.
- Enforce permissions on the server.
- Avoid introducing unrelated features.
- Avoid speculative abstractions.
- Keep the interface mobile-first.
- Avoid unnecessary infrastructure.
- Implement transactional mutations.
- Ensure synchronization events are recoverable.
- Keep documentation accurate.
- Maintain lightweight resource consumption.

After completing a phase:

1. Run applicable tests.
2. Report implemented functionality.
3. Identify any specification deviations.
4. Document limitations.
5. Update HANDOFF.md.

Do not claim functionality or test success without verification.

---

# 19. MVP Acceptance Criteria

The MVP may be considered functionally complete when:

- A session can be created without registration.
- The host can collect an order alone.
- Guests can join through QR/link.
- Guests can submit entries concurrently.
- Manual and QR contributions coexist.
- Attribution is genuinely optional.
- Collective group orders work.
- Matching dish variants consolidate correctly.
- Different variants remain distinguishable.
- Quantities remain correct under concurrent changes.
- Mutation retries do not duplicate entries.
- Host and guest permissions are enforced.
- SSE updates are delivered and recoverable.
- The waiter view is accurate and readable.
- Only the host can confirm rounds.
- Confirmed snapshots remain immutable.
- Additional rounds operate independently.
- Sessions close correctly.
- Closed-session data is deleted after seven days from the live database.
- PostgreSQL has dedicated persistent storage.
- Backups and restoration are tested.
- Critical accessibility tests pass.
- Deployment instructions reproduce the environment.
- Required documentation is complete.

---

# 20. Explicit Non-Goals

Do not introduce the following into the MVP:

- Restaurant POS integration.
- Waiter or kitchen accounts.
- Ordering directly to restaurant systems.
- Payment gateways.
- Bill splitting.
- AI-based ordering.
- Automatic menu OCR.
- Large restaurant catalogs.
- Food delivery.
- Persistent social profiles.
- Mandatory email authentication.
- Redis or complex distributed infrastructure without demonstrated need.

---

# 21. Definition of Done

Development is complete when the approved journeys work reliably, automated and manual verification have been performed, production deployment is reproducible, database integrity is protected, and the application is usable on real mobile devices.

A visually polished interface is not sufficient if quantities can become inaccurate or changes can be lost.

The finished product must prioritize reliability, speed, and simplicity.

---

# 22. Final Product Direction

Build a mobile-first collaborative restaurant order organizer that requires no integration with restaurants.

A host can collect everyone's dishes manually, invite friends to contribute through QR codes, or combine both approaches.

Users may attribute items to individuals, temporary groups, or nobody.

The application automatically consolidates identical dishes and quantities, preserves source entries and preparation variations, and generates a clear order for the waiter.

Only the host may confirm ordering rounds. Additional orders are tracked separately.

Real-time collaboration uses SSE, HTTP mutations, and PostgreSQL-backed durable events.

The system runs on the existing GreenCloud VPS with its own dedicated PostgreSQL instance, managed through Coolify.

**Every design and engineering decision should serve the same outcome: making group orders easier to collect, more accurate to consolidate, and simpler to communicate.**

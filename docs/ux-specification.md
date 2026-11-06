# UX specification

What is built, screen by screen. Design world and tokens: `PRODUCT.md`, the direction contract in `.impeccable/surfaces/src-app.md`, and `DESIGN.md` (written after the workspace shipped).

## Landing (`/`)
- Primary action **Start an order** (one tap: creates the session and opens the workspace). Errors appear under the button in plain words.
- **Pick up where you left off**: orders this browser is part of (from its session cookies), newest first, up to five.
- **Join with a code**: six characters; lower case, spaces, dashes and look-alikes (I, L → 1; O → 0; U → V) are forgiven; opens the invite page.
- Sample ticket (labelled "Sample order") and a three-step how-it-works.

## Workspace (`/s/:id`)
- **Header band** (tomato): home, order name (host taps to rename; optional), "Round n · Taking orders", sync pill: Saving… / Saved / Offline · not saved yet / Changed elsewhere / Not saved. Announced politely to screen readers.
- **Ticket**: consolidated dishes with big counts. A dish with one source entry shows a stepper directly; at 1 the minus becomes Remove. A dish with several entries shows its total and, if needed, its preparations ("Regular ×2", "No sauce ×1"); tapping the total opens the source entries, each with its own stepper and who it is for.
- **Empty state**: "Wala pang order. Type the first dish below."
- **Composer** (pinned at the bottom): Details button, Dish field, quantity stepper (starts at 1), Add. Suggestions appear above the field for dishes already in this order (starts-with first, then contains; up to four). Details reveals *Ordered for* (Anyone, Whole table, A person, A group, with name suggestions), *Size or variant* and *Instructions*. A dot on the Details button shows when details are set while hidden.
- **After Add**: dish, quantity, size and instructions reset; the recipient stays; focus returns to the Dish field; toast "Added Gyoza ×2. Ayos!" with Undo.
- **Remove** (stepper at 1): no dialog; toast with Undo restores it.
- **Failures**: a red box lists each change that did not save, with Retry and Discard. A conflict ("Someone changed this dish just now") refreshes to the latest version.
- **Bottom bar**: item count for the round and **Show waiter**.

## Views (tabs under the header)
- **Order** (default): the consolidated ticket. **People** (count of joined people): one card per joined person (the host's only when it has dishes), then names the host typed for people who did not join ("added by the host"), then Whole table and Not assigned; guests show "Ready" or "Still choosing". **Groups** (count of group labels): each collective order with its total, dishes, member chips and "Add/Edit members" (a dialog with checkboxes; optional, never assigns dishes). Arrow keys move between tabs.
- **Claims**: in People, a guest sees "That's mine" next to each dish the host added under a typed name or for nobody; after tapping, "Asked the host". The host sees a saffron banner at the top: "Rafa says Halo-halo ×1 is theirs." with Decline / Approve. Approving makes it the guest's own dish.
- **Possibly ordered twice** (host, People): when the host added a dish for a guest by name and that guest also added the same dish preparation, a hint offers "Remove your copy" (with Undo). Nothing merges on its own.
- **Readiness**: guests have an "I'm ready" toggle in the bottom bar (pressed state "Ready"); changing their own dishes afterwards resets it. The host sees "n of m guests ready" under the item count. It never blocks anything.

## Invite sheet (header "Invite")
- Native modal dialog (focus trapped, Escape closes): QR code (ink on white), the 6-character code in large mono, **Share invite** (system share sheet with the text "Join our order at … on Salo: <link>") when available, **Copy link**, and a note that guests change only their own dishes and only the host confirms with the waiter.

## Invite page (`/j/:code`)
- A ticket with the logo, round, "Join the order (at <name>)", one sentence on how it works, **Your name** and **Join the order**. Closed orders say "This order has ended". The link preview card shows the same title, "Tap to add your dishes…", and an "Add your order" pill.

## Guests in the workspace
- Same screen; the composer's *Ordered for* defaults to **Me** (the host's defaults to Anyone). Steppers appear only on the guest's own entries; the order name is not editable. Changes from everyone appear live; "Reconnecting…" shows while the live connection is down.

## Waiter ticket (`/s/:id/waiter`)
- Large dish names and counts (fluid type), preparations indented, total. Works read aloud or handed over; the screen is kept awake while open (where supported).
- **Copy as text** produces the same ticket as plain text. Viewing never confirms or sends anything.

## Not part of the order / deleted (`404`)
- "Wala dito." with an explanation that orders are deleted a week after the meal, and **Start a new order**.

## Accessibility
- 44 px targets, visible focus rings, labelled controls (stepper buttons name the dish and who it is for), status in words and icons, toasts in a polite live region that never takes focus, reduced motion respected, light and dark checked with axe (WCAG 2.2 AA tags) in the end-to-end tests.

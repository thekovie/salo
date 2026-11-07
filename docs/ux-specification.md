# UX specification

What is built, screen by screen. Design world and tokens: `PRODUCT.md`, the direction contract in `.impeccable/surfaces/src-app.md`, and `DESIGN.md` (written after the workspace shipped).

## Landing (`/`)
- Primary action **Start an order** (one tap: creates the session and opens the workspace). Errors appear under the button in plain words.
- **Pick up where you left off**: orders this browser is part of (from its session cookies), newest first, up to five.
- **Join with a code**: six characters; lower case, spaces, dashes and look-alikes (I, L → 1; O → 0; U → V) are forgiven; opens the invite page.
- **Hero scene** (labelled "Sample order"): a Round 1 ticket that fills itself on a loop. "Rafa added…" pill, counts merge, "No sauce" splits off, the total ticks, the CONFIRMED stamp lands.
- **How it works**, four rows (text with an illustrated phone scene that plays once when scrolled into view): start and invite (QR, code, people joining); everyone adds their own (typing, Add, counts merging with a "+2 · JD" tag); one ticket for the waiter (big numbers, stamp); settle up later (who ordered what, Copy text / Save image). Scenes are decorative (`aria-hidden`); with reduced motion they show their last frame, still.
- "Why Salo" strip (no app, live on every phone, rounds and fixes, gone after the meal), a closing **Start your table's order** ticket, and a footer link to How it works.
- **First-time tour** (in an order): a saffron card "New to Salo? Take a 30-second tour" (Show me / Not now), once per browser and role. The tour spotlights one control at a time with a ticket card (n of N, Back / Next / Skip, Done; arrows and Escape work). Host: dish field, For, Invite, Review order, Order options. Guest: dish field, For, I'm ready, Ticket, the ? button. Steps whose control isn't on screen are skipped. Replay: host from Order options → How Salo works, guest from the ? in the header.

## Workspace (`/s/:id`)
- **Header band** (tomato): home, order name, "Round n · Open" with the sync pill under it (Saved shows as a check), Invite, and for the host an **Order options** drawer (name, Cancel/End order). Sync pill: Saving… / Saved / Offline · not saved yet / Changed elsewhere / Not saved. Announced politely to screen readers.
- **Ticket**: consolidated dishes with big counts. A dish with one source entry shows a stepper directly; at 1 the minus becomes Remove. A dish with several entries shows its total and, if needed, its preparations ("Regular ×2", "No sauce ×1"); tapping the total opens the source entries, each with its own stepper and who it is for.
- **Empty state**: "Wala pang order. Type the first dish below."
- **Composer** (pinned at the bottom), two rows. Row one: a full-width **Dish** field with a visible label. Row two: **For <name> ▾** (who the next dish is for), the quantity stepper (starts at 1), **Add**. Suggestions appear above the field for dishes already in this order (starts-with first, then contains; up to four). The For button opens *Who's it for?*: one-tap chips built from the order — **Me** (default for host and guests), each other person in the order, names typed earlier for people without a phone, groups used so far, Whole table, Anyone, **+ Someone else**, **+ New group** (the last two show a name field; the typed name becomes a chip). *Size or notes* sits inside the same panel; a dot on the For button shows when they are set while it is closed. The panel has a Close (X). Chips are 44 px tall.
- **Someone else adds a dish**: a small saffron pill under the header ("JD added Gyoza ×2"; several at once: "JD added 3 dishes") slides in, stays about 2.5 s and fades; tapping it jumps to the dish. The dish row gets a "+2 · JD" tag and the wash. Never for your own dishes; quiet on load and resync. Under reduced motion it fades only.
- **Removing a guest** (host, People tab): the remove icon on a guest's card opens a drawer with an optional reason (≤140, only that guest sees it) and what happens (their own items in the open round come off; they can join again). Toast "JD removed." with Undo. The removed guest's screen says "You're no longer in this order", quotes the reason, and offers **Join again** while the order is open.
- **Editing a draft dish**: a pencil on each line you may change opens "Edit dish" (size, instructions, who it's for; the chips work with arrow keys). Quantity stays on the stepper. Quantity changes and edits show an Undo toast.
- **Connection pill**: under the header. "You're offline…" (with how many changes are waiting), "Reconnecting… live updates are paused", then "Back online · all changes sent". Changes made offline are kept on the phone, even across a reload. An add aimed at a round confirmed meanwhile comes back as "not saved" with **Add to round N**.
- **After Add**: dish, quantity, size and instructions reset; the recipient stays; focus returns to the Dish field; toast "Added Gyoza ×2. Ayos!" with Undo. The line scrolls into view above the composer and gets the saffron wash, also when an existing dish gets another entry (yours or from another phone).
- **Remove** (stepper at 1): no dialog; toast with Undo restores it.
- **Failures**: a red box lists each change that did not save, by name, with Discard (and Retry when a second try can help: server error or too many changes). A conflict ("Someone changed this dish just now") refreshes to the latest version.
- **Bottom bar**: item count for the round and **Show waiter**.

## Views (tabs under the header)
- **Order** (default): the consolidated ticket. **People** (count of joined people): one card per joined person (the host's only when it has dishes), then names the host typed for people who did not join ("added by the host"), then Whole table and Not assigned; guests show "Ready" or "Still choosing". **Groups** (count of group labels): each collective order with its total, dishes, member chips and "Add/Edit members" (a dialog with checkboxes; optional, never assigns dishes). Arrow keys move between tabs.
- **Claims**: in People, a guest sees "That's mine" next to each dish the host added under a typed name or for nobody; after tapping, "Asked the host". The host sees a saffron banner at the top: "Rafa says Halo-halo ×1 is theirs." with Decline / Approve. Approving makes it the guest's own dish.
- **Possibly ordered twice** (host, People): when the host added a dish for a guest by name and that guest also added the same dish preparation, a hint offers "Remove your copy" (with Undo). Nothing merges on its own.
- **Readiness**: guests have an "I'm ready" toggle in the bottom bar (pressed state "Ready"); changing their own dishes afterwards resets it. The host sees "n of m guests ready" under the item count. It never blocks anything.

## Invite sheet (header "Invite")
- Bottom drawer torn off the pad (swipe down, Escape or tap outside to close; focus moves in and returns): QR code (ink on white), the 6-character code in large mono, **Share invite** (system share sheet with the text "Join our order at … on Salo: <link>") when available, **Copy link**, and a note that guests change only their own dishes and only the host confirms with the waiter.

## Invite page (`/j/:code`)
- A ticket with the logo, "Join the order (at <name>)", a live line "Live · n people · n items so far", one sentence on how it works, **Your name** and **Join the order**. Closed orders say "This order has ended". The link preview card shows the same title, "Tap to add your dishes…", and an "Add your order" pill.

## Guests in the workspace
- First visit after joining: a toast "You're in! Add your dishes below. Only you can change yours."
- In People, dishes the host typed under the guest's own name appear inside the guest's card ("The host added these for 'Rafa'. Yours?" with That's mine), not as a second card.
- Same screen; the composer's *For* defaults to **Me** (the host's too). Steppers appear only on the guest's own entries; the order name is not editable. Changes from everyone appear live; "Reconnecting…" shows while the live connection is down.

## Review, waiter ticket and confirmation
- Bottom bar: the host has **Review order** (primary); guests have **Ticket**.
- **Review round n** (full screen): checks with icons and words (everything saved / changes still saving / changes not saved; n of m guests ready and who is still choosing; possibly ordered twice with "Remove your copy"), then the round's ticket. **Show the waiter** opens the waiter ticket; **Mark confirmed with waiter** (host, enabled only when everything is saved) asks once; the dialog stays open showing "Confirming…" until the server answers and shows any refusal inside it: "Confirm round n with the waiter? This saves round n exactly as shown… Its dishes can't be changed afterwards." → **Yes, the waiter has it**.
- **Waiter ticket** (full screen, in place so unsaved changes are never lost): huge counts, preparations indented, a separate **Corrections** block, total, Copy as text, screen kept awake; the host can confirm from an outline button under the ticket (the screen belongs to the waiter). Showing it never confirms.
- After confirming: the rubber **CONFIRMED** stamp lands in the ticket's header (the signature moment; static with reduced motion), toast "Round n confirmed. Kain na!". The Order tab shows the stamped ticket and, for the host, **Start round n+1**; guests read that the host confirmed the round.
- **Rounds tab**: newest first; the open round prints on its carbon-copy colour (round 2 canary, round 3+ pink) with its corrections (host can Remove each); confirmed rounds show their stamped tickets and the time. **Correct a dish** (host, while a round is open) opens a bottom drawer: dish/preparation, Cancel some (stepper) or Change it (text), optional note. **End order** (host) asks once and explains: nobody can change anything, the invite stops working, tickets stay readable for 7 days, then deleted; warns if the open round was never confirmed.
- **Who ordered what** (for settling up later; no prices): opens by itself for the host after End order, as a button on the ended order for everyone, and on the People tab once a round is confirmed. Per person, then groups ("shared by …"), the whole table and unassigned dishes, from confirmed rounds only with corrections applied (cancellations lower counts; a swap reads "A → B"); an unconfirmed round is mentioned and left out. **Copy text** (plain text for the group chat), **Save image** (a PNG ticket: the share sheet on phones, a download elsewhere), **Share text** where supported. The date is the device's own.
- **Ended order**: banner "This order has ended… deleted on <weekday, date>", Rounds tab by default, no composer, no Invite.

## Waiter ticket link (`/s/:id/waiter`)
- Large dish names and counts (fluid type), preparations indented, total. Works read aloud or handed over; the screen is kept awake while open (where supported).
- **Copy as text** produces the same ticket as plain text. Viewing never confirms or sends anything.

## Not part of the order / deleted (`404`)
- "Wala dito." with an explanation that orders are deleted a week after the meal, and **Start a new order**.

## Accessibility
- 44 px targets, visible focus rings, labelled controls (stepper buttons name the dish and who it is for), status in words and icons, toasts in a polite live region that never takes focus, reduced motion respected, light and dark checked with axe (WCAG 2.2 AA tags) in the end-to-end tests.

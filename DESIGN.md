# Salo design system

Derived from the shipped build (landing, workspace, waiter ticket). Product truth lives in `PRODUCT.md`; the direction contract in `.impeccable/surfaces/src-app.md`. Tokens are in `src/app/globals.css`; components use the semantic names only.

## World: the order pad
A carbonless restaurant order pad made live. Thermal paper, ballpoint ink, tomato-red numbering, carbon copies for later rounds, saffron highlighter. Dark mode is the same pad under a dim bar light (warm charcoal, ink inverted, red kept).

## Colour (oklch, light / dark)
| Token | Use |
|---|---|
| `paper` | Page ground |
| `ticket` | Ticket strips, cards, inputs |
| `ink`, `ink-soft` | Text; secondary text (≥ 4.5:1 on paper and ticket) |
| `rule`, `input` | Dividers and dashed tear lines; form-control borders (≥ 3:1) |
| `tomato` / `on-tomato` | Primary action and logo. One tomato primary per screen. White on tomato ≥ 4.5:1. |
| `band` / `on-band` | The header band (the pad's red cover): tomato in light; a deep, quiet red in dark so it never glares at a night table. |
| `tomato-ink` | Red text on paper: quantities, round labels, stamp |
| `saffron`, `saffron-ink`, `saffron-wash` | Highlights, suggestion chips, step numbers, warning pill |
| `copy-1/2/3` | Round 1 white, round 2 canary, round 3+ pink carbon copies |
| `ok`, `bad` (+ `-wash`) | Status, always with an icon and words |
| `toast*` | Inverted toast chip and its action colour per theme |
| `ring` | Focus ring: ballpoint ink in light, warm cream in dark |

The system preference sets dark mode in CSS alone; `.dark` / `.light` on `<html>` is an explicit override saved by the theme toggle.

## Type
- **Fredoka 500**: headings, order name, wordmark (rounded, never bold).
- **Nunito Sans 400/600**: body and controls.
- **DM Mono 400/500**: quantities, round labels, totals, codes (`.tally`: tabular, slashed zero). Mono is for counting, never decoration.
- Self-hosted woff2 (`src/app/fonts`), no third-party requests.

## Shape and depth
- `.ticket`: perforated top and bottom edges (mask), `shadow-ticket` (soft offset shadow), dashed `divide-rule` between dishes, `.tear` before totals. Every content panel is a ticket strip: the order, people and group cards, review checks; rounds take their carbon-copy colour.
- Radius: pills (`rounded-full`) for buttons and chips; `rounded-xl` inputs; `1.4rem` composer.
- No hard offset shadows, no coloured side borders, no gradient text.

## Components
- **Button**: primary (tomato, shadow), outline, ghost, danger; sizes md (44 px), lg (52 px), icon (44 px). Press scales to 0.97.
- **Stepper**: − n + with 44 px targets; at 1 the minus becomes a red Remove when removal is allowed; count in `tally` tomato-ink.
- **Sync pill**: words + icon; on the tomato band uses `bg-ink/20`; warnings switch to saffron.
- **Stamp**: double-ruled tomato-ink rubber stamp, rotated −8°, blend multiply/screen, sized in `em`. On round tickets it sits in the header row so it never covers a dish or count; it lands once (rotate/scale keyframes) right after confirming. Screen readers get "confirmed with the waiter" from the ticket's label.
- **Corrections** print inside the round's ticket; the host's Remove sits on the line itself (never a second list).
- **Ended order**: the header says "Order ended"; a plain line with a lock gives the deletion date; no bottom bar.
- **Toast**: one at a time, bottom above the composer, 6 s, Undo action, polite live region.
- **View tabs**: flat text tabs on the paper ground, active one underlined in tomato (3 px), counts in tomato mono. No segmented-control track.
- **Bottom bar**: Add is the single tomato button; Review order (host) and Ticket (guest) are outline. The confirm action reads "Mark confirmed with waiter" (a verb, not a status).
- **Full-screen panels** (Review, Waiter ticket): native modal dialogs (`FullScreenSheet`).
- **Composer**: single row (Details, Dish, stepper, Add), details panel above it, suggestion chips (saffron-wash) above that.

## Motion
- Signature: a newly added dish line lands with a brief saffron wash (900 ms ease-out). Toasts rise 8 px (220 ms, expo ease-out). Steppers and buttons press-scale.
- Everything collapses under `prefers-reduced-motion`.

## Voice
Plain warm English; light Taglish only in empty and success states ("Wala pang order.", "Ayos!", "Kain na!", "Wala dito."). Buttons, labels and errors stay plain English and name the action or the fix.

## Layout
Mobile first, single column, max width 42 rem for the workspace; sticky tomato header; fixed bottom stack (composer + total + Show waiter) with safe-area insets; no sidebar anywhere.

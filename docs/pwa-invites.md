# Invite links and the installed app

Salo is a website with a web app manifest. Nothing needs installing: an invite link always works in the browser. Labels: `[verified in code]` is read from this repository; `[unverified until device check]` needs a real phone (owner task in `HANDOFF.md`).

## What the manifest says [verified in code]
`src/app/manifest.ts`: `id: "/"`, `scope: "/"`, `start_url: "/"`, `display: "standalone"`, `launch_handler: { client_mode: "navigate-existing" }`. `id: "/"` equals the id browsers already derive from `start_url`, so existing installs are not treated as a new app. There is no service worker, no offline invite page and no custom URI scheme.

## Invite page [verified in code]
- Opening `/i/<code>` as someone already in the order redirects to the order, including an ended one (read-only). A stranger gets the same 404 for ended and unknown codes.
- The page shows the code in a line "Using Salo from your Home Screen? Open it and enter ...". It is hidden with the `display-mode: standalone` media query, so it is gone inside the installed app.
- A failed join keeps the typed name and the URL; offline it says there is no connection and the name is still there.
- Each order has its own cookie, so joining order B never replaces order A.

## Android (Chrome, Messenger, Viber)
- Whether tapping an https link opens the installed app or a browser tab is the OS and browser's decision. Salo does not force it. `[unverified until device check]`
- `launch_handler.navigate-existing` asks Chromium to reuse an open app window; other browsers ignore it. `[unverified until device check]`
- In-app browsers (Messenger, Viber) open the link in their own view: the guest joins there, with that view's cookies. `[unverified until device check]`

## iOS (Safari, Home Screen app)
- A Home Screen app does not share cookies or storage with Safari. A guest who joined in Safari is a stranger in the Home Screen app. `[unverified until device check]`
- Links tapped in other apps open in Safari or an in-app browser, not the Home Screen app. `[unverified until device check]`
- The way into an order from the Home Screen app is the code field on the landing page; the invite page shows the code for that reason. There is no cross-context identity transfer: it would need a takeover path, which F09 rules out. `[verified in code]`

## Device check to do
Android (Chrome, Messenger) and iPhone (Safari, Home Screen app): open an invite link, note which context opens, confirm the hint is hidden inside the installed app, and write the results here.

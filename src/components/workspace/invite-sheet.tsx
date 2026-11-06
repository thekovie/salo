"use client";

import { Check, Copy, Share2, UserPlus, X } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { BRAND_HEX } from "@/lib/site";
import { inviteMessage, inviteUrl } from "@/lib/invite";

interface InviteSheetProps {
  appUrl: string;
  joinCode: string;
  title: string | null;
  peopleCount: number;
}

/**
 * Invite (brief 5.6): QR for the people at the table, a link for the group chat, a short code to read out.
 * A native <dialog>: focus is trapped and Escape closes it without extra code.
 */
const noSubscribe = () => () => {};

export function InviteSheet({ appUrl, joinCode, title, peopleCount }: InviteSheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "failed" | null>(null);
  const url = inviteUrl(appUrl, joinCode);
  // Same answer on the server and in the first client render (false), then the real one: no hydration mismatch.
  const canShare = useSyncExternalStore(noSubscribe, () => typeof navigator.share === "function", () => false);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!opened) return; // Only draw the QR once someone actually opens the sheet.
    let alive = true;
    QRCode.toDataURL(url, { margin: 1, width: 560, errorCorrectionLevel: "M", color: { dark: BRAND_HEX.ink, light: "#ffffff" } })
      .then((data) => alive && setQr(data))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [url, opened]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("link");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied(null), 2500);
  }

  async function share() {
    try {
      await navigator.share({ title: "Salo", text: inviteMessage(title, url), url });
    } catch {
      // Cancelled by the user, or not allowed: nothing to report.
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpened(true);
          dialog.current?.showModal();
        }}
        className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-on-band px-3.5 text-sm font-semibold text-band shadow-sm hover:brightness-95"
      >
        <UserPlus className="size-4" aria-hidden />
        Invite
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="invite-title"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
        className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-[1.6rem] bg-ticket p-0 text-ink shadow-ticket backdrop:bg-ink/55 backdrop:backdrop-blur-[2px]"
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="invite-title" className="text-2xl">
                Invite the table
              </h2>
              <p className="mt-0.5 text-sm text-ink-soft">
                {peopleCount <= 1 ? "Friends scan this to add their own dishes." : `${peopleCount} people are in this order.`}
              </p>
            </div>
            <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
              <X className="size-5" aria-hidden />
            </button>
          </div>

          <div className="mx-auto mt-4 aspect-square w-full max-w-64 rounded-2xl bg-white p-3 ring-[1.5px] ring-rule">
            {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL, not an optimisable asset */}
            {qr ? <img src={qr} alt={`QR code to join this order (code ${joinCode})`} className="size-full" /> : <div className="size-full animate-pulse rounded-lg bg-paper" aria-hidden />}
          </div>

          <div className="mt-4 text-center">
            <p className="text-sm text-ink-soft">Or enter this code on Salo</p>
            <p className="tally mt-1 text-3xl tracking-[0.25em] text-ink">
              <span aria-hidden>{joinCode}</span>
              <span className="sr-only">Code {joinCode.split("").join(" ")}</span>
            </p>
          </div>

          <div className="mt-5 grid gap-2">
            {canShare ? (
              <Button onClick={share}>
                <Share2 className="size-5" aria-hidden />
                Share invite
              </Button>
            ) : null}
            <Button variant={canShare ? "outline" : "primary"} onClick={copy}>
              {copied === "link" ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
              {copied === "link" ? "Link copied" : "Copy link"}
            </Button>
            <p role="status" className={copied === "failed" ? "min-h-5 text-center text-sm text-bad" : "min-h-5 text-center text-sm text-ok"}>
              {copied === "failed" ? `Couldn’t copy. The link is ${url}` : copied === "link" ? "Link copied. Paste it in your group chat." : ""}
            </p>
          </div>
          <p className="text-center text-xs text-ink-soft">Guests add and change their own dishes. Only the host confirms the order with the waiter.</p>
        </div>
      </dialog>
    </>
  );
}

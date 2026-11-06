"use client";

import { Check, Copy, ImageDown, LoaderCircle, Share2, X } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import type { SessionSnapshot } from "@/lib/snapshot";
import { track } from "@/lib/analytics";
import { buildSummary, itemsLabel, roundsLabel, summaryText } from "@/lib/summary";

const noSubscribe = () => () => {};
const DATE: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };

interface SummarySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: SessionSnapshot;
}

type Status = { kind: "idle" } | { kind: "copied" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

/** File-name safe: "salo-mang-inasal.png". */
const fileName = (title: string) => `salo-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "order"}.png`;

/**
 * "Who ordered what" (owner request): what each person, group and the table had, from the confirmed rounds, to settle
 * up later. Copy it as text for the group chat, or save it as an image.
 */
export function SummarySheet({ open, onOpenChange, snapshot }: SummarySheetProps) {
  const summary = useMemo(() => buildSummary(snapshot), [snapshot]);
  // The date is the device's own (its time zone), on screen, in the text and in the image.
  const dateLabel = useSyncExternalStore(noSubscribe, () => new Intl.DateTimeFormat(undefined, DATE).format(new Date()), () => "");
  const canShare = useSyncExternalStore(noSubscribe, () => typeof navigator.share === "function", () => false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const text = summaryText(summary, dateLabel);
  const empty = summary.sections.length === 0;

  const flash = (next: Status) => {
    setStatus(next);
    setTimeout(() => setStatus({ kind: "idle" }), 2500);
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      flash({ kind: "copied" });
      track({ name: "summary_copied" });
    } catch {
      setStatus({ kind: "error", message: "Couldn’t copy. Try Share, or select the text in your notes app." });
    }
  }

  async function shareText() {
    try {
      await navigator.share({ title: `${summary.title}: who ordered what`, text });
    } catch {
      // Cancelled: nothing to say.
    }
  }

  async function saveImage() {
    setStatus({ kind: "saving" });
    try {
      const response = await fetch(`/api/sessions/${snapshot.session.id}/summary?date=${encodeURIComponent(dateLabel)}`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Couldn’t make the image. Try again.");
      }
      const file = new File([await response.blob()], fileName(summary.title), { type: "image/png" });
      // Phones: the share sheet has "Save image" / Photos. Elsewhere: an ordinary download.
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `${summary.title}: who ordered what` });
          track({ name: "summary_image_saved", props: { method: "share" } });
        } catch (error) {
          if ((error as Error).name === "AbortError") return setStatus({ kind: "idle" });
          throw error;
        }
      } else {
        const url = URL.createObjectURL(file);
        const link = Object.assign(document.createElement("a"), { href: url, download: file.name });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        track({ name: "summary_image_saved", props: { method: "download" } });
      }
      flash({ kind: "saved" });
    } catch (error) {
      setStatus({ kind: "error", message: (error as Error).message || "Couldn’t make the image. Try again." });
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="flex items-start justify-between gap-3">
          <div>
            <DrawerTitle className="font-display text-2xl font-medium">Who ordered what</DrawerTitle>
            <DrawerDescription className="mt-0.5 text-sm text-ink-soft">
              {summary.title} · {roundsLabel(summary.rounds)}. Keep it for settling up later. No prices included.
            </DrawerDescription>
          </div>
          <DrawerClose aria-label="Close" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
            <X className="size-5" aria-hidden />
          </DrawerClose>
        </div>

        {empty ? (
          <p className="mt-6 rounded-2xl bg-paper px-4 py-6 text-center text-ink-soft">Nothing confirmed with the waiter yet. Confirm a round first; only confirmed dishes count.</p>
        ) : (
          <div className="ticket mt-4 px-5" aria-label="Summary preview" data-ph-mask="">
            <ul className="divide-y-[1.5px] divide-dashed divide-rule">
              {summary.sections.map((s) => (
                <li key={`${s.title}:${s.note}`} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 text-lg leading-snug">
                      {s.title}
                      {s.note ? <span className="ml-1.5 font-sans text-sm text-ink-soft">· {s.note}</span> : null}
                    </p>
                    <span className="tally shrink-0 text-sm text-ink-soft">{itemsLabel(s.items)}</span>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {s.lines.map((line) => (
                      <li key={line.label} className="flex items-baseline justify-between gap-3 pl-3 text-ink-soft">
                        <span className="min-w-0 break-words">{line.label}</span>
                        <span className="tally shrink-0 text-tomato-ink">×{line.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between border-t-[1.5px] border-dashed border-rule py-3">
              <span className="text-sm text-ink-soft">Total</span>
              <span className="tally text-xl text-ink">{itemsLabel(summary.total)}</span>
            </div>
            {summary.unconfirmedRound ? <p className="pb-3 text-sm text-ink-soft">Round {summary.unconfirmedRound} was never confirmed with the waiter, so it isn’t included.</p> : null}
          </div>
        )}

        <div className="mt-4 grid gap-2">
          <Button disabled={empty} onClick={() => void copy()}>
            {status.kind === "copied" ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
            {status.kind === "copied" ? "Copied" : "Copy text"}
          </Button>
          <div className={canShare ? "grid grid-cols-2 gap-2" : "grid"}>
            <Button variant="outline" disabled={empty || status.kind === "saving"} onClick={() => void saveImage()}>
              {status.kind === "saving" ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : status.kind === "saved" ? <Check className="size-5" aria-hidden /> : <ImageDown className="size-5" aria-hidden />}
              {status.kind === "saving" ? "Making image…" : status.kind === "saved" ? "Saved" : "Save image"}
            </Button>
            {canShare ? (
              <Button variant="outline" disabled={empty} onClick={() => void shareText()}>
                <Share2 className="size-5" aria-hidden />
                Share text
              </Button>
            ) : null}
          </div>
          <p role="status" className={status.kind === "error" ? "min-h-5 text-center text-sm text-bad" : "min-h-5 text-center text-sm text-ok"}>
            {status.kind === "error" ? status.message : status.kind === "copied" ? "Copied. Paste it in your group chat." : status.kind === "saved" ? "Image ready." : ""}
          </p>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

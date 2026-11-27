"use client";

import { ClipboardList, CircleCheck, Coins, ReceiptText } from "lucide-react";
import { useState } from "react";
import { Ticker } from "@/components/motion/ticker";
import { Button } from "@/components/ui/button";
import type { AddInput } from "@/hooks/use-session";
import { track } from "@/lib/analytics";
import { shortShareLabel } from "@/lib/kkb";
import type { SessionSnapshot } from "@/lib/snapshot";
import { cn } from "@/lib/utils";
import { Composer } from "./composer";
import type { View } from "./view-tabs";

type Recipients = Pick<React.ComponentProps<typeof Composer>, "people" | "names" | "groups">;

interface DockProps {
  dockRef: React.Ref<HTMLDivElement>;
  snapshot: SessionSnapshot;
  isOpen: boolean;
  isHost: boolean;
  total: number;
  ready: { ready: number; total: number };
  iAmReady: boolean;
  shareLabel: string | null;
  onShare: () => void;
  /** A confirmed round has a ticket to show even when the session is not open for adding. */
  hasConfirmedTicket: boolean;
  correctionsThisRound: number;
  onMode: (mode: "review" | "waiter") => void;
  recipients: Recipients;
  view: View;
  detailsSignal: number;
  onAdd: (input: AddInput) => void;
  onMyOrder: () => void;
}

/** The fixed bottom bar: composer, item count and the main buttons. The buttons hide while the composer has focus. */
export function Dock({ dockRef, snapshot, isOpen, isHost, total, ready, iAmReady, shareLabel, onShare, hasConfirmedTicket, correctionsThisRound, onMode, recipients, view, detailsSignal, onAdd, onMyOrder }: DockProps) {
  const [composerActive, setComposerActive] = useState(false);
  return (
    <div ref={dockRef} className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-paper from-70% to-transparent pt-6 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
      <div className="mx-auto max-w-2xl space-y-2 px-3">
        {isOpen ? <Composer dishNames={snapshot.dishNames} entries={snapshot.entries} defaults={snapshot.settlement.defaults} {...recipients} view={view} detailsSignal={detailsSignal} onActiveChange={setComposerActive} onAdd={onAdd} /> : null}
        {isOpen && composerActive ? null : (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-2">
            <div className="min-w-0">
              <p className="whitespace-nowrap text-ink-soft" data-testid="round-total">
                <Ticker value={total} className="tally text-xl text-ink" /> {total === 1 ? "item" : "items"}
                <span className="hidden sm:inline"> this round</span>
              </p>
              {isHost && isOpen && ready.total > 0 ? (
                <p className="whitespace-nowrap text-sm text-ink-soft">
                  {ready.ready}/{ready.total} {ready.total === 1 ? "guest" : "guests"} ready
                </p>
              ) : null}
            </div>
            {/* Under 360 px the count keeps its own line and the buttons share the rows below it. */}
            <div className="flex flex-wrap gap-2 max-[359px]:basis-full max-[359px]:*:flex-1 max-[359px]:*:justify-center">
              {shareLabel ? (
                <Button variant="outline" data-tour="my-share" onClick={onShare} className="max-[429px]:px-3">
                  <Coins className="size-5 max-[429px]:hidden" aria-hidden />
                  <span className="max-[429px]:hidden">{shareLabel}</span>
                  <span className="min-[430px]:hidden">{shortShareLabel(shareLabel)}</span>
                </Button>
              ) : null}
              {isOpen && isHost ? (
                <Button variant="outline" data-tour="review" className="max-[429px]:px-3" onClick={() => (onMode("review"), track({ name: "review_opened" }))} disabled={total === 0 && correctionsThisRound === 0}>
                  <ReceiptText className="size-5" aria-hidden />
                  Review order
                </Button>
              ) : isOpen || hasConfirmedTicket ? (
                <Button variant="outline" data-tour="ticket" className="max-[429px]:px-3" onClick={() => (onMode("waiter"), track({ name: "waiter_view_opened" }))} disabled={!hasConfirmedTicket && total === 0 && correctionsThisRound === 0}>
                  <ReceiptText className="size-5" aria-hidden />
                  Ticket
                </Button>
              ) : null}
              {!isHost && isOpen ? (
                <button
                  type="button"
                  data-tour="ready"
                  onClick={onMyOrder}
                  className={cn(
                    "inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 font-semibold whitespace-nowrap transition-colors",
                    iAmReady ? "bg-ok-wash text-ok" : "border-[1.5px] border-input bg-ticket text-ink hover:bg-paper",
                  )}
                >
                  {iAmReady ? <CircleCheck className="size-5" aria-hidden /> : <ClipboardList className="size-5" aria-hidden />}
                  {iAmReady ? "My order · Ready" : "My order"}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

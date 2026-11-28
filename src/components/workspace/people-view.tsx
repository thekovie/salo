"use client";

import { ChevronDown, CircleCheck, Clock, ReceiptText } from "lucide-react";
import { useId, useState } from "react";
import { hasSubLines, preparationLabel } from "@/lib/consolidate";
import { everyone, type SessionSnapshot, type SnapshotEntry } from "@/lib/snapshot";
import { cn } from "@/lib/utils";
import { normalizeText } from "@/lib/dish-name";
import { byPerson, findLikelyDuplicates, readinessSummary, type PersonBucket } from "@/lib/views";
import { ClaimControl, claimSets } from "./claim-control";
import { CohostToggle } from "./cohost-toggle";
import { RemoveGuestSheet } from "./remove-guest-sheet";

interface PeopleViewProps {
  snapshot: SessionSnapshot;
  entries: SnapshotEntry[];
  canClaim: boolean;
  onClaim: (entry: SnapshotEntry) => void;
  onRemoveDuplicate: (entry: SnapshotEntry) => void;
  /** Host, order open: remove a guest. Resolves true when accepted. */
  onRemoveGuest?: (participantId: string, name: string, reason: string | null) => Promise<boolean>;
  /** Host, order open: make a guest a co-host or stop that. Resolves true when accepted. */
  onSetCohost?: (participantId: string, name: string, cohost: boolean) => Promise<boolean>;
  roundNumber: number;
  /** Opens "who ordered what" (once a round is confirmed). */
  onSummary?: () => void;
}

function Lines({ bucket, forOthers = 0, isMe = false, claimable, canClaimEntry, myClaims, onClaim }: { bucket: PersonBucket; forOthers?: number; isMe?: boolean; claimable: boolean; canClaimEntry: (e: SnapshotEntry) => boolean; myClaims: Set<string>; onClaim: (e: SnapshotEntry) => void }) {
  if (bucket.entries.length === 0) return <p className="text-sm text-ink-soft">{forOthers > 0 ? `Nothing for ${isMe ? "you" : bucket.title} yet · added ${forOthers} for others` : "Nothing yet."}</p>;
  if (claimable) {
    // Guests see each dish separately so they can say which one is theirs.
    return (
      <ul className="space-y-1">
        {bucket.entries.map((e) => (
          <li key={e.id} className="flex min-h-11 items-center justify-between gap-3">
            <span className="min-w-0 break-words">
              {e.dishName}
              {e.variant || e.instructions ? <span className="text-ink-soft"> · {[e.variant, e.instructions].filter(Boolean).join(" · ")}</span> : null}
              <span className="tally ml-2 text-tomato-ink">×{e.quantity}</span>
            </span>
            {canClaimEntry(e) ? <ClaimControl entry={e} asked={myClaims.has(e.batchId)} onClaim={onClaim} /> : null}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="space-y-1">
      {bucket.ticket.dishes.map((dish) => (
        <li key={dish.dishId}>
          <div className="flex justify-between gap-3">
            <span className="min-w-0 break-words">{dish.name}</span>
            <span className="tally text-tomato-ink">×{dish.quantity}</span>
          </div>
          {hasSubLines(dish) ? (
            <ul className="border-l-[1.5px] border-rule pl-3 text-sm text-ink-soft">
              {dish.preparations.map((p) => (
                <li key={p.key} className="flex justify-between">
                  <span>{preparationLabel(p)}</span>
                  <span className="tally">×{p.quantity}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Above this many cards each starts as its header only. */
const COLLAPSE_ABOVE = 6;

/** By person (brief 5.3, 5.8): who ordered what, who hasn't ordered, who is ready; guests claim dishes recorded for them. */
export function PeopleView({ snapshot, entries, canClaim, onClaim, onRemoveDuplicate, onRemoveGuest, onSetCohost, roundNumber, onSummary }: PeopleViewProps) {
  const panelId = useId();
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({});
  // The host usually orders for others; an empty host card is noise. Guests with nothing yet stay visible.
  // Removed guests only show while something is still marked for them.
  const draftOpen = snapshot.rounds.find((r) => r.id === snapshot.activeRoundId)?.status === "DRAFT";
  const removedIds = new Set(snapshot.removedPeople.map((p) => p.id));
  const all = byPerson(entries, everyone(snapshot)).filter((b) => (b.role !== "HOST" && !(b.participantId && removedIds.has(b.participantId))) || b.entries.length > 0);
  // A guest sees dishes the host typed under their own name inside their own card, not as a second "them".
  const myName = normalizeText(snapshot.me.displayName);
  const forMe = snapshot.me.role === "HOST" ? undefined : all.find((b) => b.kind === "name" && normalizeText(b.title) === myName);
  const rest = all.filter((b) => b !== forMe);
  const collapsible = rest.length > COLLAPSE_ABOVE;
  // On a large table the guest's own card leads (the host's stays in place, collapsed).
  const leads = (b: PersonBucket) => snapshot.me.role !== "HOST" && b.participantId === snapshot.me.participantId;
  const buckets = collapsible ? [...rest].sort((a, b) => Number(leads(b)) - Number(leads(a))) : rest;
  const ready = readinessSummary(snapshot, entries, snapshot.activeRoundId);
  const isHost = snapshot.me.role === "HOST";
  const hints = isHost ? findLikelyDuplicates(entries, snapshot.participants) : [];
  const { hostIds, myClaims } = claimSets(snapshot);

  if (buckets.length === 0 && !forMe) {
    return (
      <div className="ticket px-5 py-8 text-center">
        <p className="font-display text-xl">Ikaw pa lang.</p>
        <p className="mt-1 text-ink-soft">Nobody else is in this order yet. Tap Invite to bring the table in.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-ph-mask="">
      {onSummary ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-paper px-4 py-2.5">
          <p className="text-sm text-ink-soft">For settling up: who had what, and KKB with prices.</p>
          <button type="button" onClick={onSummary} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 font-semibold text-ink hover:bg-ink/6">
            <ReceiptText className="size-4" aria-hidden />
            Who ordered what
          </button>
        </div>
      ) : null}
      {hints.length > 0 ? (
        <section aria-label="Possible double orders" className="rounded-2xl bg-saffron-wash p-4 text-ink">
          <h3 className="font-sans text-sm font-semibold">Possibly ordered twice</h3>
          <ul className="mt-2 space-y-2">
            {hints.map((h) => (
              <li key={`${h.hostEntry.id}:${h.participantId}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {h.personName} added {h.dishName} ×{h.ownEntry.quantity}, and you also added it for them (×{h.hostEntry.quantity}).
                </span>
                <button type="button" onClick={() => onRemoveDuplicate(h.hostEntry)} className="min-h-11 cursor-pointer rounded-full bg-ticket px-3 font-semibold ring-[1.5px] ring-input hover:bg-paper">
                  Remove your copy
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {buckets.map((bucket, index) => {
        const isMe = bucket.participantId === snapshot.me.participantId;
        const guestReady = bucket.participantId ? ready.readyIds.has(bucket.participantId) : false;
        const noOrder = bucket.participantId ? ready.noOrderIds.has(bucket.participantId) : false;
        // Dishes the host added under a typed name, for nobody, or straight onto this guest's own card can be claimed.
        const claimable = canClaim && (bucket.kind === "name" || bucket.kind === "unassigned" || isMe) && bucket.entries.some((e) => hostIds.has(e.submittedBy));
        const open = !collapsible || (toggled[bucket.key] ?? (leads(bucket) || claimable));
        const regionId = `${panelId}-${index}`; // bucket keys can hold spaces, which split an id list
        const name = (
          <>
            {bucket.title}
            {isMe ? <span className="ml-1.5 font-sans text-sm text-ink-soft">(you)</span> : null}
            {bucket.role === "HOST" ? <span className="ml-1.5 font-sans text-sm text-ink-soft">· host</span> : null}
            {bucket.cohost ? <span className="ml-1.5 whitespace-nowrap font-sans text-sm text-ink-soft">· co-host</span> : null}
            {bucket.kind === "name" ? <span className="ml-1.5 font-sans text-sm text-ink-soft">· added by the host</span> : null}
          </>
        );
        return (
          <section key={bucket.key} className="ticket px-5">
            <div className={cn("flex flex-wrap items-center justify-between gap-y-1", collapsible ? "gap-x-2" : "gap-x-3", open && "mb-2")}>
              <h3 className="min-w-0 text-lg break-words">
                {collapsible ? (
                  <button type="button" aria-expanded={open} aria-controls={regionId} onClick={() => setToggled({ ...toggled, [bucket.key]: !open })} className="inline-flex min-h-11 max-w-full cursor-pointer items-center gap-1 text-left">
                    <span className="min-w-0 wrap-anywhere">
                      {name}
                      <span className="sr-only"> · Show {bucket.title}&rsquo;s order</span>
                    </span>
                    <ChevronDown className={cn("size-4 shrink-0 text-ink-soft", open && "rotate-180")} aria-hidden />
                  </button>
                ) : (
                  name
                )}
              </h3>
              <div className={cn("ml-auto flex shrink-0 items-center", collapsible ? "gap-1.5" : "gap-2")}>
                {bucket.role === "GUEST" && !(bucket.participantId && removedIds.has(bucket.participantId)) ? (
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", guestReady ? "bg-ok-wash text-ok" : "bg-ink/6 text-ink-soft")}>
                    {guestReady ? <CircleCheck className="size-3.5" aria-hidden /> : <Clock className="size-3.5" aria-hidden />}
                    {/* Icon only below 400 px (v4 `max-*` is strict <) with collapsed cards, so the header stays one row. */}
                    <span className={collapsible ? "max-[400px]:sr-only" : undefined}>{guestReady ? "Ready" : noOrder ? "No order yet" : "Still choosing"}</span>
                  </span>
                ) : null}
                <span className="tally whitespace-nowrap text-sm text-ink-soft">
                  {bucket.ticket.totalItems}
                  <span className="max-[375px]:sr-only"> {bucket.ticket.totalItems === 1 ? "item" : "items"}</span>
                </span>
                {onRemoveGuest && bucket.role === "GUEST" && bucket.participantId && !removedIds.has(bucket.participantId) ? (
                  <RemoveGuestSheet
                    name={bucket.title}
                    roundNumber={roundNumber}
                    itemCount={draftOpen ? entries.filter((e) => e.submittedBy === bucket.participantId).reduce((n, e) => n + e.quantity, 0) : 0}
                    onRemove={(reason) => onRemoveGuest(bucket.participantId as string, bucket.title, reason)}
                  />
                ) : null}
              </div>
            </div>
            <div id={collapsible ? regionId : undefined} hidden={!open}>
            {open ? (<>
            {onSetCohost && bucket.role === "GUEST" && bucket.participantId && !removedIds.has(bucket.participantId) ? (
              <CohostToggle name={bucket.title} isCohost={bucket.cohost} onSet={(cohost) => onSetCohost(bucket.participantId as string, bucket.title, cohost)} />
            ) : null}
            <Lines bucket={bucket} isMe={isMe} forOthers={entries.filter((e) => e.submittedBy === bucket.participantId && e.attribution.participantId !== bucket.participantId).length} claimable={claimable} canClaimEntry={(e) => hostIds.has(e.submittedBy) && !e.id.startsWith("pending:")} myClaims={myClaims} onClaim={onClaim} />
            {isMe && forMe ? (
              <div className="tear mt-3 pt-3">
                <p className="mb-1 text-sm text-ink-soft">The host added these for &ldquo;{forMe.title}&rdquo;. Yours?</p>
                <Lines bucket={forMe} claimable={canClaim} canClaimEntry={(e) => hostIds.has(e.submittedBy) && !e.id.startsWith("pending:")} myClaims={myClaims} onClaim={onClaim} />
              </div>
            ) : null}
            </>) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

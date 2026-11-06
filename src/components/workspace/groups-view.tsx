"use client";

import { Users } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { hasSubLines, preparationLabel } from "@/lib/consolidate";
import type { SessionSnapshot, SnapshotEntry } from "@/lib/snapshot";
import { byGroup, type GroupBucket } from "@/lib/views";

interface GroupsViewProps {
  snapshot: SessionSnapshot;
  entries: SnapshotEntry[];
  onSetMembers: (label: string, memberIds: string[]) => void;
}

function MembersDialog({ group, people, onSave }: { group: GroupBucket; people: SessionSnapshot["participants"]; onSave: (ids: string[]) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [selected, setSelected] = useState<string[]>(group.memberIds);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSelected(group.memberIds);
          dialog.current?.showModal();
        }}
        className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-semibold hover:bg-ink/6"
      >
        <Users className="size-4" aria-hidden /> {group.memberIds.length ? "Edit members" : "Add members"}
      </button>
      <dialog ref={dialog} aria-labelledby={titleId} className="m-auto w-[min(24rem,calc(100vw-2rem))] ticket px-5 text-ink backdrop:bg-ink/55">
        <form
          method="dialog"
          onSubmit={() => onSave(selected)}
        >
          <h2 id={titleId} className="text-xl">
            Who&rsquo;s in {group.label}?
          </h2>
          <p className="mt-1 text-sm text-ink-soft">Optional. Salo never guesses who gets which dish.</p>
          <fieldset className="mt-3 space-y-1">
            <legend className="sr-only">Members</legend>
            {people.map((p) => (
              <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 hover:bg-paper">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--tomato)]"
                  checked={selected.includes(p.id)}
                  onChange={(e) => setSelected((list) => (e.target.checked ? [...list, p.id] : list.filter((id) => id !== p.id)))}
                />
                {p.displayName}
              </label>
            ))}
          </fieldset>
          <p className="mt-2 text-xs text-ink-soft">Only people who joined this order can be picked.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** By group (brief 5.9): collective orders under their label, with optional members. */
export function GroupsView({ snapshot, entries, onSetMembers }: GroupsViewProps) {
  const groups = byGroup(entries, snapshot.groups);
  const name = (id: string) => snapshot.participants.find((p) => p.id === id)?.displayName ?? "Someone";
  if (groups.length === 0) {
    return (
      <div className="ticket px-5 py-10 text-center">
        <p className="font-display text-xl">No group orders yet.</p>
        <p className="mt-1 text-ink-soft">When one person orders for a few, open Details and choose &ldquo;A group&rdquo;.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section key={group.key} className="ticket px-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg">{group.label}</h3>
            <span className="tally text-sm text-ink-soft">
              {group.ticket.totalItems} {group.ticket.totalItems === 1 ? "item" : "items"}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {group.memberIds.length ? (
              <ul aria-label={`Members of ${group.label}`} className="flex flex-wrap gap-1.5">
                {group.memberIds.map((id) => (
                  <li key={id} className="rounded-full bg-saffron-wash px-2.5 py-0.5 text-sm text-saffron-ink">
                    {name(id)}
                  </li>
                ))}
              </ul>
            ) : null}
            {snapshot.me.role === "HOST" || !group.createdBy || group.createdBy === snapshot.me.participantId ? (
              <MembersDialog group={group} people={snapshot.participants} onSave={(ids) => onSetMembers(group.label, ids)} />
            ) : null}
          </div>
          {group.entries.length ? (
            <ul className="mt-2 space-y-1">
              {group.ticket.dishes.map((dish) => (
                <li key={dish.dishId}>
                  <div className="flex justify-between gap-3">
                    <span>{dish.name}</span>
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
          ) : (
            <p className="mt-2 text-sm text-ink-soft">No dishes for this group yet.</p>
          )}
        </section>
      ))}
    </div>
  );
}

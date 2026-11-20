"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import type { EntryChanges, OverlayEntry } from "@/hooks/use-session";
import { attributionOf, recipientOf, same, type Recipient } from "@/lib/recipient";
import { ConfirmDialog } from "./confirm-dialog";
import { DetailFields, type DetailField } from "./detail-fields";
import { RecipientPicker } from "./recipient-picker";

interface EditDishSheetProps {
  entry: OverlayEntry | null;
  onClose: () => void;
  meId: string;
  people: { id: string; displayName: string }[];
  names: string[];
  groups: string[];
  /** Only what actually changed is passed. */
  onSave: (entry: OverlayEntry, changes: EntryChanges) => void;
  /** Host: take this dish off the order everywhere (Undo in the toast brings back the open-round part). Resolves to an error message or null. */
  onUnavailable?: (entry: OverlayEntry) => Promise<string | null>;
  /** The dish is also in a confirmed round, so part of this can't be undone: ask first. */
  unavailableIsFinal?: boolean;
}

/**
 * Correct a draft dish (brief 4.1, 5.12): size, instructions, and who it's for. The dish itself and its quantity stay
 * where they are (the quantity on the stepper; a different dish is a remove-and-add, so consolidation stays honest).
 */
export function EditDishSheet(props: EditDishSheetProps) {
  return (
    <Drawer open={props.entry !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DrawerContent data-ph-mask="">{props.entry ? <EditBody key={props.entry.id} {...props} entry={props.entry} /> : null}</DrawerContent>
    </Drawer>
  );
}

function EditBody({ entry, onClose, meId, people, names, groups, onSave, onUnavailable, unavailableIsFinal }: EditDishSheetProps & { entry: OverlayEntry }) {
  const id = useId();
  const original = recipientOf(entry, meId, people);
  const [recipient, setRecipient] = useState<Recipient>(original);
  const [typed, setTyped] = useState("");
  const [variant, setVariant] = useState(entry.variant ?? "");
  const [instructions, setInstructions] = useState(entry.instructions ?? "");
  const [field, setField] = useState<DetailField | null>(null);
  const [error, setError] = useState("");

  function save(event: React.FormEvent) {
    event.preventDefault();
    const changes: EntryChanges = {};
    if (variant.trim() !== (entry.variant ?? "")) changes.variant = variant.trim() || null;
    if (instructions.trim() !== (entry.instructions ?? "")) changes.instructions = instructions.trim() || null;
    if (!same(recipient, original)) {
      const attribution = attributionOf(recipient, typed);
      if (!attribution) return setError(recipient.kind === "NEW_GROUP" ? "Name the group, or pick someone." : "Type the person's name, or pick someone.");
      changes.attribution = attribution;
    }
    if (Object.keys(changes).length > 0) onSave(entry, changes);
    onClose();
  }

  return (
    <form onSubmit={save} noValidate>
      <div className="flex items-start justify-between gap-3">
        <div>
          <DrawerTitle className="font-display text-2xl font-medium">Edit {entry.dishName}</DrawerTitle>
          <DrawerDescription className="mt-0.5 text-sm text-ink-soft">Change the size, notes or who it&rsquo;s for. Quantity stays on the ticket.</DrawerDescription>
        </div>
        <DrawerClose aria-label="Close" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
          <X className="size-5" aria-hidden />
        </DrawerClose>
      </div>
      <div className="mt-4 space-y-4">
        <RecipientPicker
          id={id}
          label="Who’s it for?"
          value={recipient}
          onChange={(r) => {
            setRecipient(r);
            setError("");
          }}
          typed={typed}
          onTyped={setTyped}
          people={people}
          names={names}
          groups={groups}
        />
        <span className="mt-4 block text-sm font-semibold">Size and note</span>
        <DetailFields id={id} open={field} onOpen={setField} variant={variant} onVariant={setVariant} instructions={instructions} onInstructions={setInstructions} />
      </div>
      <p role="alert" className={error ? "mt-3 rounded-xl bg-bad-wash px-3 py-2 text-sm text-bad" : "sr-only"}>
        {error}
      </p>
      <div className="mt-5 grid gap-2">
        <Button type="submit">Save changes</Button>
        {onUnavailable ? (
          unavailableIsFinal ? (
            <ConfirmDialog
              danger
              title={`Mark ${entry.dishName} unavailable?`}
              body={<p>Confirmed dishes come off now. This can&rsquo;t be undone.</p>}
              confirmLabel="Mark unavailable"
              dismissLabel="Not now"
              busyLabel="Marking…"
              onConfirm={async () => {
                const failure = await onUnavailable(entry);
                if (!failure) onClose();
                return failure;
              }}
              trigger={(open) => (
                <Button type="button" variant="danger" onClick={open}>
                  Mark {entry.dishName} unavailable
                </Button>
              )}
            />
          ) : (
            <Button
              type="button"
              variant="danger"
              onClick={async () => {
                const failure = await onUnavailable(entry);
                if (failure) setError(failure);
                else onClose();
              }}
            >
              Mark {entry.dishName} unavailable
            </Button>
          )
        ) : null}
        <DrawerClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DrawerClose>
      </div>
    </form>
  );
}

"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import type { EntryChanges, OverlayEntry } from "@/hooks/use-session";
import { attributionOf, recipientOf, same, type Recipient } from "@/lib/recipient";
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

function EditBody({ entry, onClose, meId, people, names, groups, onSave }: EditDishSheetProps & { entry: OverlayEntry }) {
  const id = useId();
  const original = recipientOf(entry, meId, people);
  const [recipient, setRecipient] = useState<Recipient>(original);
  const [typed, setTyped] = useState("");
  const [variant, setVariant] = useState(entry.variant ?? "");
  const [instructions, setInstructions] = useState(entry.instructions ?? "");
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
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-variant`} className="text-sm font-semibold">
              Size or variant
            </label>
            <input id={`${id}-variant`} value={variant} onChange={(e) => setVariant(e.target.value)} maxLength={40} placeholder="Large, spicy…" className="mt-1 min-h-11 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base" />
          </div>
          <div>
            <label htmlFor={`${id}-notes`} className="text-sm font-semibold">
              Instructions
            </label>
            <input id={`${id}-notes`} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={140} placeholder="No sauce, less ice…" className="mt-1 min-h-11 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base" />
          </div>
        </div>
      </div>
      <p role="alert" className={error ? "mt-3 rounded-xl bg-bad-wash px-3 py-2 text-sm text-bad" : "sr-only"}>
        {error}
      </p>
      <div className="mt-5 grid gap-2">
        <Button type="submit">Save changes</Button>
        <DrawerClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DrawerClose>
      </div>
    </form>
  );
}

"use client";

import { UsersRound } from "lucide-react";
import { useRovingRadio } from "@/hooks/use-roving-radio";
import { recipientChips, same, type Recipient } from "@/lib/recipient";
import { cn } from "@/lib/utils";

interface RecipientPickerProps {
  id: string;
  /** Visible heading text the group is labelled by. */
  label: string;
  value: Recipient;
  onChange: (next: Recipient) => void;
  /** Name typed for "+ Someone else" / "+ New group". */
  typed: string;
  onTyped: (next: string) => void;
  people: { id: string; displayName: string }[];
  names: string[];
  groups: string[];
  autoFocusName?: boolean;
}

/** "Who's it for?" chips (one Tab stop, arrow keys move and select), plus a name field for someone new. */
export function RecipientPicker({ id, label, value, onChange, typed, onTyped, people, names, groups, autoFocusName = true }: RecipientPickerProps) {
  const chips = recipientChips(people, names, groups);
  const checkedIndex = chips.findIndex((c) => same(value, c.r));
  const radio = useRovingRadio(chips.length, checkedIndex, (i) => onChange(chips[i].r));
  const isNew = value.kind === "NEW_PERSON" || value.kind === "NEW_GROUP";
  return (
    <div>
      <span className="block pr-10 text-sm font-semibold" id={`${id}-for`}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={`${id}-for`} className="mt-1.5 flex flex-wrap gap-1.5" data-ph-mask="">
        {chips.map(({ r, label: chipLabel, group }, index) => {
          const checked = index === checkedIndex;
          return (
            <button
              key={JSON.stringify(r)}
              type="button"
              role="radio"
              aria-checked={checked}
              {...radio(index)}
              onClick={() => onChange(r)}
              className={cn(
                "inline-flex min-h-11 max-w-full cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-sm font-semibold transition-colors",
                checked ? "border-ink bg-ink text-paper" : "border-input bg-ticket text-ink hover:bg-paper",
              )}
            >
              {group ? <UsersRound className="size-4 shrink-0" aria-hidden /> : null}
              <span className="truncate">{chipLabel}</span>
            </button>
          );
        })}
      </div>
      {isNew ? (
        <>
          <label htmlFor={`${id}-label`} className="sr-only">
            {value.kind === "NEW_GROUP" ? "Group name" : "Person's name"}
          </label>
          <input
            id={`${id}-label`}
            autoFocus={autoFocusName}
            value={typed}
            onChange={(e) => onTyped(e.target.value)}
            maxLength={40}
            placeholder={value.kind === "NEW_GROUP" ? "Group name, e.g. Miguel's group" : "Name, e.g. Miguel"}
            className="mt-2 min-h-11 w-full rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base"
          />
        </>
      ) : null}
    </div>
  );
}

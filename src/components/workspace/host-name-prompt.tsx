"use client";

import { UserRound } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HostNamePromptProps {
  onSave: (name: string) => void;
  /** Hides the card for now (the order view). Omitted where the prompt must stay (KKB). */
  onLater?: () => void;
  label?: string;
}

/**
 * The host starts as "Host" so starting an order stays one tap; this asks for their real name, in plain sight, until
 * they give one. Never a modal and never autofocused (no keyboard popping up uninvited).
 */
export function HostNamePrompt({ onSave, onLater, label = "What should the table call you?" }: HostNamePromptProps) {
  const id = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      noValidate
      aria-label="Your name"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setError("Type your name so the table knows which dishes are yours.");
        onSave(name.trim());
      }}
      className="fade-in rounded-2xl bg-saffron-wash px-4 py-3 text-ink"
    >
      <label htmlFor={`${id}-name`} className="flex items-center gap-2 font-semibold">
        <UserRound className="size-5 shrink-0 text-saffron-ink" aria-hidden />
        {label}
      </label>
      <p className="mt-0.5 text-sm text-ink-soft">Guests see it on your dishes instead of &ldquo;Host&rdquo;.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          id={`${id}-name`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          maxLength={40}
          autoComplete="given-name"
          enterKeyHint="done"
          placeholder="Your name"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-h-11 min-w-0 flex-1 basis-40 rounded-xl border-[1.5px] border-input bg-ticket px-3 text-base aria-invalid:border-bad"
        />
        <Button type="submit" variant="outline">
          Save
        </Button>
        {onLater ? (
          <Button variant="ghost" onClick={onLater}>
            Later
          </Button>
        ) : null}
      </div>
      <p id={`${id}-error`} role="alert" className={cn("text-sm text-bad", error ? "mt-1" : "sr-only")}>
        {error}
      </p>
    </form>
  );
}

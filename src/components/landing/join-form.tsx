"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { JOIN_CODE_LENGTH, normalizeJoinCode } from "@/lib/join-code";

/** Join with the short code the host reads out (for when scanning the QR is awkward). */
export function JoinForm() {
  const router = useRouter();
  const id = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const clean = normalizeJoinCode(code);
    if (clean.length !== JOIN_CODE_LENGTH) {
      setError(`Codes are ${JOIN_CODE_LENGTH} characters, like K7P2QX.`);
      return;
    }
    router.push(`/j/${clean}`);
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-sm">
      <label htmlFor={id} className="text-sm font-semibold">
        Joining a table? Enter its code
      </label>
      <div className="mt-1.5 flex gap-2">
        <Input
          id={id}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setError("");
          }}
          maxLength={JOIN_CODE_LENGTH + 2}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="6-letter code"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="tally text-lg tracking-[0.2em] uppercase placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:normal-case"
        />
        <Button type="submit" variant="outline">
          Join
        </Button>
      </div>
      <p id={`${id}-error`} role="alert" className="mt-1.5 min-h-5 text-sm text-bad">
        {error}
      </p>
    </form>
  );
}

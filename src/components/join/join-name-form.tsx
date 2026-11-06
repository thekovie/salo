"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api-client";

export function JoinNameForm({ sessionId, code }: { sessionId: string; code: string }) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Type your name so the table knows whose order is whose.");
      return;
    }
    setBusy(true);
    try {
      const { id: joined } = await api<{ id: string }>(`/api/sessions/${sessionId}/join`, { method: "POST", body: { code, displayName: name } });
      router.replace(`/s/${joined}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6 space-y-3">
      <div>
        <label htmlFor={id} className="text-sm font-semibold">
          Your name
        </label>
        <Input
          id={id}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          maxLength={40}
          autoComplete="given-name"
          autoFocus
          placeholder="e.g. Rafa"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-1.5"
        />
        <p id={`${id}-error`} role="alert" className="mt-1.5 min-h-5 text-sm text-bad">
          {error}
        </p>
      </div>
      <Button type="submit" size="lg" disabled={busy} className="w-full">
        {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : null}
        {busy ? "Joining…" : "Join the order"}
        {busy ? null : <ArrowRight className="size-5" aria-hidden />}
      </Button>
    </form>
  );
}

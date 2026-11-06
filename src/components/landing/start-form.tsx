"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** "Start an order": creates the session (and the host's credential cookie), then opens the workspace. */
export function StartForm({ label = "Start an order" }: { label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [message, setMessage] = useState("");

  async function start() {
    setState("busy");
    try {
      const response = await fetch("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = (await response.json().catch(() => null)) as { data?: { id: string }; error?: { message: string } } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "Could not start an order. Try again.");
      router.push(`/s/${body.data.id}`);
    } catch (error) {
      setMessage(error instanceof Error && error.message !== "Failed to fetch" ? error.message : "No connection. Check your data or Wi-Fi and try again.");
      setState("error");
    }
  }

  return (
    <div>
      <Button size="lg" onClick={start} disabled={state === "busy"} className="w-full sm:w-auto">
        {state === "busy" ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : null}
        {state === "busy" ? "Starting…" : label}
        {state === "busy" ? null : <ArrowRight className="size-5" aria-hidden />}
      </Button>
      <p role="alert" className="mt-2 min-h-5 text-sm text-bad">
        {state === "error" ? message : ""}
      </p>
    </div>
  );
}

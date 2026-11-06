"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** Copy the ticket as text, and keep the screen awake while it is being read out or shown. */
export function WaiterActions({ text }: { text: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = () =>
      navigator.wakeLock
        ?.request("screen")
        .then((l) => {
          lock = l;
        })
        .catch(() => undefined);
    void request();
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2500);
  }

  return (
    <div className="flex items-center gap-3">
      <span role="status" className="text-sm text-bad">
        {copied === "failed" ? "Couldn’t copy. Select the text instead." : ""}
      </span>
      <Button variant="outline" onClick={copy}>
        {copied === "done" ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
        {copied === "done" ? "Copied" : "Copy as text"}
      </Button>
    </div>
  );
}

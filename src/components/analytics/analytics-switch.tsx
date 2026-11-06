"use client";

import { useEffect, useState } from "react";
import { analyticsClient } from "@/lib/analytics";

type State = "loading" | "on" | "off" | "unavailable";

/**
 * "Analytics on this device": turns PostHog tracking and replays off (or back on) for this browser. PostHog keeps the
 * choice itself. Shows "not running" when analytics isn't set up, or Do Not Track already keeps it off.
 */
export function AnalyticsSwitch() {
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    // PostHog loads after the page; give it a moment before deciding it isn't there.
    let tries = 0;
    const timer = setInterval(() => {
      const client = analyticsClient();
      tries++;
      if (client) {
        setState(client.has_opted_out_capturing() ? "off" : "on");
        clearInterval(timer);
      } else if (tries > 10) {
        setState("unavailable");
        clearInterval(timer);
      }
    }, 300);
    return () => clearInterval(timer);
  }, []);

  function toggle() {
    const client = analyticsClient();
    if (!client) return;
    if (state === "on") client.opt_out_capturing();
    else client.opt_in_capturing();
    setState(client.has_opted_out_capturing() ? "off" : "on");
  }

  if (state === "unavailable") {
    return <p className="rounded-2xl bg-ticket px-4 py-3 ring-[1.5px] ring-rule text-ink-soft">Analytics isn&rsquo;t running in this browser right now, so there&rsquo;s nothing to turn off.</p>;
  }
  const on = state === "on";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ticket px-4 py-3 ring-[1.5px] ring-rule">
      <div>
        <p id="analytics-switch-label" className="font-semibold text-ink">
          Analytics on this device
        </p>
        <p className="text-sm text-ink-soft" aria-live="polite">
          {state === "loading" ? "Checking…" : on ? "On: anonymous usage and masked replays help us fix confusing parts." : "Off: nothing is sent from this browser."}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby="analytics-switch-label"
        disabled={state === "loading"}
        onClick={toggle}
        className="group inline-flex min-h-11 shrink-0 cursor-pointer items-center px-1 disabled:cursor-default disabled:opacity-45"
      >
        <span className="inline-flex h-8 w-14 items-center rounded-full bg-ink/25 p-1 transition-colors group-aria-checked:bg-tomato">
          <span aria-hidden className={`size-6 rounded-full bg-paper shadow transition-transform ${on ? "translate-x-6" : ""}`} />
        </span>
      </button>
    </div>
  );
}

"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { setAnalyticsClient, setAnalyticsContext } from "@/lib/analytics";

function pageKind(path: string): string {
  if (path === "/") return "landing";
  if (path.startsWith("/s/")) return "workspace";
  if (path.startsWith("/j/")) return "invite";
  if (path === "/privacy" || path === "/cookies") return "policy";
  return "other";
}

/**
 * PostHog (US cloud) through this site's own /ingest proxy. On by default when POSTHOG_KEY is set; nothing at all is
 * loaded without it. Replays mask every input and anything inside `data-ph-mask` (people's names, dishes, order names);
 * autocapture never sends element text.
 * Loaded after first paint so it never slows the order screen down.
 */
export function PostHogProvider({ apiKey, children }: { apiKey?: string; children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    void import("posthog-js").then(({ default: posthog }) => {
      if (cancelled) return;
      posthog.init(apiKey, {
        api_host: "/ingest",
        ui_host: "https://us.posthog.com",
        defaults: "2025-05-24",
        person_profiles: "identified_only",
        capture_pageview: "history_change",
        capture_pageleave: true,
        autocapture: true,
        rageclick: true,
        capture_dead_clicks: true,
        capture_exceptions: true,
        respect_dnt: true,
        mask_all_text: true,
        disable_session_recording: false,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: "[data-ph-mask]",
          recordCrossOriginIframes: false,
        },
        enable_recording_console_log: true,
        loaded: (instance) => setAnalyticsClient(instance),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  useEffect(() => {
    setAnalyticsContext({ page_kind: pageKind(pathname) });
  }, [pathname]);

  return <>{children}</>;
}

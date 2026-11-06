"use client";

import { useSyncExternalStore } from "react";
import { relativeLabel } from "@/lib/time";

const noSubscribe = () => () => {};

type Style = "time" | "date" | "relative";

const FORMATS: Record<Exclude<Style, "relative">, Intl.DateTimeFormatOptions> = {
  time: { hour: "numeric", minute: "2-digit" },
  date: { weekday: "long", month: "long", day: "numeric" },
};

/**
 * A time in the viewer's own time zone. The server does not know it (it runs in UTC), so the text appears only after
 * hydration: the server and the first client render agree on nothing, then the device fills it in.
 */
export function LocalTime({ iso, style = "time", className }: { iso: string; style?: Style; className?: string }) {
  const text = useSyncExternalStore(
    noSubscribe,
    () => {
      const date = new Date(iso);
      return style === "relative" ? relativeLabel(date, new Date()) : new Intl.DateTimeFormat(undefined, FORMATS[style]).format(date);
    },
    () => null,
  );
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}

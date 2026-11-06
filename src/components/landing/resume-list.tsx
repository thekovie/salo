import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { LocalTime } from "@/components/ui/local-time";
import type { Resumable } from "@/server/sessions/resume";

/** "Resume an active session" (brief 5.1): orders this phone is part of. */
export function ResumeList({ items }: { items: Resumable[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="resume" className="max-w-sm">
      <h2 id="resume" className="font-sans text-sm font-semibold">
        Pick up where you left off
      </h2>
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={`/s/${item.id}`} className="flex min-h-14 items-center gap-3 rounded-2xl bg-ticket px-4 py-2 shadow-ticket ring-[1.5px] ring-rule hover:ring-input">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{item.title ?? "Table order"}</p>
                <p className="text-sm text-ink-soft">
                  {item.status === "CLOSED" ? "Ended" : `Round ${item.roundNumber}`} · {item.role === "HOST" ? "You're the host" : "Guest"} · <LocalTime iso={item.updatedAt} style="relative" />
                </p>
              </div>
              <ChevronRight className="size-5 text-ink-soft" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

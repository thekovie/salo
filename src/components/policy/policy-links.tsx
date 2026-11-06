import Link from "next/link";
import { cn } from "@/lib/utils";

/** Small "Privacy · Cookies" links for page footers. */
export function PolicyLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Policies" className={cn("flex gap-4 text-sm", className)}>
      <Link href="/privacy" className="font-semibold text-ink underline-offset-4 hover:underline">
        Privacy
      </Link>
      <Link href="/cookies" className="font-semibold text-ink underline-offset-4 hover:underline">
        Cookies
      </Link>
    </nav>
  );
}

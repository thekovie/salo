import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** "Start an order": opens the quick bot check (/new), which creates the order and takes you into it. */
export function StartForm({ label = "Start an order" }: { label?: string }) {
  return (
    <div>
      <Link href="/new" prefetch={false} className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}>
        {label}
        <ArrowRight className="size-5" aria-hidden />
      </Link>
    </div>
  );
}

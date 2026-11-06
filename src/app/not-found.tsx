import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-4 text-center">
      <LogoMark className="size-16" />
      <h1 className="text-3xl">Wala dito.</h1>
      <p className="text-ink-soft">This page or order doesn&rsquo;t exist. Orders are deleted a week after the meal, so an old link may have expired.</p>
      <Link href="/" className={buttonVariants({ variant: "primary" })}>
        Start a new order
      </Link>
    </main>
  );
}

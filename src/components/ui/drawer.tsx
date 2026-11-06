"use client";

import { Drawer as Vaul } from "vaul";
import { cn } from "@/lib/utils";

/**
 * Bottom drawer (shadcn's Drawer, built on vaul): slides up from the bottom, drag the handle or swipe down to dismiss,
 * Escape and the backdrop close it, focus is trapped and returned. Styled as a ticket torn off the pad.
 */
/** Focus moves into the drawer when it opens (vaul leaves it on the trigger unless asked). */
export function Drawer(props: React.ComponentProps<typeof Vaul.Root>) {
  return <Vaul.Root autoFocus {...props} />;
}
export const DrawerTrigger = Vaul.Trigger;
export const DrawerClose = Vaul.Close;
export const DrawerTitle = Vaul.Title;
export const DrawerDescription = Vaul.Description;

export function DrawerContent({ className, children, ...props }: React.ComponentProps<typeof Vaul.Content>) {
  return (
    <Vaul.Portal>
      <Vaul.Overlay className="fixed inset-0 z-50 bg-ink/55" />
      <Vaul.Content
        className={cn(
          "ticket-top fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col bg-ticket text-ink shadow-ticket outline-none",
          className,
        )}
        {...props}
      >
        {/* Grab handle: the visible hint that this sheet can be dragged down. */}
        <div aria-hidden className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-rule" />
        <div className="overflow-y-auto overscroll-contain px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">{children}</div>
      </Vaul.Content>
    </Vaul.Portal>
  );
}

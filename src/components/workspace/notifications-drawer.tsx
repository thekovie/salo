"use client";

import { useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { LocalTime } from "@/components/ui/local-time";
import { notificationText, type NotificationView, type NotificationsView } from "@/lib/notifications";
import { cn } from "@/lib/utils";

interface BellProps {
  unread: number;
  onClick: () => void;
}

/** Header button: the unread count is a badge on top of the icon, so row 1 and row 2 keep their sizes. */
export function NotificationBell({ unread, onClick }: BellProps) {
  // Announce only increases, politely: the text changes when something new arrives and stays put otherwise.
  const [seen, setSeen] = useState(unread);
  const [message, setMessage] = useState("");
  if (unread !== seen) {
    setSeen(unread);
    if (unread > seen) setMessage(`${unread - seen} new ${unread - seen === 1 ? "update" : "updates"}`);
  }
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        data-bell=""
        aria-label={unread > 0 ? `Updates, ${unread} unread` : "Updates"}
        className="relative inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-on-band/10"
      >
        <Bell className="size-6" aria-hidden />
        {unread > 0 ? (
          <span aria-hidden className="absolute top-0.5 right-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-on-band px-1 text-xs leading-5 font-semibold text-band">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
    </>
  );
}

interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notifications: NotificationsView;
  onMarkAll: () => void;
  onOpenItem: (item: NotificationView) => void;
  /** Where focus goes once the drawer has closed. */
  onReturnFocus: () => void;
}

export function NotificationsDrawer({ open, onOpenChange, notifications, onMarkAll, onOpenItem, onReturnFocus }: DrawerProps) {
  const { items, unread } = notifications;
  const title = useRef<HTMLHeadingElement>(null);
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        data-ph-mask=""
        // Land on the title, not on Mark all read: one stray Enter there would clear every unread state.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          title.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <DrawerTitle ref={title} tabIndex={-1} className="font-display text-2xl font-medium outline-none">Updates</DrawerTitle>
          <div className="flex items-center gap-1">
            {items.length > 0 ? (
              // aria-disabled, not disabled: focus stays on the button after it was pressed.
              <button type="button" aria-disabled={unread === 0} onClick={() => unread > 0 && onMarkAll()} className="min-h-11 cursor-pointer rounded-full px-3 text-sm font-semibold hover:bg-ink/6 aria-disabled:cursor-default aria-disabled:text-ink-soft aria-disabled:hover:bg-transparent">
                Mark all read
              </button>
            ) : null}
            <DrawerClose aria-label="Close" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-ink/6">
              <X className="size-5" aria-hidden />
            </DrawerClose>
          </div>
        </div>
        <DrawerDescription className="sr-only">Confirmations, changes and served food, newest first.</DrawerDescription>
        {items.length === 0 ? (
          <p className="mt-4 text-ink-soft">No updates yet. You&rsquo;ll see confirmations, changes and served food here.</p>
        ) : (
          <ul className="mt-2 divide-y divide-ink/10">
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => onOpenItem(item)} className="flex min-h-11 w-full cursor-pointer items-start gap-3 rounded-xl px-1 py-3 text-left hover:bg-ink/4">
                  <span className={cn("mt-1 inline-flex w-12 shrink-0 items-center gap-1.5 text-xs font-semibold uppercase", item.readAt ? "text-transparent" : "text-tomato-ink")}>
                    {item.readAt ? null : (
                      <>
                        <span aria-hidden className="size-2 rounded-full bg-tomato" />
                        New
                      </>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block", !item.readAt && "font-semibold")}>{notificationText(item)}</span>
                    <LocalTime iso={item.createdAt} className="text-sm text-ink-soft" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DrawerContent>
    </Drawer>
  );
}

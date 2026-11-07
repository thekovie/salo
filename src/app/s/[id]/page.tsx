import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Workspace } from "@/components/workspace/workspace";
import { getEnv } from "@/env";
import { RemovedNotice } from "@/components/workspace/removed-notice";
import { loadSessionForPage, openInviteCode, removedNotice } from "@/server/sessions/page-data";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ joined?: string }> };

export const metadata: Metadata = { title: "Table order", robots: { index: false, follow: false } };

export default async function SessionPage({ params, searchParams }: Props) {
  const { id } = await params;
  const data = await loadSessionForPage(id);
  if (!data) {
    // Removed by the host: say so (with their note), before anything else.
    const removed = await removedNotice(id);
    if (removed) return <RemovedNotice reason={removed.reason} inviteCode={await openInviteCode(id)} />;
    // Someone forwarded the room link (or a link preview is fetching it): show them the invite instead.
    const code = await openInviteCode(id);
    if (code) redirect(`/i/${code}`);
    // Ended, unknown or malformed: the same answer for all three.
    notFound();
  }
  return <Workspace initial={data.snapshot} appUrl={getEnv().APP_URL} justJoined={(await searchParams).joined === "1"} />;
}

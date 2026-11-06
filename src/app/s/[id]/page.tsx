import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace/workspace";
import { loadSessionForPage } from "@/server/sessions/page-data";

type Props = { params: Promise<{ id: string }> };

export const metadata: Metadata = { title: "Table order", robots: { index: false, follow: false } };

export default async function SessionPage({ params }: Props) {
  const data = await loadSessionForPage((await params).id);
  // Not part of this order (or it no longer exists): the same answer for both, so ids reveal nothing.
  if (!data) notFound();
  return <Workspace initial={data.snapshot} />;
}

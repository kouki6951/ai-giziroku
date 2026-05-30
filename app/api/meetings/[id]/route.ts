import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      transcripts: { orderBy: { createdAt: "asc" } },
      feedbacks: { orderBy: { createdAt: "asc" } },
      summaries: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!meeting) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(meeting);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const exists = await prisma.meeting.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // transcripts / feedbacks / summaries は schema 側で onDelete: Cascade
  await prisma.meeting.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidSpeakerKey } from "@/lib/speakers";

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

// 話者の表示名（speakerLabels: 話者キー→表示名）を更新する。
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { speakerLabels?: unknown } | null;
  const raw = body?.speakerLabels;

  if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json({ error: "invalid speakerLabels" }, { status: 400 });
  }

  // 有効な話者キー かつ 文字列値 のみ採用する。
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isValidSpeakerKey(key) && typeof value === "string" && value.trim()) {
      cleaned[key] = value.trim();
    }
  }

  const exists = await prisma.meeting.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const updated = await prisma.meeting.update({
    where: { id },
    data: { speakerLabels: JSON.stringify(cleaned) },
    select: { id: true, speakerLabels: true },
  });
  return NextResponse.json(updated);
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

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const ALLOWED_SPEAKER = new Set(["self", "partner"]);

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { meetingId?: unknown; speakerType?: unknown; text?: unknown }
    | null;
  const meetingId = typeof body?.meetingId === "string" ? body.meetingId : "";
  const speakerType = typeof body?.speakerType === "string" ? body.speakerType : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!meetingId || !ALLOWED_SPEAKER.has(speakerType) || !text) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { id: true } });
  if (!meeting) {
    return NextResponse.json({ error: "meeting not found" }, { status: 404 });
  }

  const transcript = await prisma.transcript.create({
    data: { meetingId, speakerType, text },
  });
  return NextResponse.json(transcript, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requestFeedback } from "@/lib/claude";
import { parseRoleIds } from "@/lib/roles";
import { parseSpeakerLabels } from "@/lib/speakers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { meetingId?: unknown; recentLimit?: unknown }
    | null;
  const meetingId = typeof body?.meetingId === "string" ? body.meetingId : "";
  const recentLimit =
    typeof body?.recentLimit === "number" && body.recentLimit > 0 ? body.recentLimit : 40;
  if (!meetingId) {
    return NextResponse.json({ error: "meetingId is required" }, { status: 400 });
  }

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, roles: true, description: true, speakerLabels: true },
  });
  if (!meeting) {
    return NextResponse.json({ error: "meeting not found" }, { status: 404 });
  }

  const transcripts = await prisma.transcript.findMany({
    where: { meetingId },
    orderBy: { createdAt: "desc" },
    take: recentLimit,
  });

  if (transcripts.length === 0) {
    return NextResponse.json({ error: "発言が記録されていません" }, { status: 400 });
  }

  const inOrder = transcripts.reverse();

  let feedbackText: string;
  try {
    feedbackText = await requestFeedback(
      inOrder.map((t) => ({ speakerType: t.speakerType, text: t.text, createdAt: t.createdAt })),
      {
        roleIds: parseRoleIds(meeting.roles),
        description: meeting.description,
        speakerLabels: parseSpeakerLabels(meeting.speakerLabels),
      },
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Claude API 呼び出しに失敗: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const feedback = await prisma.claudeFeedback.create({
    data: { meetingId, feedbackText },
  });
  return NextResponse.json(feedback, { status: 201 });
}

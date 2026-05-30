import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requestSummary } from "@/lib/claude";
import { parseRoleIds } from "@/lib/roles";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { meetingId?: unknown } | null;
  const meetingId = typeof body?.meetingId === "string" ? body.meetingId : "";
  if (!meetingId) {
    return NextResponse.json({ error: "meetingId is required" }, { status: 400 });
  }

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, roles: true, description: true },
  });
  if (!meeting) {
    return NextResponse.json({ error: "meeting not found" }, { status: 404 });
  }

  const [transcripts, feedbacks] = await Promise.all([
    prisma.transcript.findMany({ where: { meetingId }, orderBy: { createdAt: "asc" } }),
    prisma.claudeFeedback.findMany({ where: { meetingId }, orderBy: { createdAt: "asc" } }),
  ]);

  if (transcripts.length === 0) {
    return NextResponse.json({ error: "発言が記録されていません" }, { status: 400 });
  }

  // 生成中フラグを立て、議事録生成はバックグラウンド（レスポンス送出後）で実行する。
  await prisma.meeting.update({
    where: { id: meetingId },
    data: { summaryStatus: "processing" },
  });

  const roleIds = parseRoleIds(meeting.roles);
  const description = meeting.description;
  const transcriptInput = transcripts.map((t) => ({
    speakerType: t.speakerType,
    text: t.text,
    createdAt: t.createdAt,
  }));
  const feedbackInput = feedbacks.map((f) => ({
    feedbackText: f.feedbackText,
    createdAt: f.createdAt,
  }));

  after(async () => {
    try {
      const summaryText = await requestSummary(transcriptInput, feedbackInput, {
        roleIds,
        description,
      });
      await prisma.meetingSummary.create({ data: { meetingId, summaryText } });
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { summaryStatus: "done" },
      });
    } catch (e) {
      console.error("summary generation failed", e);
      await prisma.meeting
        .update({ where: { id: meetingId }, data: { summaryStatus: "error" } })
        .catch(() => {});
    }
  });

  return NextResponse.json({ status: "processing" }, { status: 202 });
}

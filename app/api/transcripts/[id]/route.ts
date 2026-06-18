import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidSpeakerKey } from "@/lib/speakers";

export const runtime = "nodejs";

// 発言ごとの話者を手動で付け替える（話者ダイアライゼーションの誤分離を修正する用途）。
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/transcripts/[id]">) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { speakerType?: unknown } | null;
  const speakerType = typeof body?.speakerType === "string" ? body.speakerType : "";

  if (!isValidSpeakerKey(speakerType)) {
    return NextResponse.json({ error: "invalid speakerType" }, { status: 400 });
  }

  const existing = await prisma.transcript.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "transcript not found" }, { status: 404 });
  }

  const updated = await prisma.transcript.update({
    where: { id },
    data: { speakerType },
  });
  return NextResponse.json(updated);
}

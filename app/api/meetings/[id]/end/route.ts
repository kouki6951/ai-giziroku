import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const exists = await prisma.meeting.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const meeting = await prisma.meeting.update({
    where: { id },
    data: { endedAt: new Date() },
  });
  return NextResponse.json(meeting);
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const meetings = await prisma.meeting.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(meetings);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    title?: unknown;
    description?: unknown;
    roles?: unknown;
  } | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (title.length > 200) {
    return NextResponse.json({ error: "title must be 200 chars or fewer" }, { status: 400 });
  }

  const description =
    typeof body?.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;
  const roles =
    Array.isArray(body?.roles) && body.roles.every((r) => typeof r === "string")
      ? JSON.stringify(body.roles)
      : null;

  const meeting = await prisma.meeting.create({
    data: { title, description, roles },
  });
  return NextResponse.json(meeting, { status: 201 });
}

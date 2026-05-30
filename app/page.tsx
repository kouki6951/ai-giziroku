import { prisma } from "@/lib/prisma";
import { MeetingCard } from "./meeting-card";
import { SummaryStatusPoller } from "./[id]/summary-status-poller";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const meetings = await prisma.meeting.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      _count: { select: { transcripts: true, summaries: true } },
    },
  });

  // バックグラウンド生成中の会議があれば、一覧を自動更新して完了を反映する。
  const anyProcessing = meetings.some(
    (m) => m.summaryStatus === "processing" && m._count.summaries === 0,
  );

  return (
    <div className="space-y-6">
      {anyProcessing ? <SummaryStatusPoller /> : null}
      <div>
        <p className="eyebrow">Meetings</p>
        <p className="eyebrow-sub">議事録一覧</p>
      </div>

      {meetings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
          まだ議事録がありません。<br />
          上の「＋ 新規ミーティング」から開始してください。
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {meetings.map((m) => (
            <li key={m.id}>
              <MeetingCard
                id={m.id}
                title={m.title}
                startedAt={m.startedAt}
                endedAt={m.endedAt}
                transcriptCount={m._count.transcripts}
                summaryCount={m._count.summaries}
                summaryStatus={m.summaryStatus}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

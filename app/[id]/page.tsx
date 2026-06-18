import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/utils";
import { CopySummaryButton } from "./copy-summary-button";
import { DeleteMeetingButton } from "./delete-meeting-button";
import { SummaryStatusPoller } from "./summary-status-poller";
import { RoleFeedbackTabs } from "./role-feedback-tabs";
import { TranscriptList } from "./transcript-list";

export const dynamic = "force-dynamic";

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      transcripts: { orderBy: { createdAt: "asc" } },
      feedbacks: { orderBy: { createdAt: "asc" } },
      summaries: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!meeting) notFound();

  const latestSummary = meeting.summaries[0];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{meeting.title}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {formatDateTime(meeting.startedAt)}
            {meeting.endedAt ? <> – {formatDateTime(meeting.endedAt)}</> : <> – （進行中）</>}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/"
            className="btn-outline"
          >
            一覧へ戻る
          </Link>
          {!meeting.endedAt ? (
            <Link
              href={`/${meeting.id}/recording`}
              className="btn-ink"
            >
              録音画面へ
            </Link>
          ) : null}
          <DeleteMeetingButton id={meeting.id} title={meeting.title} />
        </div>
      </div>

      {meeting.description ? (
        <section className="rounded-2xl border border-black/5 bg-white p-5">
          <h2 className="text-lg font-semibold">会議の内容・目的</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
            {meeting.description}
          </p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-black/5 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">議事録</h2>
          {latestSummary ? <CopySummaryButton text={latestSummary.summaryText} /> : null}
        </div>
        {latestSummary ? (
          <article className="prose prose-zinc mt-4 max-w-none prose-headings:font-semibold prose-h2:text-base prose-h2:mt-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{latestSummary.summaryText}</ReactMarkdown>
          </article>
        ) : meeting.summaryStatus === "processing" ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-zinc-500">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-sky-600" />
            議事録をバックグラウンドで生成中です。完了すると自動で表示されます…
            <SummaryStatusPoller />
          </div>
        ) : meeting.summaryStatus === "error" ? (
          <p className="mt-4 text-sm text-rose-600">
            議事録の生成に失敗しました。録音画面から再度お試しください。
          </p>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">議事録はまだ生成されていません。</p>
        )}
      </section>

      <section className="rounded-2xl border border-black/5 bg-white p-5">
        <TranscriptList
          meetingId={meeting.id}
          initialSpeakerLabels={meeting.speakerLabels}
          initialTranscripts={meeting.transcripts.map((t) => ({
            id: t.id,
            speakerType: t.speakerType,
            text: t.text,
            createdAt: t.createdAt.toISOString(),
          }))}
        />
      </section>

      <section className="rounded-2xl border border-black/5 bg-white p-5">
        <h2 className="text-lg font-semibold">Claude 提案履歴（{meeting.feedbacks.length} 件）</h2>
        <ul className="mt-4 space-y-3">
          {meeting.feedbacks.map((f) => (
            <li key={f.id} className="rounded border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs text-zinc-500">{formatDateTime(f.createdAt)} 取得</p>
              <div className="mt-2">
                <RoleFeedbackTabs text={f.feedbackText} />
              </div>
            </li>
          ))}
          {meeting.feedbacks.length === 0 ? (
            <li className="text-sm text-zinc-500">提案履歴はありません。</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}

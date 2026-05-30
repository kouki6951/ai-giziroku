"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RoleFeedbackTabs } from "../role-feedback-tabs";
import {
  type RecognizerHandle,
  type RecognizerStatus,
  type Speaker,
  startLoopback,
  startMic,
} from "@/lib/amivoice/client";

type TranscriptEntry = {
  id: string;
  speaker: Speaker;
  text: string;
  at: Date;
};

type FeedbackEntry = {
  id: string;
  feedbackText: string;
  createdAt: string;
};

type SpeakerState = {
  status: RecognizerStatus | "idle";
  partial: string;
};

function formatElapsed(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function statusLabel(status: RecognizerStatus | "idle") {
  switch (status) {
    case "connecting":
      return "接続中";
    case "open":
      return "接続中";
    case "reconnecting":
      return "再接続中";
    case "error":
      return "エラー";
    case "closed":
    case "idle":
    default:
      return "停止";
  }
}

function statusDot(status: RecognizerStatus | "idle") {
  if (status === "open") return "bg-rose-500 animate-pulse";
  if (status === "connecting" || status === "reconnecting") return "bg-amber-500 animate-pulse";
  if (status === "error") return "bg-rose-700";
  return "bg-zinc-300";
}

export default function RecordingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: meetingId } = use(params);
  const router = useRouter();

  const [title, setTitle] = useState<string>("");
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [now, setNow] = useState<Date>(new Date());
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [feedbacks, setFeedbacks] = useState<FeedbackEntry[]>([]);

  const [selfState, setSelfState] = useState<SpeakerState>({ status: "idle", partial: "" });
  const [partnerState, setPartnerState] = useState<SpeakerState>({ status: "idle", partial: "" });

  const [toast, setToast] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"none" | "feedback" | "summary">("none");

  const selfHandleRef = useRef<RecognizerHandle | null>(null);
  const partnerHandleRef = useRef<RecognizerHandle | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  // 経過時間
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 初期データ取得
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/meetings/${meetingId}`);
      if (!res.ok) {
        if (res.status === 404) router.replace("/");
        return;
      }
      const data = (await res.json()) as {
        title: string;
        startedAt: string;
        endedAt: string | null;
        transcripts: { id: string; speakerType: string; text: string; createdAt: string }[];
        feedbacks: { id: string; feedbackText: string; createdAt: string }[];
      };
      if (cancelled) return;
      setTitle(data.title);
      setStartedAt(new Date(data.startedAt));
      setTranscripts(
        data.transcripts.map((t) => ({
          id: t.id,
          speaker: (t.speakerType === "partner" ? "partner" : "self") as Speaker,
          text: t.text,
          at: new Date(t.createdAt),
        })),
      );
      setFeedbacks(data.feedbacks);
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId, router]);

  // 自動スクロール
  useEffect(() => {
    transcriptScrollRef.current?.scrollTo({
      top: transcriptScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [transcripts.length, selfState.partial, partnerState.partial]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setLastError(msg);
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const saveTranscript = useCallback(
    async (speaker: Speaker, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      try {
        const res = await fetch("/api/transcripts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meetingId, speakerType: speaker, text: trimmed }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const created = (await res.json()) as { id: string; createdAt: string };
        setTranscripts((prev) => [
          ...prev,
          { id: created.id, speaker, text: trimmed, at: new Date(created.createdAt) },
        ]);
      } catch (e) {
        showToast(`発言の保存に失敗: ${(e as Error).message}`);
      }
    },
    [meetingId, showToast],
  );

  const handlers = useMemo(
    () => ({
      onPartial: (speaker: Speaker, text: string) => {
        if (speaker === "self") setSelfState((s) => ({ ...s, partial: text }));
        else setPartnerState((s) => ({ ...s, partial: text }));
      },
      onFinal: (speaker: Speaker, text: string) => {
        if (speaker === "self") setSelfState((s) => ({ ...s, partial: "" }));
        else setPartnerState((s) => ({ ...s, partial: "" }));
        void saveTranscript(speaker, text);
      },
      onStatus: (speaker: Speaker, status: RecognizerStatus) => {
        if (speaker === "self") setSelfState((s) => ({ ...s, status }));
        else setPartnerState((s) => ({ ...s, status }));
      },
      onError: (_speaker: Speaker, message: string) => {
        showToast(message);
      },
    }),
    [saveTranscript, showToast],
  );

  const startSelf = useCallback(async () => {
    if (selfHandleRef.current) return;
    try {
      const handle = await startMic(handlers);
      selfHandleRef.current = handle;
    } catch (e) {
      showToast(`マイクを開始できません: ${(e as Error).message}`);
      setSelfState((s) => ({ ...s, status: "error" }));
    }
  }, [handlers, showToast]);

  const stopSelf = useCallback(async () => {
    const h = selfHandleRef.current;
    selfHandleRef.current = null;
    if (h) await h.stop().catch(() => {});
    setSelfState({ status: "idle", partial: "" });
  }, []);

  const startPartner = useCallback(async () => {
    if (partnerHandleRef.current) return;
    try {
      const handle = await startLoopback(handlers);
      partnerHandleRef.current = handle;
    } catch (e) {
      showToast(`相手音声を開始できません: ${(e as Error).message}`);
      setPartnerState((s) => ({ ...s, status: "error" }));
    }
  }, [handlers, showToast]);

  const stopPartner = useCallback(async () => {
    const h = partnerHandleRef.current;
    partnerHandleRef.current = null;
    if (h) await h.stop().catch(() => {});
    setPartnerState({ status: "idle", partial: "" });
  }, []);

  const fetchFeedback = useCallback(async () => {
    if (busy !== "none") return;
    setBusy("feedback");
    try {
      const res = await fetch("/api/claude/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setFeedbacks((prev) => [...prev, data as FeedbackEntry]);
    } catch (e) {
      showToast(`提案取得に失敗: ${(e as Error).message}`);
    } finally {
      setBusy("none");
    }
  }, [busy, meetingId, showToast]);

  const generateSummaryAndEnd = useCallback(async () => {
    if (busy !== "none") return;
    if (
      !confirm(
        "議事録の生成を開始し、ミーティングを終了します。生成はバックグラウンドで実行され、完了後に詳細画面で確認できます。よろしいですか？",
      )
    )
      return;
    setBusy("summary");
    try {
      await stopSelf();
      await stopPartner();
      await fetch(`/api/meetings/${meetingId}/end`, { method: "POST" });
      // 議事録生成はバックグラウンドで実行（202 がすぐ返る）。完了を待たずに一覧へ。
      const sumRes = await fetch("/api/claude/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId }),
      });
      if (!sumRes.ok && sumRes.status !== 202) {
        const sumData = await sumRes.json().catch(() => null);
        throw new Error(sumData?.error ?? `HTTP ${sumRes.status}`);
      }
      router.push(`/`);
    } catch (e) {
      showToast(`議事録生成の開始に失敗: ${(e as Error).message}`);
      setBusy("none");
    }
  }, [busy, meetingId, router, showToast, stopPartner, stopSelf]);

  const endWithoutSummary = useCallback(async () => {
    if (busy !== "none") return;
    if (!confirm("議事録を作らずに終了します。よろしいですか？")) return;
    await stopSelf();
    await stopPartner();
    await fetch(`/api/meetings/${meetingId}/end`, { method: "POST" }).catch(() => {});
    router.push(`/${meetingId}`);
  }, [busy, meetingId, router, stopPartner, stopSelf]);

  // 録音中の離脱警告
  useEffect(() => {
    const recording =
      selfState.status === "open" ||
      selfState.status === "connecting" ||
      partnerState.status === "open" ||
      partnerState.status === "connecting";
    if (!recording) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [selfState.status, partnerState.status]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      void selfHandleRef.current?.stop();
      void partnerHandleRef.current?.stop();
    };
  }, []);

  const elapsedSec = startedAt
    ? Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000))
    : 0;

  const latestFeedback = feedbacks[feedbacks.length - 1];
  const olderFeedbacks = feedbacks.slice(0, -1);

  const selfActive =
    selfState.status === "connecting" ||
    selfState.status === "open" ||
    selfState.status === "reconnecting";
  const partnerActive =
    partnerState.status === "connecting" ||
    partnerState.status === "open" ||
    partnerState.status === "reconnecting";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusDot(selfState.status)}`} />
              <span className="text-zinc-700">mic（{statusLabel(selfState.status)}）</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusDot(partnerState.status)}`} />
              <span className="text-zinc-700">loop（{statusLabel(partnerState.status)}）</span>
            </div>
            <span className="font-mono text-sm tabular-nums text-zinc-600">{formatElapsed(elapsedSec)}</span>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{title || "ミーティング"}</h1>
        </div>
        <Link
          href={`/${meetingId}`}
          className="text-sm text-zinc-500 hover:text-zinc-700"
        >
          詳細を見る
        </Link>
      </div>

      {partnerState.status === "open" || partnerState.status === "connecting" ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠ 相手音声がスピーカから流れていると重複認識されます。ヘッドホンを使用してください。
        </div>
      ) : null}

      {lastError ? (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <span className="font-medium">エラー:</span>
          <span className="flex-1 break-all">{lastError}</span>
          <button
            type="button"
            onClick={() => setLastError(null)}
            className="text-xs text-rose-600 hover:text-rose-800"
          >
            閉じる
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
        <section className="rounded-lg border border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 px-4 py-2">
            <h2 className="text-sm font-semibold text-zinc-700">発言ログ</h2>
          </div>
          <div ref={transcriptScrollRef} className="h-[60vh] overflow-y-auto px-4 py-3 space-y-2">
            {transcripts.map((t) => (
              <div key={t.id} className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-zinc-500 tabular-nums">
                    {t.at.toLocaleTimeString("ja-JP")}
                  </span>
                  <span
                    className={
                      t.speaker === "self"
                        ? "rounded bg-sky-100 px-1.5 text-xs text-sky-700"
                        : "rounded bg-emerald-100 px-1.5 text-xs text-emerald-700"
                    }
                  >
                    {t.speaker === "self" ? "自分" : "相手"}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap">{t.text}</p>
              </div>
            ))}
            {selfState.partial ? (
              <div className="rounded border border-dashed border-sky-200 bg-sky-50/50 px-3 py-2 text-sm text-zinc-500">
                <span className="rounded bg-sky-100 px-1.5 text-xs text-sky-700">自分</span>
                <span className="ml-2 italic">{selfState.partial}</span>
              </div>
            ) : null}
            {partnerState.partial ? (
              <div className="rounded border border-dashed border-emerald-200 bg-emerald-50/50 px-3 py-2 text-sm text-zinc-500">
                <span className="rounded bg-emerald-100 px-1.5 text-xs text-emerald-700">相手</span>
                <span className="ml-2 italic">{partnerState.partial}</span>
              </div>
            ) : null}
            {transcripts.length === 0 && !selfState.partial && !partnerState.partial ? (
              <div className="py-12 text-center text-sm text-zinc-400">
                「開始（マイク）」を押すと文字起こしが始まります。
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 px-4 py-2">
            <h2 className="text-sm font-semibold text-zinc-700">Claude 提案</h2>
          </div>
          <div className="h-[60vh] overflow-y-auto px-4 py-3">
            {busy === "feedback" ? (
              <p className="text-sm text-zinc-500">提案を取得中…</p>
            ) : latestFeedback ? (
              <RoleFeedbackTabs text={latestFeedback.feedbackText} />
            ) : (
              <p className="text-sm text-zinc-400">
                発言が溜まったら「フィードバック取得」を押してください。
              </p>
            )}

            {olderFeedbacks.length > 0 ? (
              <details className="mt-6">
                <summary className="cursor-pointer text-xs text-zinc-500">
                  過去の提案を表示（{olderFeedbacks.length} 件）
                </summary>
                <ul className="mt-3 space-y-3">
                  {olderFeedbacks
                    .slice()
                    .reverse()
                    .map((f) => (
                      <li key={f.id} className="rounded border border-zinc-100 bg-zinc-50 p-2">
                        <RoleFeedbackTabs text={f.feedbackText} size="xs" />
                      </li>
                    ))}
                </ul>
              </details>
            ) : null}
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={selfActive ? stopSelf : startSelf}
          className="btn-soft"
        >
          {selfActive ? "マイク停止" : "開始（マイク）"}
        </button>
        <button
          type="button"
          onClick={partnerActive ? stopPartner : startPartner}
          className="btn-soft"
        >
          {partnerActive ? "相手音声を停止" : "相手音声を取り込む"}
        </button>
        <div className="grow" />
        <button
          type="button"
          onClick={fetchFeedback}
          disabled={busy !== "none" || transcripts.length === 0}
          className="btn-soft"
        >
          {busy === "feedback" ? "取得中…" : "フィードバック取得"}
        </button>
        <button
          type="button"
          onClick={generateSummaryAndEnd}
          disabled={busy !== "none" || transcripts.length === 0}
          className="btn-ink"
        >
          {busy === "summary" ? "開始中…" : "議事録を生成して終了"}
        </button>
        <button
          type="button"
          onClick={endWithoutSummary}
          disabled={busy !== "none"}
          className="btn-soft"
        >
          終了のみ
        </button>
      </div>

      {toast ? (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

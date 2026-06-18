"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RoleFeedbackTabs } from "../role-feedback-tabs";
import { SpeakerBadge, SpeakerManager, SpeakerReassignSelect } from "../speakers-ui";
import {
  type SpeakerLabels,
  SELF_KEY,
  collectSpeakerKeys,
  parseSpeakerLabels,
} from "@/lib/speakers";
import {
  type RecognizerHandle,
  type RecognizerStatus,
  type Source,
  acquirePartnerStream,
  startMic,
  startRecognizer,
} from "@/lib/amivoice/client";

// 話者分離の感度スライダーの範囲（diarizerAlpha = 10^exp）。
const DIARIZER_EXP_MIN = -40;
const DIARIZER_EXP_MAX = 20;
const DIARIZER_EXP_DEFAULT = 0;
const DIARIZER_EXP_STORAGE_KEY = "giziroku.diarizerExp";

type TranscriptEntry = {
  id: string;
  speaker: string;
  text: string;
  at: Date;
};

type FeedbackEntry = {
  id: string;
  feedbackText: string;
  createdAt: string;
};

type SourceState = {
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
  const [speakerLabels, setSpeakerLabels] = useState<SpeakerLabels>({});

  const [selfState, setSelfState] = useState<SourceState>({ status: "idle", partial: "" });
  const [partnerState, setPartnerState] = useState<SourceState>({ status: "idle", partial: "" });

  // 話者分離の感度: diarizerAlpha = 10^diarizerExp。大きいほど話者が分かれやすい。
  const [diarizerExp, setDiarizerExp] = useState<number>(DIARIZER_EXP_DEFAULT);
  // 現在 取り込み中のセッションが実際に使っている exp（変更後の「再適用」要否の判定に使う）。
  const [runningExp, setRunningExp] = useState<number | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"none" | "feedback" | "summary">("none");

  const selfHandleRef = useRef<RecognizerHandle | null>(null);
  const partnerHandleRef = useRef<RecognizerHandle | null>(null);
  // 相手音声のストリーム。感度変更時に画面共有を再要求せず認識だけ貼り直すため保持する。
  const partnerStreamRef = useRef<MediaStream | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  // 感度設定の読み込み / 永続化（localStorage）。
  // 初期描画は SSR/クライアントとも既定値で揃え（ハイドレーション不整合の回避）、
  // マウント後に保存値へ一度だけ同期する。
  useEffect(() => {
    const saved = window.localStorage.getItem(DIARIZER_EXP_STORAGE_KEY);
    if (saved !== null) {
      const n = Number(saved);
      if (Number.isFinite(n)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部ストア(localStorage)からの一度きりの同期
        setDiarizerExp(Math.min(DIARIZER_EXP_MAX, Math.max(DIARIZER_EXP_MIN, Math.round(n))));
      }
    }
  }, []);
  useEffect(() => {
    window.localStorage.setItem(DIARIZER_EXP_STORAGE_KEY, String(diarizerExp));
  }, [diarizerExp]);

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
        speakerLabels: string | null;
        transcripts: { id: string; speakerType: string; text: string; createdAt: string }[];
        feedbacks: { id: string; feedbackText: string; createdAt: string }[];
      };
      if (cancelled) return;
      setTitle(data.title);
      setStartedAt(new Date(data.startedAt));
      setSpeakerLabels(parseSpeakerLabels(data.speakerLabels));
      setTranscripts(
        data.transcripts.map((t) => ({
          id: t.id,
          speaker: t.speakerType,
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
    async (speakerKey: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      try {
        const res = await fetch("/api/transcripts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meetingId, speakerType: speakerKey, text: trimmed }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const created = (await res.json()) as { id: string; createdAt: string };
        setTranscripts((prev) => [
          ...prev,
          { id: created.id, speaker: speakerKey, text: trimmed, at: new Date(created.createdAt) },
        ]);
      } catch (e) {
        showToast(`発言の保存に失敗: ${(e as Error).message}`);
      }
    },
    [meetingId, showToast],
  );

  const handlers = useMemo(
    () => ({
      onPartial: (source: Source, text: string) => {
        if (source === "self") setSelfState((s) => ({ ...s, partial: text }));
        else setPartnerState((s) => ({ ...s, partial: text }));
      },
      onFinal: (source: Source, speakerKey: string, text: string) => {
        if (source === "self") setSelfState((s) => ({ ...s, partial: "" }));
        else setPartnerState((s) => ({ ...s, partial: "" }));
        void saveTranscript(speakerKey, text);
      },
      onStatus: (source: Source, status: RecognizerStatus) => {
        if (source === "self") setSelfState((s) => ({ ...s, status }));
        else setPartnerState((s) => ({ ...s, status }));
      },
      onError: (_source: Source, message: string) => {
        showToast(message);
      },
    }),
    [saveTranscript, showToast],
  );

  // 発言の話者を付け替える（誤分離の手動修正）。
  const reassignSpeaker = useCallback(
    async (transcriptId: string, nextKey: string) => {
      const prevList = transcripts;
      setTranscripts((prev) =>
        prev.map((t) => (t.id === transcriptId ? { ...t, speaker: nextKey } : t)),
      );
      try {
        const res = await fetch(`/api/transcripts/${transcriptId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ speakerType: nextKey }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        setTranscripts(prevList); // ロールバック
        showToast(`話者の変更に失敗: ${(e as Error).message}`);
      }
    },
    [transcripts, showToast],
  );

  // 話者名のリネーム（全発言に反映）。
  const renameSpeaker = useCallback(
    async (key: string, name: string) => {
      const next = { ...speakerLabels, [key]: name };
      setSpeakerLabels(next);
      try {
        const res = await fetch(`/api/meetings/${meetingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ speakerLabels: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        showToast(`話者名の保存に失敗: ${(e as Error).message}`);
      }
    },
    [speakerLabels, meetingId, showToast],
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
      // 既存ストリームがあれば再利用（感度再適用時に画面共有を再要求しない）。
      let stream = partnerStreamRef.current;
      if (!stream || !stream.active) {
        stream = await acquirePartnerStream();
        partnerStreamRef.current = stream;
      }
      const handle = await startRecognizer("partner", stream, handlers, {
        diarize: true,
        diarizerAlpha: `1e${diarizerExp}`,
        keepStreamOnStop: true,
      });
      partnerHandleRef.current = handle;
      setRunningExp(diarizerExp);
    } catch (e) {
      showToast(`相手音声を開始できません: ${(e as Error).message}`);
      setPartnerState((s) => ({ ...s, status: "error" }));
    }
  }, [handlers, showToast, diarizerExp]);

  const stopPartner = useCallback(async () => {
    const h = partnerHandleRef.current;
    partnerHandleRef.current = null;
    if (h) await h.stop().catch(() => {});
    // 完全停止: 画面共有ストリームも解放する。
    try { partnerStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    partnerStreamRef.current = null;
    setRunningExp(null);
    setPartnerState({ status: "idle", partial: "" });
  }, []);

  // 感度を録音中に反映: ストリームは保持したまま認識だけ貼り直す。
  const reapplyPartner = useCallback(async () => {
    const h = partnerHandleRef.current;
    if (!h) return;
    partnerHandleRef.current = null;
    await h.stop().catch(() => {}); // keepStreamOnStop によりストリームは生存
    await startPartner();
  }, [startPartner]);

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
      try { partnerStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    };
  }, []);

  const elapsedSec = startedAt
    ? Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000))
    : 0;

  const latestFeedback = feedbacks[feedbacks.length - 1];
  const olderFeedbacks = feedbacks.slice(0, -1);

  // 発言ログに現れた話者キー（手動修正セレクトと話者名編集パネルの選択肢）。
  const speakerKeys = useMemo(
    () => collectSpeakerKeys([SELF_KEY, ...transcripts.map((t) => t.speaker)], speakerLabels),
    [transcripts, speakerLabels],
  );

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
          相手側は自動で話者を分離します（相手1・相手2…）。誤りは各発言の話者を選び直して修正できます。
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

      <div className="rounded-md border border-zinc-200 bg-white px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-zinc-600">
          <span className="font-medium text-zinc-700">話者分離の感度</span>
          <span className="text-zinc-400">少なめ</span>
          <input
            type="range"
            min={DIARIZER_EXP_MIN}
            max={DIARIZER_EXP_MAX}
            step={1}
            value={diarizerExp}
            onChange={(e) => setDiarizerExp(Number(e.target.value))}
            className="h-1.5 w-48 cursor-pointer accent-sky-600"
            aria-label="話者分離の感度"
          />
          <span className="text-zinc-400">多め</span>
          <span className="font-mono tabular-nums text-zinc-500">α=1e{diarizerExp}</span>
          {partnerActive && runningExp !== null && runningExp !== diarizerExp ? (
            <button
              type="button"
              onClick={() => void reapplyPartner()}
              className="rounded bg-sky-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-sky-700"
            >
              録音中に再適用
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-zinc-400">
          話者が分かれすぎる（同じ人が別人扱い）→「少なめ」へ。
          逆に人数が足りない（別人が同じ扱い）→「多め」へ。録音中に変えたら「再適用」を押すと反映されます。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
        <section className="rounded-lg border border-zinc-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2">
            <h2 className="text-sm font-semibold text-zinc-700">発言ログ</h2>
            <SpeakerManager
              speakerKeys={speakerKeys}
              labels={speakerLabels}
              onRename={renameSpeaker}
            />
          </div>
          <div ref={transcriptScrollRef} className="h-[60vh] overflow-y-auto px-4 py-3 space-y-2">
            {transcripts.map((t) => (
              <div key={t.id} className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 tabular-nums">
                    {t.at.toLocaleTimeString("ja-JP")}
                  </span>
                  <SpeakerBadge speakerKey={t.speaker} labels={speakerLabels} />
                  <span className="grow" />
                  <SpeakerReassignSelect
                    value={t.speaker}
                    speakerKeys={speakerKeys}
                    labels={speakerLabels}
                    onChange={(nextKey) => void reassignSpeaker(t.id, nextKey)}
                  />
                </div>
                <p className="mt-1 whitespace-pre-wrap">{t.text}</p>
              </div>
            ))}
            {selfState.partial ? (
              <div className="rounded border border-dashed border-sky-200 bg-sky-50/50 px-3 py-2 text-sm text-zinc-500">
                <SpeakerBadge speakerKey={SELF_KEY} labels={speakerLabels} />
                <span className="ml-2 italic">{selfState.partial}</span>
              </div>
            ) : null}
            {partnerState.partial ? (
              <div className="rounded border border-dashed border-emerald-200 bg-emerald-50/50 px-3 py-2 text-sm text-zinc-500">
                <span className="rounded bg-emerald-100 px-1.5 text-xs text-emerald-700">相手（認識中）</span>
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

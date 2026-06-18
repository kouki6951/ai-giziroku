"use client";

import { useCallback, useMemo, useState } from "react";
import { formatTime } from "@/lib/utils";
import {
  type SpeakerLabels,
  SELF_KEY,
  collectSpeakerKeys,
  parseSpeakerLabels,
} from "@/lib/speakers";
import { SpeakerBadge, SpeakerManager, SpeakerReassignSelect } from "./speakers-ui";

type Item = { id: string; speakerType: string; text: string; createdAt: string };

// 会議終了後の発言ログ。話者名のリネームと、発言ごとの話者付け替え（誤分離の修正）ができる。
export function TranscriptList({
  meetingId,
  initialTranscripts,
  initialSpeakerLabels,
}: {
  meetingId: string;
  initialTranscripts: Item[];
  initialSpeakerLabels: string | null;
}) {
  const [transcripts, setTranscripts] = useState<Item[]>(initialTranscripts);
  const [speakerLabels, setSpeakerLabels] = useState<SpeakerLabels>(
    parseSpeakerLabels(initialSpeakerLabels),
  );
  const [error, setError] = useState<string | null>(null);

  const speakerKeys = useMemo(
    () => collectSpeakerKeys([SELF_KEY, ...transcripts.map((t) => t.speakerType)], speakerLabels),
    [transcripts, speakerLabels],
  );

  const reassignSpeaker = useCallback(
    async (transcriptId: string, nextKey: string) => {
      const prev = transcripts;
      setTranscripts((list) =>
        list.map((t) => (t.id === transcriptId ? { ...t, speakerType: nextKey } : t)),
      );
      try {
        const res = await fetch(`/api/transcripts/${transcriptId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ speakerType: nextKey }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        setTranscripts(prev);
        setError(`話者の変更に失敗: ${(e as Error).message}`);
      }
    },
    [transcripts],
  );

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
        setError(`話者名の保存に失敗: ${(e as Error).message}`);
      }
    },
    [speakerLabels, meetingId],
  );

  return (
    <details>
      <summary className="cursor-pointer text-lg font-semibold">
        発言ログ（{transcripts.length} 件）
      </summary>

      {transcripts.length > 0 ? (
        <div className="mt-4 rounded-lg border border-zinc-100 bg-zinc-50/50 px-3 py-2">
          <p className="mb-1.5 text-xs text-zinc-500">話者名（編集すると全発言に反映されます）</p>
          <SpeakerManager speakerKeys={speakerKeys} labels={speakerLabels} onRename={renameSpeaker} />
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-rose-600">{error}</p>
      ) : null}

      <ul className="mt-4 space-y-2">
        {transcripts.map((t) => (
          <li key={t.id} className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">{formatTime(t.createdAt)}</span>
              <SpeakerBadge speakerKey={t.speakerType} labels={speakerLabels} />
              <span className="grow" />
              <SpeakerReassignSelect
                value={t.speakerType}
                speakerKeys={speakerKeys}
                labels={speakerLabels}
                onChange={(nextKey) => void reassignSpeaker(t.id, nextKey)}
              />
            </div>
            <p className="mt-1 whitespace-pre-wrap">{t.text}</p>
          </li>
        ))}
        {transcripts.length === 0 ? (
          <li className="text-sm text-zinc-500">発言ログはありません。</li>
        ) : null}
      </ul>
    </details>
  );
}

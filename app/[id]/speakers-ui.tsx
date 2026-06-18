"use client";

import { useState } from "react";
import {
  type SpeakerLabels,
  collectSpeakerKeys,
  nextPartnerKey,
  speakerColor,
  speakerName,
} from "@/lib/speakers";

/** 話者名つきのカラーバッジ。 */
export function SpeakerBadge({
  speakerKey,
  labels,
  size = "sm",
}: {
  speakerKey: string;
  labels: SpeakerLabels;
  size?: "sm" | "xs";
}) {
  const { badge } = speakerColor(speakerKey);
  const pad = size === "xs" ? "px-1 text-[10px]" : "px-1.5 text-xs";
  return <span className={`rounded ${pad} ${badge}`}>{speakerName(speakerKey, labels)}</span>;
}

/**
 * 発言の話者を付け替えるセレクト。既知の話者から選ぶか「＋ 新しい話者」で新規キーを発行する。
 */
export function SpeakerReassignSelect({
  value,
  speakerKeys,
  labels,
  onChange,
}: {
  value: string;
  speakerKeys: string[];
  labels: SpeakerLabels;
  onChange: (nextKey: string) => void;
}) {
  // value が一覧に無ければ補う（過去データや手動修正後でも必ず選択肢に出す）。
  const keys = collectSpeakerKeys([...speakerKeys, value], labels);
  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__new__") onChange(nextPartnerKey(keys));
        else onChange(v);
      }}
      className="rounded border border-zinc-200 bg-white px-1 py-0.5 text-xs text-zinc-600 hover:border-zinc-300 focus:outline-none focus:ring-1 focus:ring-sky-300"
      title="この発言の話者を変更"
    >
      {keys.map((k) => (
        <option key={k} value={k}>
          {speakerName(k, labels)}
        </option>
      ))}
      <option value="__new__">＋ 新しい話者</option>
    </select>
  );
}

/**
 * 話者名の一覧編集パネル。各話者の表示名を変更できる。
 * 確定時（blur / Enter）に onRename(key, name) を呼ぶ。
 */
export function SpeakerManager({
  speakerKeys,
  labels,
  onRename,
}: {
  speakerKeys: string[];
  labels: SpeakerLabels;
  onRename: (key: string, name: string) => void;
}) {
  const keys = collectSpeakerKeys(speakerKeys, labels);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {keys.map((k) => (
        <SpeakerNameInput key={k} speakerKey={k} labels={labels} onRename={onRename} />
      ))}
    </div>
  );
}

function SpeakerNameInput({
  speakerKey,
  labels,
  onRename,
}: {
  speakerKey: string;
  labels: SpeakerLabels;
  onRename: (key: string, name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const { dot } = speakerColor(speakerKey);
  const current = speakerName(speakerKey, labels);
  const commit = () => {
    if (draft === null) return;
    const trimmed = draft.trim();
    if (trimmed && trimmed !== current) onRename(speakerKey, trimmed);
    setDraft(null);
  };
  return (
    <label className="flex items-center gap-1.5 text-xs text-zinc-600">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
      <input
        type="text"
        value={draft ?? current}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(null);
        }}
        className="w-24 rounded border border-zinc-200 bg-white px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-sky-300"
      />
    </label>
  );
}

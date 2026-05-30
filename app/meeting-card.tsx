"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDateTime } from "@/lib/utils";

type Props = {
  id: string;
  title: string;
  startedAt: string | Date;
  endedAt: string | Date | null;
  transcriptCount: number;
  summaryCount: number;
  summaryStatus?: string | null;
};

export function MeetingCard({
  id,
  title,
  startedAt,
  endedAt,
  transcriptCount,
  summaryCount,
  summaryStatus,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`「${title}」を削除します。発言ログ・提案履歴・議事録もすべて消えます。よろしいですか？`)) {
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/meetings/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      alert(`削除に失敗しました: ${(err as Error).message}`);
      setPending(false);
    }
  };

  return (
    <div className="relative">
      <Link
        href={`/${id}`}
        className="block rounded-2xl border border-black/5 bg-white p-5 pr-10 hover:shadow-md transition"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium truncate">{title}</h2>
          {endedAt ? (
            <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600">
              終了
            </span>
          ) : (
            <span className="shrink-0 tag-lime">進行中</span>
          )}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          開始 {formatDateTime(startedAt)}
          {endedAt ? <> – 終了 {formatDateTime(endedAt)}</> : null}
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          発言 {transcriptCount} 件 / 議事録 {summaryCount} 件
        </p>
        {summaryStatus === "processing" && summaryCount === 0 ? (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" />
            議事録を生成中
          </p>
        ) : summaryStatus === "error" && summaryCount === 0 ? (
          <p className="mt-2 inline-block rounded bg-rose-50 px-2 py-0.5 text-xs text-rose-700">
            議事録の生成に失敗
          </p>
        ) : null}
      </Link>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        aria-label="削除"
        title="削除"
        className="absolute right-2 top-2 cursor-pointer rounded p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-default disabled:opacity-50"
      >
        {pending ? (
          <span className="text-xs">…</span>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
        )}
      </button>
    </div>
  );
}

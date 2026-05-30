"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { FEEDBACK_ROLES } from "@/lib/roles";

export default function NewMeetingPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([
    "sales",
    "marketing",
    "engineer",
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleRole = (id: string) => {
    setSelectedRoles((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = title.trim();
    if (!trimmed) {
      setError("タイトルを入力してください");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmed,
          description: description.trim(),
          roles: selectedRoles,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const meeting = (await res.json()) as { id: string };
      router.push(`/${meeting.id}/recording`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました");
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">新しいミーティング</h1>

      <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-zinc-700">
            タイトル
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="顧客A 商談 #2"
            maxLength={200}
            autoFocus
            disabled={submitting}
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-zinc-100"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-zinc-700">
            会議の内容・目的（メタ情報）
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="会議の目的、議題、前提となる背景などを入力してください。フィードバックや議事録の精度が上がります。"
            rows={4}
            disabled={submitting}
            className="mt-1 block w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-zinc-100"
          />
        </div>

        <fieldset disabled={submitting}>
          <legend className="block text-sm font-medium text-zinc-700">
            フィードバックを求めるロール
          </legend>
          <p className="mt-1 text-xs text-zinc-500">
            選択したロールの視点からフィードバックが生成されます。何も選択しない場合は従来どおりのフィードバックになります。
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {FEEDBACK_ROLES.map((role) => (
              <label
                key={role.id}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                  selectedRoles.includes(role.id)
                    ? "border-sky-500 bg-sky-50 text-sky-700"
                    : "border-zinc-300 text-zinc-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedRoles.includes(role.id)}
                  onChange={() => toggleRole(role.id)}
                  className="accent-sky-600"
                />
                {role.label}
              </label>
            ))}
          </div>
        </fieldset>

        {error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Link
            href="/"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            キャンセル
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {submitting ? "作成中…" : "開始"}
          </button>
        </div>
      </form>
    </div>
  );
}

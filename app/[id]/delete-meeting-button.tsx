"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteMeetingButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onDelete = async () => {
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
      router.push("/");
      router.refresh();
    } catch (e) {
      alert(`削除に失敗しました: ${(e as Error).message}`);
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={pending}
      className="rounded-full border border-rose-300 bg-white px-4 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
    >
      {pending ? "削除中…" : "削除"}
    </button>
  );
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// 議事録がバックグラウンド生成中の間、一定間隔でサーバーコンポーネントを再取得する。
// 生成完了後は親（サーバーコンポーネント）がこのコンポーネントを描画しなくなり、
// アンマウントで interval が解除される。
export function SummaryStatusPoller({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs]);
  return null;
}

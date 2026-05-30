"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Section = { label: string; body: string };

// フィードバックの Markdown を「### {ロール名}の視点」見出しごとに分割する。
// 見出しが無い（＝ロール未設定の従来フィードバック）場合は sections が空になる。
function parseRoleSections(md: string): { preamble: string; sections: Section[] } {
  const lines = md.split("\n");
  let preamble = "";
  const sections: Section[] = [];
  let cur: Section | null = null;

  for (const line of lines) {
    const m = /^###\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (cur) sections.push(cur);
      cur = { label: m[1].replace(/の視点$/, "").trim(), body: "" };
    } else if (cur) {
      cur.body += line + "\n";
    } else {
      preamble += line + "\n";
    }
  }
  if (cur) sections.push(cur);
  return { preamble: preamble.trim(), sections };
}

export function RoleFeedbackTabs({
  text,
  size = "sm",
}: {
  text: string;
  size?: "xs" | "sm";
}) {
  const { preamble, sections } = useMemo(() => parseRoleSections(text), [text]);
  const [active, setActive] = useState(0);

  const proseClass =
    size === "xs"
      ? "prose prose-xs prose-zinc max-w-none"
      : "prose prose-sm prose-zinc max-w-none";

  // ロール見出しが無い、または1つだけの場合はタブにせずそのまま表示。
  if (sections.length <= 1) {
    return (
      <article className={proseClass}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </article>
    );
  }

  const current = sections[Math.min(active, sections.length - 1)];

  return (
    <div>
      {preamble ? (
        <article className={`${proseClass} mb-2`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{preamble}</ReactMarkdown>
        </article>
      ) : null}
      <div className="flex flex-wrap gap-1 border-b border-zinc-200">
        {sections.map((s, i) => (
          <button
            key={`${s.label}-${i}`}
            type="button"
            onClick={() => setActive(i)}
            className={`-mb-px rounded-t border px-3 py-1.5 text-xs font-medium ${
              i === active
                ? "border-zinc-200 border-b-white bg-white text-sky-700"
                : "border-transparent text-zinc-500 hover:text-zinc-700"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <article className={`${proseClass} mt-3`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{current.body.trim()}</ReactMarkdown>
      </article>
    </div>
  );
}

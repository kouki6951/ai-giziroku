import Anthropic from "@anthropic-ai/sdk";
import { buildFeedbackSystemPrompt, buildSummarySystemPrompt } from "./roles";
import { type SpeakerLabels, speakerName } from "./speakers";

const apiKey = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function client() {
  if (!_client) {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export type TranscriptForPrompt = {
  speakerType: string;
  text: string;
  createdAt: Date | string;
};

function transcriptsToText(transcripts: TranscriptForPrompt[], labels: SpeakerLabels): string {
  return transcripts
    .map((t) => `${speakerName(t.speakerType, labels)}: ${t.text}`)
    .join("\n");
}

export async function requestFeedback(
  transcripts: TranscriptForPrompt[],
  opts?: {
    recentLimit?: number;
    roleIds?: string[];
    description?: string | null;
    speakerLabels?: SpeakerLabels;
  },
): Promise<string> {
  const recent = opts?.recentLimit ? transcripts.slice(-opts.recentLimit) : transcripts;
  const conversation = transcriptsToText(recent, opts?.speakerLabels ?? {});

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 1536,
    system: [
      {
        type: "text",
        text: buildFeedbackSystemPrompt(opts?.roleIds, opts?.description),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `以下は直近の会議の会話ログです。これを読み、上記フォーマットで提案を出してください。\n\n${conversation}`,
      },
    ],
  });

  return extractText(res);
}

export async function requestSummary(
  transcripts: TranscriptForPrompt[],
  feedbacks: { feedbackText: string; createdAt: Date | string }[],
  opts?: { roleIds?: string[]; description?: string | null; speakerLabels?: SpeakerLabels },
): Promise<string> {
  const conversation = transcriptsToText(transcripts, opts?.speakerLabels ?? {});
  const feedbackBlock = feedbacks.length
    ? `\n\n## 議中に取得した提案メモ\n${feedbacks
        .map((f, i) => `### 取得${i + 1}\n${f.feedbackText}`)
        .join("\n\n")}`
    : "";

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: buildSummarySystemPrompt(opts?.roleIds, opts?.description),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `以下は会議の全発言ログです。\n\n${conversation}${feedbackBlock}\n\nこれをもとに議事録を Markdown で出力してください。`,
      },
    ],
  });

  return extractText(res);
}

function extractText(res: Anthropic.Messages.Message): string {
  return res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

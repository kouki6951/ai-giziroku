// ロール別フィードバックのための、サーバー/クライアント共通のデータとプロンプト生成。
// ここには Anthropic SDK など server 専用の依存を入れないこと（クライアントからも import するため）。

export type FeedbackRole = {
  id: string;
  label: string;
  perspective: string;
};

// フィードバックを求められるロールの定義。
// /new ページ（クライアント）と各 API（サーバー）の両方から参照する。
export const FEEDBACK_ROLES: FeedbackRole[] = [
  {
    id: "sales",
    label: "営業",
    perspective:
      "売上・受注、顧客との関係構築、商談やクロージングの進め方、提案の説得力といった営業の観点",
  },
  {
    id: "marketing",
    label: "マーケティング",
    perspective:
      "市場やターゲット顧客、ブランディング、訴求メッセージ、集客チャネルや施策の効果といったマーケティングの観点",
  },
  {
    id: "engineer",
    label: "エンジニア",
    perspective:
      "技術的な実現可能性、開発工数、アーキテクチャ、品質・保守性、技術的リスクといったエンジニアの観点",
  },
  {
    id: "management",
    label: "経営・マネジメント",
    perspective:
      "経営戦略、収益性やコスト、リソース配分、意思決定の妥当性、全体最適といった経営・マネジメントの観点",
  },
  {
    id: "designer",
    label: "デザイナー",
    perspective:
      "ユーザー体験(UX)、UI、デザインの一貫性や使いやすさといったデザイナーの観点",
  },
  {
    id: "pm",
    label: "プロダクトマネージャー",
    perspective:
      "プロダクト戦略、優先順位付け、ロードマップ、ユーザー価値とビジネス価値のバランスといったプロダクトマネージャーの観点",
  },
];

export function getRolesByIds(ids: string[]): FeedbackRole[] {
  return FEEDBACK_ROLES.filter((r) => ids.includes(r.id));
}

// Meeting.roles（JSON配列文字列）を安全にパースする。
export function parseRoleIds(roles: string | null | undefined): string[] {
  if (!roles) return [];
  try {
    const parsed = JSON.parse(roles);
    return Array.isArray(parsed) ? parsed.filter((r) => typeof r === "string") : [];
  } catch {
    return [];
  }
}

function contextSection(description?: string | null): string {
  if (!description || !description.trim()) return "";
  return `\n\nこの会議の目的・内容（メタ情報）は以下の通りです。フィードバックの際は必ず考慮してください。\n"""\n${description.trim()}\n"""`;
}

export function buildFeedbackSystemPrompt(
  roleIds?: string[],
  description?: string | null
): string {
  const roles = getRolesByIds(roleIds ?? []);

  // ロール未選択 → 従来どおりのフィードバック。
  if (roles.length === 0) {
    return `あなたは商談・会議の書記アシスタントです。
直近の会話を読み、議事担当者が次に確認・質問すべき事項を提示してください。${contextSection(
      description
    )}

以下の Markdown 構造で、簡潔に出力してください:

## 確認不足
- 箇条書き

## 次に聞くべき質問
- 箇条書き

## リスク
- 箇条書き

## 次アクション
- 箇条書き

該当が無い見出しは「特になし」と書き、推測しすぎないでください。`;
  }

  const roleList = roles.map((r) => `- ${r.label}: ${r.perspective}`).join("\n");
  return `あなたは商談・会議に同席する優秀なアシスタントです。
直近の会話を読み、指定された各ロールの視点から、会議を有利に進めるための簡潔なフィードバックを返してください。${contextSection(
    description
  )}

以下の各ロールの専門的な視点でフィードバックしてください。指定されたロール以外の視点は含めないでください。
${roleList}

出力フォーマット（Markdown）。ロールごとに以下のブロックを繰り返してください:

### {ロール名}の視点
- **確認不足 / 次に聞くべき質問**: 1〜2個
- **リスク**: 該当があれば（なければ「特になし」）
- **次の一手**: そのロールとして取るべきアクション（1〜2個）

各ロールのブロックは簡潔にし、事実に基づかない推測はしないでください。`;
}

export function buildSummarySystemPrompt(
  roleIds?: string[],
  description?: string | null
): string {
  const roles = getRolesByIds(roleIds ?? []);

  // ロール未選択 → 従来どおりの議事録（ロール別フィードバックなし）。
  if (roles.length === 0) {
    return `あなたは商談・会議の書記アシスタントです。
渡された会議の全発言ログと議中の提案メモを読み、議事録を Markdown で生成してください。${contextSection(
      description
    )}

以下の見出し構造に従ってください:

## 会議概要
## 課題
## 要望
## 決定事項
## TODO

各セクションは箇条書きを基本とし、発言者を明示する場合は「(自分)」「(相手)」のように補ってください。
事実に基づかない推測は書かないでください。該当が無い見出しは「特になし」と書いてください。`;
  }

  const roleList = roles.map((r) => `- ${r.label}: ${r.perspective}`).join("\n");
  return `あなたは商談・会議の書記アシスタントです。
渡された会議の全発言ログと議中の提案メモを読み、議事録とロール別のフィードバックを Markdown で生成してください。${contextSection(
    description
  )}

以下の見出し構造に従ってください:

## 会議概要
## 課題
## 要望
## 決定事項
## TODO

各セクションは箇条書きを基本とし、発言者を明示する場合は「(自分)」「(相手)」のように補ってください。
事実に基づかない推測は書かないでください。該当が無い見出しは「特になし」と書いてください。

最後に、以下の各ロールの視点からのフィードバックを追記してください。指定されたロール以外の視点は含めないでください。
${roleList}

## ロール別フィードバック
ロールごとに以下のブロックを繰り返してください:

### {ロール名}の視点
- そのロールならではの具体的で建設的な指摘を2〜3個`;
}

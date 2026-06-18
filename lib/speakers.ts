// 話者（スピーカー）の識別キー・表示名・配色を扱う、サーバー/クライアント共通のユーティリティ。
// ここには server 専用の依存を入れないこと（録音ページなどクライアントからも import するため）。
//
// 話者キーの体系:
//   "self"        … 自分のマイク入力（単一話者）
//   "partner-0"   … 相手側ループバック音声を話者ダイアライゼーションで分離した結果の 1 人目
//   "partner-1"   … 同 2 人目 … 以降 partner-N が続く
//
// AmiVoice の話者ダイアライゼーションは認識結果トークンに "speaker0" / "speaker1" … の
// label を付与する。これを diarizerLabelToKey() で "partner-N" に変換する。

export const SELF_KEY = "self";

export type SpeakerLabels = Record<string, string>;

/** 保存・送信を許可する話者キーか検証する。 */
export function isValidSpeakerKey(key: string): boolean {
  return key === SELF_KEY || /^partner-\d+$/.test(key);
}

/** "partner-3" → 3 / それ以外は null。 */
export function partnerIndex(key: string): number | null {
  const m = /^partner-(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/** AmiVoice の diarizer label("speaker0" 等) を話者キー("partner-0" 等) に変換する。 */
export function diarizerLabelToKey(label: string | undefined | null): string {
  const m = label ? /^speaker(\d+)$/.exec(label) : null;
  return m ? `partner-${m[1]}` : "partner-0";
}

/** カスタム名が無い場合のデフォルト表示名。 */
export function defaultSpeakerName(key: string): string {
  if (key === SELF_KEY) return "自分";
  const i = partnerIndex(key);
  if (i !== null) return `相手${i + 1}`;
  return key;
}

/** Meeting.speakerLabels(JSON 文字列) を安全にパースする。 */
export function parseSpeakerLabels(json: string | null | undefined): SpeakerLabels {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: SpeakerLabels = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    // ignore
  }
  return {};
}

/** カスタム名（あれば）を優先した表示名を返す。 */
export function speakerName(key: string, labels: SpeakerLabels): string {
  const custom = labels[key];
  if (custom && custom.trim()) return custom.trim();
  return defaultSpeakerName(key);
}

// 話者ごとの配色（Tailwind クラス）。self は固定、partner はインデックスで循環。
const SELF_COLOR = { badge: "bg-sky-100 text-sky-700", dot: "bg-sky-500" };
const PARTNER_COLORS = [
  { badge: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  { badge: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  { badge: "bg-violet-100 text-violet-700", dot: "bg-violet-500" },
  { badge: "bg-rose-100 text-rose-700", dot: "bg-rose-500" },
  { badge: "bg-cyan-100 text-cyan-700", dot: "bg-cyan-500" },
  { badge: "bg-fuchsia-100 text-fuchsia-700", dot: "bg-fuchsia-500" },
];

export function speakerColor(key: string): { badge: string; dot: string } {
  if (key === SELF_KEY) return SELF_COLOR;
  const i = partnerIndex(key);
  if (i !== null) return PARTNER_COLORS[i % PARTNER_COLORS.length];
  return { badge: "bg-zinc-100 text-zinc-600", dot: "bg-zinc-400" };
}

/**
 * 既知の話者キー一覧を、表示順（self → partner-0,1,2…）で返す。
 * 発言ログに現れたキーと、ラベル付けされたキーの和集合をとる。
 */
export function collectSpeakerKeys(
  speakerKeys: Iterable<string>,
  labels?: SpeakerLabels,
): string[] {
  const set = new Set<string>([SELF_KEY]);
  for (const k of speakerKeys) if (isValidSpeakerKey(k)) set.add(k);
  if (labels) for (const k of Object.keys(labels)) if (isValidSpeakerKey(k)) set.add(k);
  return [...set].sort((a, b) => {
    if (a === SELF_KEY) return -1;
    if (b === SELF_KEY) return 1;
    return (partnerIndex(a) ?? 0) - (partnerIndex(b) ?? 0);
  });
}

/** 既存の partner キー群の次に割り当てるべき新しい partner キーを返す。 */
export function nextPartnerKey(speakerKeys: Iterable<string>): string {
  let max = -1;
  for (const k of speakerKeys) {
    const i = partnerIndex(k);
    if (i !== null && i > max) max = i;
  }
  return `partner-${max + 1}`;
}

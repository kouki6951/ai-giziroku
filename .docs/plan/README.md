# giziroku-app 設計ドキュメント

`.docs/chatgpt` の概要を元に作成した設計一式。

| #   | ドキュメント                                          | 内容                                                |
| --- | ----------------------------------------------------- | --------------------------------------------------- |
| 01  | [設計書](./01_design.md)                              | 全体構成・機能一覧・非機能要件                      |
| 02  | [実装計画](./02_implementation_plan.md)               | フェーズ別タスク・テスト方針                        |
| 03  | [音声ストリーム取得方式](./03_audio_stream.md)        | AmiVoice WebSocket + AudioWorklet 方式の詳細        |
| 04  | [DB テーブル定義](./04_db_schema.md)                  | テーブル定義・ER 図・Prisma スキーマ                |
| 05  | [画面設計書](./05_screen_design.md)                   | 全画面ワイヤー・レスポンシブ・エラー                |
| 06  | [画面遷移図](./06_screen_transition.md)               | Mermaid による画面遷移・状態遷移・シーケンス        |

アプリ表示名は **AI-Giziroku**（パッケージ名は `giziroku-app`）。

## 想定スタック

- Next.js 15 (App Router) / React 19 / TypeScript
- Tailwind CSS（配色は水色×ライム基調）
- Prisma + SQLite（→ PostgreSQL に切替可能。列追加は `prisma db push` で反映）
- Anthropic Claude API（`claude-sonnet-4-6`）
- AmiVoice Cloud Platform（WebSocket リアルタイム認識）

## 着手順

1. `01_design.md` で全体像を把握
2. `04_db_schema.md` を見ながら Prisma セットアップ
3. `03_audio_stream.md` の方式で音声取得 → 文字起こし PoC
4. `02_implementation_plan.md` のフェーズに沿って機能追加
5. `05_screen_design.md` で UI を仕上げ

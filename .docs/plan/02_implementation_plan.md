# 実装計画

設計書（`01_design.md`）の構成を、開発タスクに分解した計画。1 人開発で着手することを想定し、依存関係順に並べる。

## 0. マイルストーン概観

| Phase | 目標                                                | 完了条件                                                       |
| ----- | --------------------------------------------------- | -------------------------------------------------------------- |
| P0    | 環境セットアップ                                    | `npm run dev` でトップ画面が表示される                         |
| P1    | DB と基本 CRUD                                      | 一覧／詳細／新規作成画面が DB と通信して動く                   |
| P2    | AmiVoice 連携（self 単独で疎通）                    | マイク発話が画面上にリアルタイム表示される                     |
| P3    | 相手音声（ループバック）対応 + 発言保存             | self / partner が自動分離され transcripts に保存される         |
| P4    | Claude 提案（議事中）                               | ボタン押下で提案が表示・保存される                             |
| P5    | Claude 議事録生成                                   | 会議終了で要約が生成され詳細画面で閲覧できる                   |
| P6    | UI 仕上げ／レスポンシブ／エラーハンドリング        | スマホ表示まで含めて一通り操作できる                           |
| P7    | （任意）macOS デスクトップアプリ対応 / 外部マイク 2 本構成 | 仮想オーディオデバイスを介した partner 取得が選択可能になる |

## 1. Phase 0: 環境セットアップ

- [ ] `npx create-next-app@latest giziroku-app --ts --app --tailwind --eslint`
- [ ] shadcn/ui 初期化（`button`, `input`, `card`, `dialog`, `toast`, `scroll-area`）
- [ ] Zustand, TanStack Query, Anthropic SDK, Prisma を導入
- [ ] `.env` の整備
  ```
  DATABASE_URL="file:./dev.db"
  ANTHROPIC_API_KEY=...
  AMIVOICE_APP_KEY=...
  AMIVOICE_WS_URL="wss://acp-api.amivoice.com/v1/"
  CLAUDE_MODEL="claude-sonnet-4-6"
  ```
- [ ] `lib/prisma.ts`、`lib/claude.ts` の雛形作成

## 2. Phase 1: DB と基本 CRUD

- [ ] `prisma/schema.prisma` を `04_db_schema.md` の定義に従って実装
- [ ] `npx prisma migrate dev --name init`（初期マイグレーションのみ。以降の列追加は `npx prisma db push` で反映）
- [ ] Route Handler 実装
  - [ ] `POST /api/meetings`（title に加え description・roles を受け取る）・ `POST /api/meetings/[id]/end`
  - [ ] `GET /api/meetings` ・ `GET /api/meetings/[id]`
- [ ] 画面実装
  - [ ] `/`（一覧）: meeting 一覧をカード表示、「新規ミーティング開始」リンク。生成中の会議には「議事録を生成中」バッジを表示
  - [ ] `/new`: タイトル・会議の内容（メタ情報）入力＋フィードバック対象ロール選択 → POST → `/[id]/recording` へ遷移
  - [ ] `/[id]`（詳細）: 議事録・発言ログ・提案履歴を表示（この時点ではダミーで可）
- [ ] TanStack Query で一覧／詳細の取得を実装

## 3. Phase 2: AmiVoice 連携（マイク 1 系統で疎通）

まずは self 単独で疎通を取り、partner は Phase 3 で追加する。詳細は `03_audio_stream.md` を参照。

- [ ] `public/worklets/pcm-worklet.js` を実装
  - 入力 sampleRate を 16kHz リサンプル
  - Float32 → 16bit PCM（Little Endian）に変換し postMessage
- [ ] `lib/amivoice/client.ts` の `startRecognizer(opts)` を実装
  - 引数で `MediaStream` と `speaker` を受け取る共通ヘルパ
  - WebSocket オープン → `s` コマンド送信 → 受信ハンドラ → 100ms バッファで `p` 送信 → `e` で停止
- [ ] `startDualRecognition` ファサードの `self` 側だけ実装（partner は Phase 3）
  - `getUserMedia` でマイク取得
  - `startRecognizer({ speaker: "self", ... })` を呼ぶ
- [ ] `app/[id]/recording/page.tsx`
  - 「開始」ボタンで `self` 側のみ起動、確定文を画面に追加
  - 中間結果は同じ行に上書き表示

## 4. Phase 3: 相手音声（ループバック）対応 + 発言保存

- [ ] `startDualRecognition` に `startPartner` を追加
  - `getDisplayMedia({ video: true, audio: true })` を呼ぶ
  - video トラックは即 `stop()`、audio のみで `MediaStream` を再構築
  - `getAudioTracks().length === 0` のときは「音声を共有」未選択トーストを出す
  - `startRecognizer({ speaker: "partner", ... })` で 2 本目の WebSocket を張る
- [ ] 録音画面に「相手音声を取り込む」ボタンを追加
  - マイク起動と独立。途中から開始／途中で停止できる
  - 起動中は赤丸インジケータ（partner）を別途表示
- [ ] 確定文が来たら `POST /api/transcripts`（meeting_id, speaker_type, text）
  - `speaker_type` はセッション由来で自動付与（UI トグルは持たない）
- [ ] 楽観更新せず、保存成功後に確定リストへ反映（重複防止）
- [ ] 「相手音声を取り込む」押下前ポップオーバーで対応会議ツール案内を表示
  - Web 会議（Google Meet / Slack ハドル Web 版 / Zoom Web 等）: Chrome タブ共有 + 音声共有 ON
  - Slack / Zoom デスクトップアプリ (Windows): 画面全体共有 + システム音声共有 ON
  - macOS デスクトップアプリ: 「Web 版に切替」または「仮想オーディオデバイス設定」へ誘導
- [ ] partner 系統 ON 中はヘッドホン推奨バナーを常時表示
- [ ] ループバック未対応ケース（macOS の画面全体音声等）のフォールバック案内を README とアプリ内ヘルプに記載

## 5. Phase 4: Claude 提案（議事中）

- [ ] `lib/claude.ts` に `requestFeedback(transcripts, { roleIds, description })` を実装
  - システムプロンプトは `lib/roles.ts` の `buildFeedbackSystemPrompt(roleIds, description)` で組み立てる
    - ロール選択あり → 選択ロール別（`### {ロール名}の視点`）のフィードバックを生成
    - ロール未選択 → ロール非依存（確認不足／次に聞くべき質問／リスク／次アクションの 4 観点）のフィードバックを生成
    - `description`（会議のメタ情報）があればプロンプトにコンテキストとして埋め込む
  - **キャッシュ方針**: `system` ブロックにのみ `cache_control: { type: "ephemeral" }` を付与する
  - `messages` 側にはキャッシュを設定しない（毎リクエストで内容が伸びるため）
- [ ] フィードバック対象ロールは `lib/roles.ts` の `FEEDBACK_ROLES` に定義（営業 / マーケティング / エンジニア / 経営・マネジメント / デザイナー / プロダクトマネージャー）。クライアント（`/new`）とサーバー（API）の両方から参照する
- [ ] `POST /api/claude/feedback`
  - meeting_id を受け取り、meeting の roles・description と直近 N 件の transcripts を取得（speaker_type 付きで整形）
  - Claude 呼び出し → 返ってきた Markdown 文字列を claude_feedbacks に保存 → 結果返却
- [ ] 画面右ペインに最新フィードバックを表示。ロール別は `role-feedback-tabs.tsx` でロールごとのタブに分けて表示。履歴は折り畳み

## 6. Phase 5: Claude 議事録生成

- [ ] `requestSummary(transcripts, feedbacks, { roleIds, description })` を実装
  - システムプロンプトは `lib/roles.ts` の `buildSummarySystemPrompt(roleIds, description)` で組み立てる（`## 会議概要 / ## 課題 / ## 要望 / ## 決定事項 / ## TODO`。ロール選択時はロール別フィードバックを追記）
  - **キャッシュ方針**: 同じくシステムプロンプトのみ `cache_control: ephemeral`
- [ ] `POST /api/claude/summary`（バックグラウンド実行）
  - meeting の全 transcripts + 全 feedbacks（および roles・description）を渡す
  - まず `meetings.summary_status='processing'` に更新し、`202 Accepted` を即返す
  - 議事録生成は Next.js の `after()` でレスポンス送出後に実行。完了したら Markdown をそのまま `meeting_summaries.summary_text` に INSERT（パース・構造化はしない）し `summary_status='done'`、失敗時は `'error'`
- [ ] 録音画面の「議事録を生成して終了」押下時は、`POST /api/meetings/[id]/end`（ended_at 確定）→ `POST /api/claude/summary`（バックグラウンド開始）の順で呼び、生成完了を待たずに一覧画面へ即遷移する
- [ ] 詳細画面で議事録（react-markdown で Markdown レンダリング）と提案履歴を時系列で表示。生成中は `summary-status-poller.tsx` でポーリングして完了を自動反映

## 7.5 Phase 7（任意）: macOS デスクトップアプリ対応 / 外部マイク 2 本構成

- [ ] partner 系統の入力ソースを「画面共有」と「マイクデバイス指定」から選択可能にする
- [ ] `startDualRecognition` に `partnerDeviceId` 引数を追加し、`getUserMedia({ audio: { deviceId } })` で 2 本目のマイクとして取り込む
- [ ] 設定ダイアログで利用可能オーディオデバイス一覧を `enumerateDevices()` から取得して提示
- [ ] アプリ内ヘルプに BlackHole / Loopback の手順を記載

## 7. Phase 6: UI 仕上げ・レスポンシブ・エラー

- [ ] レスポンシブ（`05_screen_design.md` 参照）
- [ ] 通信エラー時のリトライ／トースト表示
- [ ] WebSocket 切断時の自動再接続インジケータ
- [ ] 録音中ナビゲーション離脱の警告（`beforeunload`）
- [ ] 動作確認のための README 整備（マイク権限の許可手順を含む）

## 8. テスト方針（最小限）

- ユニット: `lib/claude.ts` の入出力整形、PCM 変換ロジック（worklet 抽出関数）
- 結合: Route Handler を Vitest + supertest 風に叩く（DB は SQLite テンポラリ）
- 手動 E2E: 実機マイクで 5 分会議を録音し、確定文の DB 保存、提案、要約まで通すシナリオ

## 9. ロールアウト判定基準

- 5 分の会議で確定文の取りこぼし／重複が無い
- Claude 提案／要約がエラーなく毎回返る
- 詳細画面で発言ログ・提案履歴・議事録の 3 セクションが揃って表示される
- 全画面が PC／タブレット／スマホで崩れない

## 10. 確定事項（2026-05-29 合意）

| # | 論点 | 採用方針 |
| - | ---- | -------- |
| 1 | 「相手側」音声の取得方法 | **システム音声ループバック併用**。マイク=self、`getDisplayMedia({video:true,audio:true})` の audio トラック=partner として 2 系統並列で AmiVoice に接続。詳細は `03_audio_stream.md`。 |
| 2 | 議事録の保存形式 | **Markdown 文字列のまま** `meeting_summaries.summary_text` に保存。表示は `react-markdown`、構造化 JSON 化はしない。 |
| 3 | プロンプトキャッシュの粒度 | **システムプロンプトのみ** `cache_control: ephemeral`。提案用と要約用でシステムプロンプトを分離し、それぞれ独立にキャッシュさせる。会話履歴側はキャッシュ対象外。 |

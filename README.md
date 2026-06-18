# AI-Giziroku

商談・面談・会議の発言を AmiVoice でリアルタイム文字起こしし、Claude で議事中の提案（ロール別）と議事録生成を行う Web アプリ。

- 会議開始時に **会議の内容（メタ情報）** を入力でき、要約・提案の精度を高められます。
- Claude のフィードバックは **営業・マーケティング・エンジニアなどロール別** に生成され、画面では **ロールごとのタブ** で切り替えて閲覧できます（ロール未選択時は従来形式の提案）。
- 議事録生成は **バックグラウンドで実行** され、完了後に詳細画面へ自動反映されます。
- 相手側（オンライン会議の参加者）が複数人でも、**話者ダイアライゼーションで自動分離**（相手1・相手2…）。分離の誤りは **話者名のリネーム** や **発言ごとの話者付け替え** で手動修正でき、分離感度は録音画面のスライダーで調整できます。

設計詳細は [.docs/plan/](./.docs/plan/) を参照してください。

## 必要要件

- Node.js 20.x 以上
- Chrome または Edge（最新版）
- AmiVoice Cloud Platform のアカウント／APP_KEY
- Anthropic API キー

## セットアップ

```bash
npm install
npx prisma db push   # prisma/schema.prisma の内容で SQLite を作成・反映
```

`.env` を編集して各種キーを設定します。

```env
DATABASE_URL="file:./dev.db"

ANTHROPIC_API_KEY="sk-ant-..."
CLAUDE_MODEL="claude-sonnet-4-6"

NEXT_PUBLIC_AMIVOICE_APP_KEY="..."
NEXT_PUBLIC_AMIVOICE_WS_URL="wss://acp-api.amivoice.com/v1/"
NEXT_PUBLIC_AMIVOICE_ENGINE="-a-general"

# 相手側の話者分離の感度（任意）。大きいほど話者が分かれやすい。
# 録音画面のスライダーが優先され、未操作時のフォールバック既定値として使われる。
NEXT_PUBLIC_AMIVOICE_DIARIZER_ALPHA="1e0"
NEXT_PUBLIC_AMIVOICE_DIARIZER_TRANSITION_BIAS=""
```

> `NEXT_PUBLIC_AMIVOICE_APP_KEY` はブラウザに露出されます。社内 LAN / VPN 配下での運用を前提とします。

## 起動

```bash
npm run dev
```

http://localhost:3000 を開く。

## 使い方

1. トップ画面の「＋ 新規ミーティング」を押し、**タイトル**・**会議の内容（メタ情報）**・**フィードバックを求めるロール**を入力・選択して「開始」
   - 選択できるロール: 営業 / マーケティング / エンジニア / 経営・マネジメント / デザイナー / プロダクトマネージャー
   - ロールを 1 つも選ばない場合は、従来形式（ロール非依存）のフィードバックになります
2. 録音画面で「開始（マイク）」を押し、マイク権限を許可する
3. 必要に応じて「相手音声を取り込む」を押し、画面共有ダイアログで以下を選ぶ
   - Web 版 Meet / Slack ハドル等 → **Chrome タブ** を選び「音声を共有」ON
   - Slack / Zoom デスクトップ版 (Windows) → **画面全体** を選び「システムの音声を共有」ON
   - macOS デスクトップ版 → 後述「対応状況」を参照
4. 相手が複数人の場合、相手側の発言は自動で「相手1・相手2…」に分離されます
   - うまく分かれない／分かれすぎる場合は、録音画面の **「話者分離の感度」スライダー** を調整（録音中の変更は「再適用」ボタンで反映。設定はブラウザに保存されます）
   - 自動分離の誤りは、**話者名の入力欄でリネーム**（全発言に反映）、または **各発言のセレクトで話者を付け替え**て修正できます（会議終了後の詳細画面でも編集可能）
5. 発言ログが溜まったら「フィードバック取得」で Claude の提案を取得（選択ロール別にタブで切り替え表示）
6. 「議事録を生成して終了」を押すと会議を終了し、**議事録はバックグラウンドで生成**されながら一覧へ戻ります。生成完了後、詳細画面で議事録とロール別フィードバックを閲覧できます

## 対応する音声取得方式

| 会議ツール        | 起動形態          | OS              | 対応 | 取得方法                                  |
| ----------------- | ----------------- | --------------- | ---- | ----------------------------------------- |
| Google Meet       | Web               | Windows / macOS | ◯    | Chrome タブ共有 + 「音声を共有」ON         |
| Slack ハドル       | Web (slack.com)   | Windows / macOS | ◯    | Chrome タブ共有 + 「音声を共有」ON         |
| Slack ハドル       | デスクトップアプリ | Windows         | ◯    | 「画面全体」共有 + 「システム音声」ON      |
| Slack ハドル       | デスクトップアプリ | macOS           | △    | BlackHole 等の仮想オーディオデバイスが必要 |
| Zoom / Teams      | Web               | Windows / macOS | ◯    | Chrome タブ共有 + 「音声を共有」ON         |
| Zoom / Teams      | デスクトップアプリ | Windows         | ◯    | 「画面全体」共有 + 「システム音声」ON      |
| Zoom / Teams      | デスクトップアプリ | macOS           | △    | 同上                                      |

「ウィンドウ」共有では Chrome 仕様により音声が取得できません。タブ／画面全体のいずれかを選んでください。

### エコー対策

相手音声がスピーカから流れていると自分側マイクに回り込み、同じ発話が self / partner の両方に記録されます。**ヘッドホンの使用を強く推奨**します。録音画面では partner 系統 ON 時にバナーで案内します。

### 複数話者の分離について

相手側（オンライン会議の参加者）はミックスされた 1 本のループバック音声として届くため、AmiVoice の話者ダイアライゼーションで自動分離します（最大 20 話者）。1 本の混合音声からの分離のため、声質が近い・同時発話が多い場面では精度が落ちます。だからこそ感度スライダーと手動修正（リネーム・話者付け替え）を併用してください。自分側マイクは単一話者（`self`）として扱います。

## ディレクトリ構成

```
app/
├── page.tsx                         # 一覧（生成状況バッジ付き）
├── new/page.tsx                     # 新規作成（メタ情報・ロール選択）
├── meeting-card.tsx                 # 一覧カード
├── [id]/page.tsx                    # 詳細（議事録・ロール別フィードバック）
├── [id]/recording/page.tsx          # 録音（複数話者表示・感度スライダー・手動修正）
├── [id]/role-feedback-tabs.tsx      # ロール別フィードバックのタブ表示
├── [id]/speakers-ui.tsx             # 話者バッジ／話者名編集／話者付け替えセレクト（共通）
├── [id]/transcript-list.tsx         # 詳細画面の発言ログ（複数話者表示・編集）
├── [id]/summary-status-poller.tsx   # 生成中の自動更新
└── api/
    ├── meetings/[id]/...               # GET / PATCH（話者名）/ DELETE / end
    ├── transcripts/                    # POST（発言保存）
    ├── transcripts/[id]/route.ts       # PATCH（発言の話者付け替え）
    └── claude/{feedback,summary}/...   # summary はバックグラウンド生成
lib/
├── prisma.ts
├── claude.ts                        # Anthropic SDK ラッパ（ロール別プロンプト・話者名反映）
├── roles.ts                         # フィードバックロールの定義とプロンプト生成
├── speakers.ts                      # 話者キー・表示名・配色・diarizer label 変換（共通）
├── utils.ts
└── amivoice/client.ts               # WebSocket + AudioWorklet ラッパ（話者ダイアライゼーション）
public/worklets/pcm-worklet.js       # 16kHz/16bit PCM 変換
prisma/schema.prisma
```

## データモデル（Meeting 主要カラム）

| カラム          | 用途                                              |
| --------------- | ------------------------------------------------- |
| `title`         | 会議タイトル                                      |
| `description`   | 会議の内容・目的（メタ情報）                       |
| `roles`         | フィードバック対象ロール（JSON 配列の文字列）       |
| `speakerLabels` | 話者キー→表示名の対応（JSON オブジェクトの文字列）   |
| `summaryStatus` | 議事録生成の状態（processing / done / error）      |

関連: `Transcript`（発言ログ）/ `ClaudeFeedback`（提案履歴）/ `MeetingSummary`（議事録）

## 主要コマンド

| コマンド               | 用途                                    |
| ---------------------- | --------------------------------------- |
| `npm run dev`          | 開発サーバ起動 (http://localhost:3000)  |
| `npm run build`        | 本番ビルド                              |
| `npm start`            | ビルド済み本番サーバ起動                |
| `npx prisma studio`    | DB ブラウザ (GUI)                        |
| `npx prisma db push`   | スキーマ変更を DB に反映                 |

## 既知の制約

- 認証機構なし。社内 LAN / VPN 配下での運用を前提
- macOS デスクトップアプリの音声取得は仮想オーディオデバイス（BlackHole / Loopback 等）の事前設定が必要
- AmiVoice の APP_KEY は `NEXT_PUBLIC_` でクライアントに露出される。社外公開する場合は短期トークン方式に切り替えること
- 1 つの会議で AmiVoice WebSocket を最大 2 並列で開く（self + partner）。AmiVoice 契約の同時接続上限を事前に確認すること
- 相手側の話者分離は 1 本の混合音声からの推定のため精度に限界がある（最大 20 話者）。感度スライダーと手動修正での補正を前提とする

# AI-Giziroku

商談・面談・会議の発言を AmiVoice でリアルタイム文字起こしし、Claude で議事中の提案（ロール別）と議事録生成を行う Web アプリ。

- 会議開始時に **会議の内容（メタ情報）** を入力でき、要約・提案の精度を高められます。
- Claude のフィードバックは **営業・マーケティング・エンジニアなどロール別** に生成され、画面では **ロールごとのタブ** で切り替えて閲覧できます（ロール未選択時は従来形式の提案）。
- 議事録生成は **バックグラウンドで実行** され、完了後に詳細画面へ自動反映されます。

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
4. 発言ログが溜まったら「フィードバック取得」で Claude の提案を取得（選択ロール別にタブで切り替え表示）
5. 「議事録を生成して終了」を押すと会議を終了し、**議事録はバックグラウンドで生成**されながら一覧へ戻ります。生成完了後、詳細画面で議事録とロール別フィードバックを閲覧できます

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

## ディレクトリ構成

```
app/
├── page.tsx                         # 一覧（生成状況バッジ付き）
├── new/page.tsx                     # 新規作成（メタ情報・ロール選択）
├── meeting-card.tsx                 # 一覧カード
├── [id]/page.tsx                    # 詳細（議事録・ロール別フィードバック）
├── [id]/recording/page.tsx          # 録音
├── [id]/role-feedback-tabs.tsx      # ロール別フィードバックのタブ表示
├── [id]/summary-status-poller.tsx   # 生成中の自動更新
└── api/
    ├── meetings/...
    ├── transcripts/...
    └── claude/{feedback,summary}/...   # summary はバックグラウンド生成
lib/
├── prisma.ts
├── claude.ts                        # Anthropic SDK ラッパ（ロール別プロンプト）
├── roles.ts                         # フィードバックロールの定義とプロンプト生成
├── utils.ts
└── amivoice/client.ts               # WebSocket + AudioWorklet ラッパ
public/worklets/pcm-worklet.js       # 16kHz/16bit PCM 変換
prisma/schema.prisma
```

## データモデル（Meeting 主要カラム）

| カラム          | 用途                                              |
| --------------- | ------------------------------------------------- |
| `title`         | 会議タイトル                                      |
| `description`   | 会議の内容・目的（メタ情報）                       |
| `roles`         | フィードバック対象ロール（JSON 配列の文字列）       |
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

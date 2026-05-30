# 画面遷移図（Mermaid）

## 1. 画面遷移（全体）

```mermaid
flowchart LR
    Start([アプリ起動])
    S01[/S01: 議事録一覧 /]
    S02[/S02: 新規ミーティング作成 /new/]
    S03[/S03: 録音画面 /[id]/recording/]
    S04[/S04: 議事録詳細 /[id]/]

    Start --> S01
    S01 -->|新規ミーティング開始| S02
    S01 -->|カードクリック| S04
    S02 -->|タイトル・メタ情報入力 + ロール選択 + 開始| S03
    S02 -->|キャンセル| S01
    S03 -->|議事録を生成して終了（生成はバックグラウンド）| S01
    S03 -->|終了のみ| S04
    S03 -.->|戻る確認 → OK| S01
    S04 -->|一覧へ戻る| S01
    S04 -.->|録音画面へ（進行中の会議）| S03
```

## 2. 録音画面（S03）内部のステートフロー

self（マイク）と partner（ループバック）が独立に状態を持つ。Claude API 呼び出しはそれらと独立した上位イベント。

```mermaid
stateDiagram-v2
    state SelfPipeline {
        [*] --> SelfIdle
        SelfIdle --> SelfConnecting: 「開始」ボタン
        SelfConnecting --> SelfRecording: WebSocket open + ACK
        SelfConnecting --> SelfError: 接続失敗(3回)
        SelfRecording --> SelfRecording: 中間/確定発話
        SelfRecording --> SelfReconnecting: WebSocket 切断
        SelfReconnecting --> SelfRecording: 再接続成功
        SelfReconnecting --> SelfError: 再接続失敗
        SelfError --> SelfRecording: 復帰
    }

    state PartnerPipeline {
        [*] --> PartnerIdle
        PartnerIdle --> PartnerRequesting: 「相手音声を取り込む」
        PartnerRequesting --> PartnerConnecting: getDisplayMedia OK + 音声トラック有
        PartnerRequesting --> PartnerIdle: ユーザがキャンセル / 音声未共有
        PartnerConnecting --> PartnerRecording: WebSocket open + ACK
        PartnerConnecting --> PartnerError: 接続失敗(3回)
        PartnerRecording --> PartnerRecording: 中間/確定発話
        PartnerRecording --> PartnerIdle: 「相手音声を停止」 / 画面共有終了
        PartnerRecording --> PartnerReconnecting: WebSocket 切断
        PartnerReconnecting --> PartnerRecording: 再接続成功
        PartnerReconnecting --> PartnerError: 再接続失敗
        PartnerError --> PartnerIdle: 復帰
    }

    state ClaudeOps {
        [*] --> ClaudeIdle
        ClaudeIdle --> FetchingFeedback: 「フィードバック取得」
        FetchingFeedback --> ClaudeIdle: 提案表示完了（ロール別はタブ表示）
        FetchingFeedback --> ClaudeIdle: Claude API エラー (トースト)
        ClaudeIdle --> Ending: 「議事録を生成して終了」
        Ending --> [*]: ended_at 更新 + summary_status=processing → 一覧へ即遷移
        Ending --> ClaudeIdle: 生成開始に失敗 (トースト)
        ClaudeIdle --> [*]: 「終了のみ」→ ended_at 更新して詳細へ
    }
    note right of ClaudeOps
        議事録生成は after() でバックグラウンド実行。
        完了で summary_status=done（失敗で error）。
        詳細／一覧画面はポーリングで反映。
    end note
```

## 3. API シーケンス：ミーティング開始〜議事録保存

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant B as Browser (Next.js)
    participant A as Next.js API
    participant DB as SQLite
    participant AV as AmiVoice (wss)
    participant CL as Claude API

    U->>B: タイトル・メタ情報入力 + ロール選択 + 開始
    B->>A: POST /api/meetings {title, description, roles}
    A->>DB: INSERT meetings (started_at=now, description, roles)
    A-->>B: {id}
    B->>B: /[id]/recording へ遷移

    U->>B: マイク許可
    B->>AV: WebSocket A open + "s 16K LSB16 ... auth=APP_KEY" (self)
    AV-->>B: "s" ACK (A)

    U->>B: 「相手音声を取り込む」押下
    B->>U: getDisplayMedia ダイアログ(音声共有ONを案内)
    U->>B: タブ/画面選択 + 音声を共有ON
    B->>AV: WebSocket B open + "s 16K LSB16 ... auth=APP_KEY" (partner)
    AV-->>B: "s" ACK (B)

    par self 系統
        loop 録音中(self)
            B->>AV: PCM (A, speaker=self)
            AV-->>B: "U"/"A" (A)
            B->>A: POST /api/transcripts {speaker_type:"self", text}
            A->>DB: INSERT transcripts
            A-->>B: 200 OK
        end
    and partner 系統
        loop 録音中(partner)
            B->>AV: PCM (B, speaker=partner)
            AV-->>B: "U"/"A" (B)
            B->>A: POST /api/transcripts {speaker_type:"partner", text}
            A->>DB: INSERT transcripts
            A-->>B: 200 OK
        end
    end

    U->>B: 「フィードバック取得」
    B->>A: POST /api/claude/feedback {meeting_id}
    A->>DB: SELECT meeting.roles / description / 直近 transcripts
    Note over A,CL: roles・description からロール別 system を構築<br/>system のみ cache_control:ephemeral、messages 側はキャッシュなし
    A->>CL: messages.create (system + 直近会話)
    CL-->>A: 提案 Markdown（ロール別 or ロール非依存）
    A->>DB: INSERT claude_feedbacks (feedback_text=Markdown 文字列)
    A-->>B: 提案 Markdown
    B->>U: 右ペインに表示（ロール別はタブで切替）

    U->>B: 「議事録を生成して終了」
    B->>A: POST /api/meetings/[id]/end
    A->>DB: UPDATE meetings SET ended_at=now
    B->>A: POST /api/claude/summary {meeting_id}
    A->>DB: UPDATE meetings SET summary_status='processing'
    A-->>B: 202 Accepted（生成完了を待たない）
    B->>B: /（一覧）へ即遷移
    Note over A,CL: 以降は after() でレスポンス送出後に実行
    A->>DB: SELECT 全 transcripts / 全 feedbacks / roles / description
    A->>CL: messages.create (要約用 system + 履歴)
    CL-->>A: 議事録 Markdown
    A->>DB: INSERT meeting_summaries (summary_text=Markdown, パース無し)
    A->>DB: UPDATE meetings SET summary_status='done'（失敗時 'error'）
    Note over B,DB: 一覧／詳細画面はポーリングで完了を反映
```

## 4. 一覧／詳細閲覧フロー

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant B as Browser
    participant A as Next.js API
    participant DB as SQLite

    U->>B: トップ画面アクセス
    B->>A: GET /api/meetings
    A->>DB: SELECT meetings ORDER BY created_at DESC
    A-->>B: meetings[]
    B->>U: 一覧表示

    U->>B: カードクリック
    B->>A: GET /api/meetings/[id]
    A->>DB: SELECT meeting / transcripts / feedbacks / 最新 summary
    A-->>B: 詳細データ
    B->>U: 議事録 + 発言ログ + 提案履歴表示
```

## 5. エラー復帰フロー

```mermaid
flowchart TD
    A[録音中 self+partner] -->|self WebSocket 切断| B{self 自動再接続}
    A -->|partner WebSocket 切断| C{partner 自動再接続}
    B -->|成功| A
    C -->|成功| A
    B -->|3回失敗| D[self エラートースト]
    C -->|3回失敗| E[partner エラートースト]
    D --> F{ユーザ操作}
    E --> G{ユーザ操作}
    F -->|手動で再接続| B
    G -->|手動で再接続| C
    G -->|partner だけ諦める| A
    F -->|議事録を生成して終了| H[ended_at 更新 + summary_status=processing]
    H --> K[/S01: 一覧（生成はバックグラウンド）/]
    F -->|終了のみ| I[ended_at 更新]
    I --> J[/S04: 議事録詳細/]
```

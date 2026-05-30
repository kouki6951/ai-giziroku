# 音声ストリーム取得方式

AmiVoice Cloud Platform の WebSocket 音声認識 API を、ブラウザから 2 系統並列で呼び出す方式で取得する。

- **自分の声**: `getUserMedia` で取得したマイク入力 → AmiVoice セッション A（`speaker_type = self`）
- **相手の声**: `getDisplayMedia` で取得したシステム音声（タブ／画面のループバック） → AmiVoice セッション B（`speaker_type = partner`）

サーバを経由しない理由は、リアルタイム性（往復遅延の削減）と Next.js Route Handler の WebSocket 非対応のため。AmiVoice の APP_KEY はクローズド運用のためブラウザに直接配布する（社内 LAN／VPN 前提）。

## 1. 全体フロー

```
┌─────────────────────────────────────────────────────────────────┐
│                            Browser                              │
│                                                                 │
│  ┌──────────────────────┐        ┌──────────────────────────┐   │
│  │ Mic Pipeline (self)  │        │ Loopback Pipeline (peer) │   │
│  │ getUserMedia         │        │ getDisplayMedia          │   │
│  │   ({audio:true})     │        │   ({video:true,audio:true│   │
│  │   ↓                  │        │      })  ※video は破棄  │   │
│  │ AudioContext         │        │   ↓                      │   │
│  │   + AudioWorklet     │        │ AudioContext             │   │
│  │   (16kHz 16bit LE)   │        │   + AudioWorklet         │   │
│  │   ↓                  │        │   ↓                      │   │
│  │ WebSocket A (wss)    │        │ WebSocket B (wss)        │   │
│  └──────────┬───────────┘        └─────────────┬────────────┘   │
│             │                                  │                │
│             │   (U: 中間 / A: 確定)             │                │
│             ▼                                  ▼                │
│      Recording Store (Zustand)  ←  speaker_type を付与          │
│             │                                                   │
│             ├─→ 画面表示（タイムラインに self / partner 混在）   │
│             └─→ 確定文のみ POST /api/transcripts                │
└─────────────────────────────────────────────────────────────────┘

  ⇅ wss
  AmiVoice Cloud API（同一 APP_KEY で同時 2 セッション）
```

## 2. 採用方式

### 2.1 自分の声（マイク）
- `navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } })`
- `AudioContext({ sampleRate: 16000 })` → `createMediaStreamSource()` → AudioWorkletNode に接続
- 取得タイミング: 録音画面の「開始」ボタン押下時

### 2.2 相手の声（システム音声ループバック）
- `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`
  - **video が必須**: Chrome 仕様で audio 単独は不可。取得した video トラックは即 `stop()` して破棄
  - ユーザはダイアログで共有対象を選び、**「音声を共有」「システムの音声を共有」チェックを ON** にする必要がある
- 取得した MediaStream から `getAudioTracks()` を抜き出し、新しい `MediaStream(audioTracks)` を構築
- 別の `AudioContext({ sampleRate: 16000 })` を作り、同じ AudioWorklet を別インスタンスで接続
- 取得タイミング: 録音画面の「相手音声を取り込む」ボタン押下時（マイクと独立して開始可能）

#### 共有対象別の挙動（Chrome / Edge 前提）

| 共有対象        | 音声取得 | 用途                                                    |
| --------------- | -------- | ------------------------------------------------------- |
| **Chrome タブ** | ◯        | Web 版 Google Meet / Slack ハドル / Zoom Web 等        |
| **画面全体**    | △        | Windows: ◯（デスクトップアプリの音声を取得） / macOS: × |
| **ウィンドウ**  | ×        | Chrome 仕様で音声共有不可。選ばないよう案内             |

#### 主要な Web 会議ツールへの対応

| ツール                    | 起動形態          | OS              | 対応 | 取得方法                                  |
| ------------------------- | ----------------- | --------------- | ---- | ----------------------------------------- |
| **Google Meet**           | Web（ブラウザ）   | Windows / macOS | ◯    | Chrome タブ共有 + 「音声を共有」ON         |
| **Slack ハドル**          | Web（ブラウザ）   | Windows / macOS | ◯    | Chrome タブ共有 + 「音声を共有」ON         |
| **Slack ハドル**          | デスクトップアプリ | Windows         | ◯    | 「画面全体」共有 + 「システムの音声」ON    |
| **Slack ハドル**          | デスクトップアプリ | macOS           | △    | 後述「macOS デスクトップアプリの回避策」参照 |
| **Zoom / Teams（Web 版）** | Web（ブラウザ）   | Windows / macOS | ◯    | Chrome タブ共有 + 「音声を共有」ON         |
| **Zoom / Teams（デスクトップアプリ）** | デスクトップアプリ | Windows | ◯    | 「画面全体」共有 + 「システムの音声」ON    |
| **Zoom / Teams（デスクトップアプリ）** | デスクトップアプリ | macOS   | △    | 同上                                      |

#### macOS デスクトップアプリの回避策
macOS では Chrome / Edge が **システム全体の音声共有に未対応**。デスクトップアプリ版のハドル／ミーティングを対象にする場合は、仮想オーディオデバイスを経由する。

1. **BlackHole** / **Loopback** / **Soundflower** などの仮想オーディオデバイスをインストール
2. macOS の「サウンド出力」を仮想デバイス（または Multi-Output Device で実スピーカと併用）に切替
3. AI-Giziroku 側ではマイク選択 UI で **仮想デバイスを `partner` の入力に指定**
   - この場合 `getDisplayMedia` は使わず、`getUserMedia({ audio: { deviceId: <virtual> } })` で 2 本目のマイクとして取り込む
   - 実装上は `startDualRecognition` に「partner 用 deviceId」を渡せる引数を生やす（Phase 7 で対応）

MVP（Phase 3）では macOS デスクトップアプリ対応は **要追加設定** とし、ヘルプドキュメントへの誘導のみ行う。

#### ループバックが取れないケース
| 状況                                              | 挙動                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| ユーザが「音声を共有」チェックを ON にしなかった   | `getAudioTracks().length === 0`。トースト「相手音声が共有されていません」 |
| 「ウィンドウ」を選択した                          | 上と同じ。「タブ または 画面全体 を選んでください」と案内                 |
| ブラウザが Chrome / Edge 以外                     | エラー画面で「Chrome / Edge を使用してください」                         |
| macOS で「画面全体」を選んでも音声が来ない        | OS の制約。「Web 版を使うか、仮想オーディオデバイスを設定」と案内         |

#### 自分の声がループバックに混入する場合
- Web 会議クライアント側で「自分の声を含めるか」は制御不可
- 対応: ループバック側の認識結果には固定で `speaker_type = partner` を付与する。混入があっても運用上の影響は限定的（重複は許容、ノイズ扱い）
- **エコー対策**: 相手音声がスピーカから流れていると self 側マイクが拾い、二重に認識される。**ヘッドホン使用を強く推奨**（オンボーディング／録音画面で常時案内）
- 将来的にエコーキャンセル相当の処理を入れる余地は残す

### 2.3 PCM 変換（AudioWorklet）
`ScriptProcessorNode` は非推奨かつメインスレッド負荷が大きいため、**AudioWorklet を採用する**。

`public/worklets/pcm-worklet.js` の役割:
- `process(inputs)` で受け取った Float32 サンプル（-1.0〜1.0）を
  1. ターゲット 16kHz にダウンサンプル（線形補間）
  2. `Int16Array` にスケール（`Math.max(-1, Math.min(1, x)) * 0x7FFF`）
  3. `postMessage(buffer, [buffer])`（Transferable）でメインへ転送
- 1 フレーム ≒ 20ms（16000 * 0.02 = 320 サンプル = 640 バイト）
- メインスレッド側で 100ms 分（5 フレーム）まとめてから WebSocket に送る
- 同じ worklet を 2 つの AudioContext で個別にロードする（インスタンスが独立する）

### 2.4 AmiVoice WebSocket 接続（2 並列）
AmiVoice のリアルタイム音声認識 API は、テキストフレームでコマンド、バイナリフレームで音声データをやり取りするプロトコル。

#### 接続
- URL: `wss://acp-api.amivoice.com/v1/`
- 認証: 開始コマンドに `authorization=<APP_KEY>` を含める
- APP_KEY はクローズド運用前提でフロントの env（`NEXT_PUBLIC_AMIVOICE_APP_KEY`）に出す
  - 将来公開運用に切り替える場合は、Route Handler から短期トークンを返す方式に差し替えること

#### コマンド（テキストフレーム）
- 開始: `s <音声フォーマット> <エンジン> <パラメータ列>`
  - 例: `s 16K LSB16 -a-general authorization=<APP_KEY> resultUpdatedInterval=400`
  - `16K LSB16` = 16kHz / 16bit / リトルエンディアン PCM
- 音声送信: バイナリフレーム先頭 1 バイトに `p`（=0x70）を付け、後続に PCM データ
- 終了: テキストフレーム `e`

#### 受信イベント
- `s` レスポンス: 開始 ACK
- `U <json>`: 中間結果（未確定）
- `A <json>`: 確定発話（最終結果）
- `e` レスポンス: 終了 ACK
- エラー: `s`／`A` の `code` フィールド非 0

確定発話のみを DB 保存対象とする。中間結果は画面の最終行に上書き表示する。

### 2.5 self / partner の付与
- 認識結果ごとに、どちらの WebSocket セッションから来たかで `speaker_type` を一意に決定
  - セッション A の結果 → `self`
  - セッション B の結果 → `partner`
- UI で手動切替は **しない**（ループバック方式により自動分離されるため）

## 3. 採用しなかった代替案と理由

| 案                                       | 不採用理由                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| 同一マイクで両方拾い、UI トグルで分離     | 切替負荷が高く、後で誰の発言か追えなくなる。提案／要約の質も落ちる            |
| 外部マイクを 2 本物理接続して別系統取得   | ハード要件が増える。ループバックで済むオンライン会議では過剰                  |
| Web 会議ツール（Zoom／Teams）の API 連携  | 各ツールごとに認証・帯域・契約が必要。MVP のスコープ外                        |
| MediaRecorder で Opus/WebM を AmiVoice へ | AmiVoice の主要フォーマットが PCM 系。デコード手間が増える                    |
| ScriptProcessorNode                      | 非推奨。メインスレッド負荷集中。AudioWorklet で代替可                         |
| サーバを経由して AmiVoice にプロキシ      | Route Handler は WebSocket 非対応。Edge runtime も同様に困難                  |
| Web Speech API（ブラウザ標準音声認識）   | Chrome 依存・業務利用要件を満たさない                                         |

## 4. パフォーマンス／品質設計

| 観点         | 設計                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| 送信間隔     | 100ms にバッファリングして送信（self / partner それぞれ独立に）             |
| 遅延         | 東京リージョン前提で 1〜2 秒以内を目標                                     |
| 切断回復     | `onclose` 検知 → 3 秒後に自動再接続。中間結果は破棄して継続                  |
| 同時接続数   | 同一 APP_KEY で 2 セッション。AmiVoice 契約の同時接続上限と整合確認         |
| 音量低下対策 | Worklet 内で簡易ピーク監視。閾値以下が 10 秒続いたらトースト警告           |
| 中断検知     | ページ離脱時 (`pagehide`／`visibilitychange`) に両セッションを確実に停止     |

## 5. 失敗時のフォールバック

| ケース                                       | 挙動                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------- |
| マイク権限拒否                                | エラー画面：「マイク権限を許可してください」                         |
| 画面共有（音声共有）を拒否／取り消し          | 「相手音声を取り込まない」モードで継続可能。`partner` 側は空のまま   |
| 「音声を共有」OFF で共有開始                  | トースト「音声を共有 ON で再度共有してください」＋ヘルプ動線          |
| macOS デスクトップアプリで音声が取れない      | ヘルプ「Web 版に切替 or 仮想オーディオデバイスを設定」へ誘導          |
| AudioWorklet 未対応ブラウザ                  | エラー画面：「Chrome / Edge 最新版を使用してください」               |
| AmiVoice WebSocket 接続失敗                  | 3 回までリトライ。最終的に失敗したらトーストでユーザ通知              |
| 認識結果が長時間（30s）来ない                | 該当セッションのみ再接続を試みる（もう一方は止めない）                |

## 6. クライアント実装スケッチ

```ts
// lib/amivoice/client.ts（抜粋）

type RecognizerOptions = {
  appKey: string;
  speaker: "self" | "partner";
  stream: MediaStream;
  onPartial: (speaker: "self" | "partner", text: string) => void;
  onFinal: (speaker: "self" | "partner", text: string) => void;
  onError: (speaker: "self" | "partner", e: unknown) => void;
};

async function startRecognizer(opts: RecognizerOptions) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule("/worklets/pcm-worklet.js");
  const src = ctx.createMediaStreamSource(opts.stream);
  const node = new AudioWorkletNode(ctx, "pcm-worklet");
  src.connect(node);

  const ws = new WebSocket("wss://acp-api.amivoice.com/v1/");
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    ws.send(`s 16K LSB16 -a-general authorization=${opts.appKey}`);
  };

  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") return;
    const [tag, ...rest] = ev.data.split(" ");
    const payload = rest.join(" ");
    if (tag === "U") opts.onPartial(opts.speaker, JSON.parse(payload).text ?? "");
    if (tag === "A") opts.onFinal(opts.speaker, JSON.parse(payload).text ?? "");
  };

  ws.onerror = (e) => opts.onError(opts.speaker, e);

  let buffer: Uint8Array[] = [];
  node.port.onmessage = (e) => {
    buffer.push(new Uint8Array(e.data));
    if (buffer.length >= 5 && ws.readyState === WebSocket.OPEN) {
      const totalLen = buffer.reduce((a, b) => a + b.byteLength, 0);
      const payload = new Uint8Array(1 + totalLen);
      payload[0] = 0x70;
      let offset = 1;
      for (const b of buffer) {
        payload.set(b, offset);
        offset += b.byteLength;
      }
      ws.send(payload);
      buffer = [];
    }
  };

  return async () => {
    try { ws.send("e"); } finally {
      node.disconnect();
      src.disconnect();
      await ctx.close();
      opts.stream.getTracks().forEach((t) => t.stop());
      ws.close();
    }
  };
}

// 2 系統まとめて開始するファサード
export async function startDualRecognition(args: {
  appKey: string;
  onPartial: (speaker: "self" | "partner", text: string) => void;
  onFinal: (speaker: "self" | "partner", text: string) => void;
  onError: (speaker: "self" | "partner", e: unknown) => void;
}) {
  // 自分（マイク）
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const stopSelf = await startRecognizer({
    ...args, speaker: "self", stream: micStream,
  });

  // 相手（画面/タブのループバック音声）
  let stopPartner: (() => Promise<void>) | null = null;
  const startPartner = async () => {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: true, audio: true,
    });
    display.getVideoTracks().forEach((t) => t.stop());
    const audioTracks = display.getAudioTracks();
    if (audioTracks.length === 0) {
      throw new Error("相手音声が共有されていません。「音声を共有」をONにしてください。");
    }
    const partnerStream = new MediaStream(audioTracks);
    stopPartner = await startRecognizer({
      ...args, speaker: "partner", stream: partnerStream,
    });
  };

  return {
    startPartner,             // ユーザの明示操作で呼ぶ
    stop: async () => {
      await stopSelf();
      if (stopPartner) await stopPartner();
    },
  };
}
```

実際の AmiVoice プロトコル仕様（パラメータ名・区切り）は最新ドキュメントに従って微調整する。本書は方式の合意を取るためのスケッチである。

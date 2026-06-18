import { diarizerLabelToKey, SELF_KEY } from "@/lib/speakers";

// 音源（どの認識パイプラインか）。話者キー（self / partner-N）とは別概念で、
// ステータス表示（接続中/エラー等）と中間結果の振り分けに使う。
export type Source = "self" | "partner";

export type RecognizerHandlers = {
  // 中間結果（未確定）。ダイアライゼーション前なので音源単位で表示する。
  onPartial: (source: Source, text: string) => void;
  // 確定発話。partner は話者ダイアライゼーション結果に基づく speakerKey が付く。
  onFinal: (source: Source, speakerKey: string, text: string) => void;
  onStatus: (source: Source, status: RecognizerStatus) => void;
  onError: (source: Source, message: string) => void;
};

export type RecognizerStatus = "connecting" | "open" | "closed" | "reconnecting" | "error";

export type RecognizerHandle = {
  source: Source;
  stop: () => Promise<void>;
};

const WS_URL = process.env.NEXT_PUBLIC_AMIVOICE_WS_URL ?? "wss://acp-api.amivoice.com/v1/";
const ENGINE = process.env.NEXT_PUBLIC_AMIVOICE_ENGINE ?? "-a-general";
const APP_KEY = process.env.NEXT_PUBLIC_AMIVOICE_APP_KEY ?? "";

// 話者ダイアライゼーションの感度。
// diarizerAlpha が大きいほど新しい話者が出やすい（実際より話者数が少ないときに上げる: 1e10, 1e20 …）。
// AmiVoice 既定は 1e-10 で新規話者が出にくく 3 人目以降が吸収されやすいため、既定を引き上げる。
// 逆に 1 人が複数に割れてしまう場合は 1e-40, 1e-50 … と下げる。最大 20 話者まで分離可能。
const DIARIZER_ALPHA = process.env.NEXT_PUBLIC_AMIVOICE_DIARIZER_ALPHA ?? "1e0";
const DIARIZER_TRANSITION_BIAS = process.env.NEXT_PUBLIC_AMIVOICE_DIARIZER_TRANSITION_BIAS ?? "";

function parseAmiVoiceEvent(data: string): { tag: string; payload: unknown } | null {
  const trimmed = data.trim();
  if (!trimmed) return null;
  const tag = trimmed.slice(0, 1);
  const rest = trimmed.slice(1).trim();
  if (!rest) return { tag, payload: null };
  try {
    return { tag, payload: JSON.parse(rest) };
  } catch {
    return { tag, payload: rest };
  }
}

type AmiVoiceToken = { written?: string; label?: string };
type AmiVoiceResult = { tokens?: AmiVoiceToken[] };
type AmiVoiceFinal = { text?: string; results?: AmiVoiceResult[] };

// 確定発話（A イベント）の payload からテキストと話者 label を取り出す。
// 1 発話セグメント内に複数 label が混ざる場合は最頻 label を採用する。
function extractFinal(payload: unknown): { text: string; label?: string } {
  const p = (payload ?? {}) as AmiVoiceFinal;
  const text = typeof p.text === "string" ? p.text : "";
  const counts = new Map<string, number>();
  for (const r of p.results ?? []) {
    for (const tk of r.tokens ?? []) {
      const label = tk.label;
      if (typeof label === "string" && /^speaker\d+$/.test(label)) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
  }
  let label: string | undefined;
  let best = 0;
  for (const [k, n] of counts) {
    if (n > best) {
      best = n;
      label = k;
    }
  }
  return { text, label };
}

export async function startRecognizer(
  source: Source,
  stream: MediaStream,
  handlers: RecognizerHandlers,
  opts?: { diarize?: boolean; diarizerAlpha?: string; keepStreamOnStop?: boolean },
): Promise<RecognizerHandle> {
  if (!APP_KEY) {
    throw new Error("AmiVoice APP_KEY (NEXT_PUBLIC_AMIVOICE_APP_KEY) is not configured.");
  }

  const diarize = opts?.diarize ?? false;
  const diarizerAlpha = opts?.diarizerAlpha ?? DIARIZER_ALPHA;
  // 感度の付け替え等で認識だけ貼り直したい場合、stop() でストリーム自体は止めない。
  const keepStreamOnStop = opts?.keepStreamOnStop ?? false;
  const log = (...args: unknown[]) => console.log(`[amivoice/${source}]`, ...args);

  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    await ctx.audioWorklet.addModule("/worklets/pcm-worklet.js");
  } catch (e) {
    await ctx.close().catch(() => {});
    throw new Error(`AudioWorklet を読み込めませんでした: ${(e as Error).message}`);
  }
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-worklet");
  src.connect(node);
  // Note: we intentionally don't connect node to ctx.destination to avoid echo.

  log("connecting", WS_URL, "engine=", ENGINE, "diarize=", diarize);
  handlers.onStatus(source, "connecting");
  const ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer";

  let stopped = false;
  let errored = false;

  ws.addEventListener("open", () => {
    // AmiVoice の "s" コマンド書式:
    //   s <audio_format> <engine> [key=value ...]
    //   audio_format は単一トークン。16kHz/16bit/LE/Signed PCM は "LSB16K"
    // 相手側(partner)はループバック音声に複数人の声が混ざるため、話者ダイアライゼーションを有効化する。
    //   segmenterProperties="useDiarizer=1 diarizerAlpha=…" → 認識結果トークンに speaker0/speaker1 … の label が付く。
    //   値にスペースを含むため AmiVoice の書式に従い二重引用符で囲む。
    let startCmd = `s LSB16K ${ENGINE} authorization=${APP_KEY} resultUpdatedInterval=400`;
    if (diarize) {
      let seg = `useDiarizer=1 diarizerAlpha=${diarizerAlpha}`;
      if (DIARIZER_TRANSITION_BIAS) seg += ` diarizerTransitionBias=${DIARIZER_TRANSITION_BIAS}`;
      startCmd += ` segmenterProperties="${seg}"`;
    }
    log("ws open. sending start command (key redacted):", startCmd.replace(APP_KEY, "***"));
    ws.send(startCmd);
  });

  ws.addEventListener("message", (ev) => {
    if (typeof ev.data !== "string") {
      log("binary message len=", (ev.data as ArrayBuffer).byteLength);
      return;
    }
    log("recv text:", ev.data);
    const parsed = parseAmiVoiceEvent(ev.data);
    if (!parsed) return;
    const { tag, payload } = parsed;
    if (tag === "s") {
      const code = (payload as { code?: string; message?: string } | null)?.code;
      const message = (payload as { code?: string; message?: string } | null)?.message;
      if (code && code !== "") {
        errored = true;
        handlers.onError(source, `AmiVoice 開始エラー: code=${code}${message ? ` ${message}` : ""}`);
        handlers.onStatus(source, "error");
      } else {
        handlers.onStatus(source, "open");
      }
    } else if (tag === "U") {
      const text = (payload as { text?: string } | null)?.text ?? "";
      if (text) handlers.onPartial(source, text);
    } else if (tag === "A") {
      const { text, label } = extractFinal(payload);
      if (text) {
        // self は単一話者。partner はダイアライゼーション label から話者キーを決める。
        const speakerKey = source === "self" ? SELF_KEY : diarizerLabelToKey(label);
        handlers.onFinal(source, speakerKey, text);
      }
    } else if (tag === "e") {
      handlers.onStatus(source, "closed");
    }
  });

  ws.addEventListener("error", (ev) => {
    log("ws error", ev);
    errored = true;
    handlers.onError(source, "AmiVoice WebSocket エラー");
    handlers.onStatus(source, "error");
  });

  ws.addEventListener("close", (ev) => {
    log("ws close. code=", ev.code, "reason=", ev.reason, "wasClean=", ev.wasClean);
    if (!stopped) {
      if (!errored && (ev.code !== 1000 || ev.reason)) {
        handlers.onError(
          source,
          `AmiVoice 切断: code=${ev.code}${ev.reason ? ` reason=${ev.reason}` : ""}`,
        );
        handlers.onStatus(source, "error");
      } else {
        handlers.onStatus(source, errored ? "error" : "closed");
      }
    }
  });

  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const pcm = new Uint8Array(e.data);
    const payload = new Uint8Array(1 + pcm.byteLength);
    payload[0] = 0x70; // 'p'
    payload.set(pcm, 1);
    ws.send(payload);
  };

  return {
    source,
    stop: async () => {
      stopped = true;
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send("e");
      } catch {
        // ignore
      }
      try { node.disconnect(); } catch {}
      try { src.disconnect(); } catch {}
      if (!keepStreamOnStop) {
        try { stream.getTracks().forEach((t) => t.stop()); } catch {}
      }
      try { await ctx.close(); } catch {}
      try { ws.close(); } catch {}
      handlers.onStatus(source, "closed");
    },
  };
}

export async function startMic(handlers: RecognizerHandlers): Promise<RecognizerHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
  return startRecognizer("self", stream, handlers);
}

// 相手音声（システム音声のループバック）の MediaStream を取得する。
// 取得とリコグナイザ開始を分離しているのは、感度(diarizerAlpha)を録音中に変えるとき、
// 画面共有ダイアログを再表示せずに認識だけ貼り直せるようにするため。
export async function acquirePartnerStream(): Promise<MediaStream> {
  // Chrome 仕様: video が必須。取得後に video トラックは即破棄する。
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });
  display.getVideoTracks().forEach((t) => t.stop());
  const audioTracks = display.getAudioTracks();
  if (audioTracks.length === 0) {
    throw new Error(
      "相手音声が共有されていません。タブ または 画面全体 を選び、「音声を共有」を ON にしてください。",
    );
  }
  return new MediaStream(audioTracks);
}

export async function startLoopback(
  handlers: RecognizerHandlers,
  opts?: { diarizerAlpha?: string },
): Promise<RecognizerHandle> {
  const stream = await acquirePartnerStream();
  // 相手側は複数人が混ざるため話者ダイアライゼーションを有効化する。
  return startRecognizer("partner", stream, handlers, {
    diarize: true,
    diarizerAlpha: opts?.diarizerAlpha,
  });
}

export type Speaker = "self" | "partner";

export type RecognizerHandlers = {
  onPartial: (speaker: Speaker, text: string) => void;
  onFinal: (speaker: Speaker, text: string) => void;
  onStatus: (speaker: Speaker, status: RecognizerStatus) => void;
  onError: (speaker: Speaker, message: string) => void;
};

export type RecognizerStatus = "connecting" | "open" | "closed" | "reconnecting" | "error";

export type RecognizerHandle = {
  speaker: Speaker;
  stop: () => Promise<void>;
};

const WS_URL = process.env.NEXT_PUBLIC_AMIVOICE_WS_URL ?? "wss://acp-api.amivoice.com/v1/";
const ENGINE = process.env.NEXT_PUBLIC_AMIVOICE_ENGINE ?? "-a-general";
const APP_KEY = process.env.NEXT_PUBLIC_AMIVOICE_APP_KEY ?? "";

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

export async function startRecognizer(
  speaker: Speaker,
  stream: MediaStream,
  handlers: RecognizerHandlers,
): Promise<RecognizerHandle> {
  if (!APP_KEY) {
    throw new Error("AmiVoice APP_KEY (NEXT_PUBLIC_AMIVOICE_APP_KEY) is not configured.");
  }

  const log = (...args: unknown[]) => console.log(`[amivoice/${speaker}]`, ...args);

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

  log("connecting", WS_URL, "engine=", ENGINE);
  handlers.onStatus(speaker, "connecting");
  const ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer";

  let stopped = false;
  let errored = false;

  ws.addEventListener("open", () => {
    // AmiVoice の "s" コマンド書式:
    //   s <audio_format> <engine> [key=value ...]
    //   audio_format は単一トークン。16kHz/16bit/LE/Signed PCM は "LSB16K"
    const startCmd = `s LSB16K ${ENGINE} authorization=${APP_KEY} resultUpdatedInterval=400`;
    log("ws open. sending start command (key redacted):",
      startCmd.replace(APP_KEY, "***"));
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
        handlers.onError(speaker, `AmiVoice 開始エラー: code=${code}${message ? ` ${message}` : ""}`);
        handlers.onStatus(speaker, "error");
      } else {
        handlers.onStatus(speaker, "open");
      }
    } else if (tag === "U") {
      const text = (payload as { text?: string } | null)?.text ?? "";
      if (text) handlers.onPartial(speaker, text);
    } else if (tag === "A") {
      const text = (payload as { text?: string } | null)?.text ?? "";
      if (text) handlers.onFinal(speaker, text);
    } else if (tag === "e") {
      handlers.onStatus(speaker, "closed");
    }
  });

  ws.addEventListener("error", (ev) => {
    log("ws error", ev);
    errored = true;
    handlers.onError(speaker, "AmiVoice WebSocket エラー");
    handlers.onStatus(speaker, "error");
  });

  ws.addEventListener("close", (ev) => {
    log("ws close. code=", ev.code, "reason=", ev.reason, "wasClean=", ev.wasClean);
    if (!stopped) {
      if (!errored && (ev.code !== 1000 || ev.reason)) {
        handlers.onError(
          speaker,
          `AmiVoice 切断: code=${ev.code}${ev.reason ? ` reason=${ev.reason}` : ""}`,
        );
        handlers.onStatus(speaker, "error");
      } else {
        handlers.onStatus(speaker, errored ? "error" : "closed");
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
    speaker,
    stop: async () => {
      stopped = true;
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send("e");
      } catch {
        // ignore
      }
      try { node.disconnect(); } catch {}
      try { src.disconnect(); } catch {}
      try { stream.getTracks().forEach((t) => t.stop()); } catch {}
      try { await ctx.close(); } catch {}
      try { ws.close(); } catch {}
      handlers.onStatus(speaker, "closed");
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

export async function startLoopback(handlers: RecognizerHandlers): Promise<RecognizerHandle> {
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
  const stream = new MediaStream(audioTracks);
  return startRecognizer("partner", stream, handlers);
}

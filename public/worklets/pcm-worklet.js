// PCM worklet
// Converts Float32 input to 16kHz / 16bit / mono / Little Endian PCM
// and posts batches (~100ms = 5 frames of 20ms) to the main thread.

class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    // sampleRate is the global rate of the AudioContext, available in worklet scope.
    this.ratio = sampleRate / this.targetRate;
    this.phase = 0;
    this.frameSize = 320; // 20ms at 16kHz
    this.framesPerMsg = 5; // 100ms batches
    this.currentFrame = new Int16Array(this.frameSize);
    this.frameIdx = 0;
    this.pendingFrames = [];
  }

  emitSample(sample) {
    const clamped = Math.max(-1, Math.min(1, sample));
    this.currentFrame[this.frameIdx++] = (clamped * 0x7fff) | 0;
    if (this.frameIdx >= this.frameSize) {
      this.pendingFrames.push(this.currentFrame);
      this.currentFrame = new Int16Array(this.frameSize);
      this.frameIdx = 0;
      if (this.pendingFrames.length >= this.framesPerMsg) {
        const total = this.pendingFrames.length * this.frameSize;
        const out = new Int16Array(total);
        let offset = 0;
        for (const f of this.pendingFrames) {
          out.set(f, offset);
          offset += this.frameSize;
        }
        this.port.postMessage(out.buffer, [out.buffer]);
        this.pendingFrames = [];
      }
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];

    if (this.ratio === 1) {
      for (let i = 0; i < ch.length; i++) this.emitSample(ch[i]);
    } else {
      for (let i = 0; i < ch.length; i++) {
        this.phase += 1;
        if (this.phase >= this.ratio) {
          this.phase -= this.ratio;
          this.emitSample(ch[i]);
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-worklet", PcmWorklet);

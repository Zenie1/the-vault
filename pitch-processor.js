// pitch-processor.js — Grain-based pitch shifter for The Vault
// Overlap-add with Hann windowing + linear interpolation resampling.
// pitch ratio = 2^(semitones / 12)
// +12 semitones → ratio 2.0 (octave up)
// -12 semitones → ratio 0.5 (octave down)
//  0 semitones  → ratio 1.0 (pass-through)

const GRAIN_SIZE = 2048;   // samples per grain window
const HOP_SIZE   = 512;    // output hop = GRAIN_SIZE / 4  (4× overlap)

class PitchShifterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const BUF  = GRAIN_SIZE * 16; // ring buffer large enough for look-ahead
    this._BUF  = BUF;
    this._in   = new Float32Array(BUF);
    this._out  = new Float32Array(BUF);
    this._inW  = 0;           // input write head
    this._outW = 0;           // output write head (grain accumulation)
    this._outR = 0;           // output read head (consumer)
    this._hopAccum = 0;       // samples accumulated since last grain trigger
    this._ratio = 1.0;

    // Hann window for smooth grain blending
    this._win = new Float32Array(GRAIN_SIZE);
    for (let i = 0; i < GRAIN_SIZE; i++) {
      this._win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / GRAIN_SIZE));
    }

    this.port.onmessage = e => {
      if (e.data.ratio !== undefined) {
        this._ratio = Math.max(0.25, Math.min(4.0, e.data.ratio));
      }
    };
  }

  process(inputs, outputs) {
    const inp = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!inp || !out) return true;

    const N = inp.length; // normally 128 samples per block

    // --- Write input into ring buffer ---
    for (let i = 0; i < N; i++) {
      this._in[this._inW++ % this._BUF] = inp[i];
    }

    // --- Trigger grain writes as input accumulates ---
    this._hopAccum += N;
    while (this._hopAccum >= HOP_SIZE) {
      this._hopAccum -= HOP_SIZE;
      this._writeGrain();
    }

    // --- Read output (guard startup latency) ---
    if (this._inW < GRAIN_SIZE) {
      // Not enough input buffered yet — output silence
      out.fill(0);
    } else {
      for (let i = 0; i < N; i++) {
        const pos  = this._outR++ % this._BUF;
        out[i]     = this._out[pos];
        this._out[pos] = 0; // zero after reading (clear for next grain overlap)
      }
    }

    // Duplicate mono output to all channels (stereo passthrough)
    for (let c = 1; c < (outputs[0]?.length ?? 0); c++) {
      outputs[0][c].set(out);
    }

    return true;
  }

  // Write one grain to the output accumulation buffer.
  // Reads srcLen = GRAIN_SIZE / ratio input samples and resamples them
  // to GRAIN_SIZE output samples using linear interpolation.
  _writeGrain() {
    const G      = GRAIN_SIZE;
    const BUF    = this._BUF;
    const ratio  = this._ratio;
    const srcLen = G / ratio;                             // input sample count for this grain
    const srcStart = this._inW - Math.ceil(srcLen) - HOP_SIZE; // look-back anchor

    for (let i = 0; i < G; i++) {
      const srcPos = srcStart + (i / G) * srcLen;
      const f      = Math.floor(srcPos);
      const fr     = srcPos - f;
      const s0 = this._in[(f       % BUF + BUF) % BUF];
      const s1 = this._in[((f + 1) % BUF + BUF) % BUF];
      const sample  = (s0 + (s1 - s0) * fr) * this._win[i];
      this._out[(this._outW + i) % BUF] += sample;       // overlap-add
    }
    this._outW += HOP_SIZE;
  }
}

registerProcessor('pitch-shifter', PitchShifterProcessor);

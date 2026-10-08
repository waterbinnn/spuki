// The sample track, played through the console's EQ: the app's filters (Sources/SpukiDSP), rebuilt with
// Web Audio. Nothing loads or makes a sound until someone presses play (browsers allow audio only then).

// --- The track: 16 bars of "Ruthless Grind" by RibhavAgrawal (Pixabay Content License) ---
// The file holds the loop with a second of its own tail before it and its head after it, so the jump from
// LOOP_END back to LOOP_START is seamless however much silence the decoder adds at the very start.
export const TRACK = { title: "Ruthless Grind", artist: "RibhavAgrawal", duration: 42.198 };
const FILE = "sound/ruthless-grind.m4a";
const LOOP_START = 1, LOOP_END = 1 + TRACK.duration;

// --- EQ (Sources/SpukiDSP/EQSettings.swift) ---
const FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const BAND_Q = 1.41, BASS_HZ = 150, TREBLE_HZ = 8000;
const LIMITER_BUDGET_DB = 2, MID_ALLOWANCE_DB = 3, MAX_MAKEUP_DB = 6, TONE_COMPENSATION = 0.5;
const NIGHT_OFFSET_DB = 4;
const PROBES = Array.from({ length: 160 }, (_, i) => 20 * 1000 ** (i / 159));
const FS = 48000;

// Biquad magnitude, RBJ cookbook as in Biquad.swift (shelves at slope 1, the same as Web Audio's).
function biquad(type, f, gainDB, q = 0.7071) {
  if (Math.abs(gainDB) < 0.01) return null;
  const a = 10 ** (gainDB / 40), w0 = (2 * Math.PI * Math.min(f, FS * 0.45)) / FS, c = Math.cos(w0);
  if (type === "peaking") {
    const al = Math.sin(w0) / (2 * q);
    return norm(1 + al * a, -2 * c, 1 - al * a, 1 + al / a, -2 * c, 1 - al / a);
  }
  const k = 2 * Math.sqrt(a) * (Math.sin(w0) / 2) * Math.SQRT2;
  return type === "lowshelf"
    ? norm(a * (a + 1 - (a - 1) * c + k), 2 * a * (a - 1 - (a + 1) * c), a * (a + 1 - (a - 1) * c - k),
      a + 1 + (a - 1) * c + k, -2 * (a - 1 + (a + 1) * c), a + 1 + (a - 1) * c - k)
    : norm(a * (a + 1 + (a - 1) * c + k), -2 * a * (a - 1 + (a + 1) * c), a * (a + 1 + (a - 1) * c - k),
      a + 1 - (a - 1) * c + k, 2 * (a - 1 - (a + 1) * c), a + 1 - (a - 1) * c - k);
}
const norm = (b0, b1, b2, a0, a1, a2) => [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
function magDB([b0, b1, b2, a1, a2], f) {
  const w = (2 * Math.PI * f) / FS, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

// The stages the app runs, as [type, frequency, gain, q]: LOUDNESS's bass shelf, ten bands, its treble shelf,
// then the pasted correction curve's filters.
// (The laptop-speaker variants are left out: a page can't tell what it plays through.)
function stages(st) {
  if (!st.eqOn) return [];
  const quiet = Math.max(0, 1 - st.volume);
  const boost = st.loudness ? [8 * quiet, 5 * quiet] : [0, 0];
  return [
    ["lowshelf", BASS_HZ, boost[0]],
    ...FREQS.map((f, i) => ["peaking", f, st.bands[i], BAND_Q]),
    ["highshelf", TREBLE_HZ, boost[1]],
    ...(st.correction ?? []),
  ];
}
const responseAt = (list, freqs) => {
  const cs = list.map(([t, f, g, q]) => biquad(t, f, g, q)).filter(Boolean);
  return freqs.map((f) => cs.reduce((sum, c) => sum + magDB(c, f), 0));
};
const response = (list) => responseAt(list, PROBES);

// --- Correction curve (Sources/SpukiDSP/Correction.swift) ---
const MAX_FILTERS = 20, SHELF_Q = 0.707;
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

// The whole curve at `freqs`, in dB.
export const correctionResponse = (filters, freqs) => responseAt(filters, freqs);

// A headphone correction read from pasted text, as stages: AutoEq's ParametricEQ.txt and FixedBandEQ.txt
// (Equalizer APO syntax), or any list that names a frequency and a gain per line. Null when no line holds
// a filter. A preamp line is ignored: the automatic gain already makes room for the curve.
export function parseCorrection(text) {
  const num = "(\\d+(?:\\.\\d+)?)", signed = "([+\\-]?\\d+(?:\\.\\d+)?)";
  const hz = new RegExp(`${num}\\s*(k)?hz`, "i"), fc = new RegExp(`\\bfc\\s*:?\\s*${num}`, "i");
  const gainWord = new RegExp(`\\bgain\\s*:?\\s*${signed}`, "i"), decibels = new RegExp(`${signed}\\s*db`, "i");
  const bare = new RegExp(signed), qWord = new RegExp(`\\bq\\s*:?\\s*${num}`, "i");
  const kindWord = /\b(lsc?|lsq|low\s*shelf|hsc?|hsq|high\s*shelf)\b/i;

  const parsed = [], fitted = [];
  for (const line of text.replaceAll("−", "-").split(/\r?\n|\r/)) {
    if (parsed.length >= MAX_FILTERS || /\boff\b/i.test(line)) continue;
    const m = line.match(hz) ?? line.match(fc);
    if (!m) continue;
    const frequency = Number(m[1]) * (m[2] ? 1000 : 1);
    const rest = line.slice(m.index + m[0].length);
    // "LSC 12 dB Fc 100 Hz Gain 3 dB": the number in front of the frequency is a slope, not the gain.
    const gain = Number((line.match(gainWord) ?? rest.match(decibels) ?? rest.match(bare))?.[1] ?? NaN);
    if (Number.isNaN(gain) || frequency < 10 || frequency > 22000) continue;
    const word = line.match(kindWord)?.[1].toLowerCase();
    const type = !word ? "peaking" : word.startsWith("l") ? "lowshelf" : "highshelf";
    const q = line.match(qWord)?.[1];
    if (q === undefined && type === "peaking") fitted.push(parsed.length);
    parsed.push([type, frequency, clamp(gain, -24, 24), clamp(q === undefined ? SHELF_Q : Number(q), 0.1, 20)]);
  }
  if (!parsed.length) return null;

  // A list without Q ("70 Hz: +4.0 dB") gives points on a curve, not filters. Each point becomes a bell
  // as wide as the gap to its neighbours, and since neighbouring bells add up, the gains are then adjusted
  // until the curve passes through the points.
  const points = fitted.sort((a, b) => parsed[a][1] - parsed[b][1]);
  points.forEach((i, n) => {
    const f = parsed[i][1], gaps = [];
    if (n > 0) gaps.push(Math.log2(f / parsed[points[n - 1]][1]));
    if (n < points.length - 1) gaps.push(Math.log2(parsed[points[n + 1]][1] / f));
    const octaves = clamp(gaps.length ? gaps.reduce((a, b) => a + b) / gaps.length : 1, 0.3, 2);
    parsed[i][3] = Math.sqrt(2 ** octaves) / (2 ** octaves - 1);
  });
  const frequencies = points.map((i) => parsed[i][1]), targets = points.map((i) => parsed[i][2]);
  for (let k = 0; k < 12 && points.length; k++) {
    const now = responseAt(parsed, frequencies);
    points.forEach((i, n) => (parsed[i][2] = clamp(parsed[i][2] + 0.7 * (targets[n] - now[n]), -24, 24)));
  }
  return parsed;
}

function musicSpectrumDB(f) {
  const o = Math.log2(f / 250);
  if (o < -3) return 5 + 8 * (o + 3);
  if (o < -2) return 5 + 2 * (o + 3);
  if (o < -1) return 7 - 3 * (o + 2);
  if (o < 0) return 4 - 4 * (o + 1);
  return -3.5 * o;
}
// The 40-phon contour the app uses on a laptop's speaker: what most visitors here listen through.
const QUIET_EAR = [[20, -50], [31.5, -39], [63, -24], [125, -12], [250, -5], [500, -1.5], [1000, 0],
  [2000, 1], [3150, 3.5], [4000, 3], [6300, -2], [8000, -6], [12500, -8], [20000, -15]];
function earDB(f) {
  if (f <= QUIET_EAR[0][0]) return QUIET_EAR[0][1];
  for (let i = 1; i < QUIET_EAR.length; i++) {
    const [fa, da] = QUIET_EAR[i - 1], [fb, db] = QUIET_EAR[i];
    if (f <= fb) return da + ((db - da) * Math.log2(f / fa)) / Math.log2(fb / fa);
  }
  return QUIET_EAR.at(-1)[1];
}
function musicWeightDB(f) {
  const mids = Math.max(-MID_ALLOWANCE_DB, Math.min(0, (musicSpectrumDB(f) - 7) / 2));
  return f <= 2000 ? mids : mids - 4 * Math.log2(f / 2000);
}
function loudnessChangeDB(resp) {
  let num = 0, den = 0;
  PROBES.forEach((f, i) => {
    const w = 10 ** ((musicSpectrumDB(f) + earDB(f)) / 10);
    // As the app does on a laptop speaker: changes under 250 Hz don't count as louder or quieter. Counted,
    // BASS BOOST took the mids down 6 dB to pay for lows a laptop or phone barely plays, and sounded quieter.
    num += w * 10 ** ((f < 250 ? 0 : resp[i]) / 10);
    den += w;
  });
  return 10 * Math.log10(num / den);
}

// autoGainDB: every setting plays about as loud as the original, so a mode changes the tone, not the volume.
// `headroomDB` is the track's own room below full scale; the volume knob turned down adds to it, since the
// limiter comes after the knob (above 100% it adds nothing, as in the app).
function autoGainDB(st, headroomDB) {
  headroomDB += Math.max(0, -40 * Math.log10(Math.max(st.volume, 0.01)));
  if (!st.eqOn) return 0;
  const full = response(stages(st));
  const peak = Math.max(...PROBES.map((f, i) => musicWeightDB(f) + full[i]));
  const curve = loudnessChangeDB(response(stages({ ...st, loudness: false })));
  const loud = curve + TONE_COMPENSATION * (loudnessChangeDB(full) - curve);
  return Math.max(loud, peak - LIMITER_BUDGET_DB - headroomDB, -MAX_MAKEUP_DB);
}

export function createSound() {
  let ctx = null, buffer = null, source = null;
  let startedAt = 0, offset = 0;       // where in the loop playback started, and when
  let nodes = null, headroomDB = 0, state = null, freq = null;

  function build() {
    ctx = new AudioContext();
    const preamp = ctx.createGain();
    const filters = Array.from({ length: 12 + MAX_FILTERS }, () => ctx.createBiquadFilter());
    // NIGHT: evened out and 4 dB quieter (the app's own two-speed leveller, approximated).
    const night = ctx.createDynamicsCompressor();
    night.threshold.value = -30; night.knee.value = 12; night.ratio.value = 3;
    night.attack.value = 0.01; night.release.value = 0.3;
    const nightTrim = ctx.createGain();
    nightTrim.gain.value = 10 ** (-NIGHT_OFFSET_DB / 20);
    const volume = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.002; limiter.release.value = 0.08;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.6;
    preamp.connect(filters[0]);
    filters.reduce((a, b) => (a.connect(b), b));
    volume.connect(limiter).connect(analyser).connect(ctx.destination);
    night.connect(nightTrim);
    nodes = { preamp, filters, night, nightTrim, volume, analyser, nightOn: null };
    freq = new Float32Array(analyser.frequencyBinCount);
  }

  async function load() {
    const data = await fetch(FILE).then((r) => r.arrayBuffer());
    buffer = await ctx.decodeAudioData(data);
    // How far below full scale the track peaks: room boosts can use before any gain is taken away.
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    }
    headroomDB = Math.min(12, Math.max(0, -20 * Math.log10(peak || 1)));
  }

  // Apply the console's state: filters, automatic gain, NIGHT, volume, and play / pause.
  function apply() {
    if (!nodes || !state) return;
    const now = ctx.currentTime, glide = 0.03;
    const list = stages(state);
    nodes.filters.forEach((n, i) => {
      const [type, f, g, q] = list[i] ?? ["peaking", 1000, 0, 1];
      n.type = type;
      n.frequency.value = f;
      if (q) n.Q.value = q;
      n.gain.setTargetAtTime(g, now, glide);
    });
    nodes.preamp.gain.setTargetAtTime(10 ** (-autoGainDB(state, headroomDB) / 20), now, glide);
    nodes.volume.gain.setTargetAtTime(state.powered ? state.volume ** 2 : 0, now, glide);
    if (nodes.nightOn !== state.night) {
      const last = nodes.filters.at(-1);
      last.disconnect();
      nodes.nightTrim.disconnect();
      if (state.night) { last.connect(nodes.night); nodes.nightTrim.connect(nodes.volume); }
      else last.connect(nodes.volume);
      nodes.nightOn = state.night;
    }
    if (state.playing && buffer && !source) start();
    if (!state.playing && source) stop();
  }

  function start() {
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = LOOP_START;
    source.loopEnd = LOOP_END;
    source.connect(nodes.preamp);
    source.start(0, LOOP_START + offset);
    startedAt = ctx.currentTime - offset;
  }
  function stop() {
    offset = position();
    source.stop();
    source.disconnect();
    source = null;
  }
  function position() {
    if (!source) return offset;
    return (ctx.currentTime - startedAt) % TRACK.duration;
  }

  return {
    // Called on every console change; the first play also creates the audio and fetches the file.
    set(st) {
      state = st;
      if (st.playing && !ctx) {
        build();
        // Offline or blocked: drop it all, so the next press tries again.
        load().then(apply, () => { ctx.close(); ctx = null; nodes = null; });
      }
      if (ctx?.state === "suspended" && st.playing) ctx.resume();
      apply();
    },
    seek(t) {
      offset = t;
      if (source) { source.stop(); source.disconnect(); source = null; apply(); }
    },
    get position() { return position(); },
    get active() { return !!source; },
    // Levels (0…1) in `n` columns spaced by octave, 40 Hz to 16 kHz, for the console's spectrum.
    levels(n) {
      if (!source) return null;
      nodes.analyser.getFloatFrequencyData(freq);
      const bin = (f) => Math.round((f / ctx.sampleRate) * nodes.analyser.fftSize);
      return Array.from({ length: n }, (_, c) => {
        const lo = bin(40 * 400 ** (c / n)), hi = Math.max(lo + 1, bin(40 * 400 ** ((c + 1) / n)));
        let p = -Infinity;
        for (let i = lo; i < hi; i++) p = Math.max(p, freq[i]);
        // Higher octaves hold less energy (about 4 dB less each): tilt them up so the display reads evenly,
        // then -75 dB is empty and -25 dB full.
        return Math.min(1, Math.max(0, (p + 4 * Math.log2(400 ** (c / n)) + 75) / 50));
      });
    },
    // How hard the kick is hitting (40–150 Hz), in dB, for the woofer.
    lows() {
      if (!source) return -100;
      nodes.analyser.getFloatFrequencyData(freq);
      const bin = (f) => Math.round((f / ctx.sampleRate) * nodes.analyser.fftSize);
      let p = 0;
      for (let i = bin(40); i <= bin(150); i++) p += 10 ** (freq[i] / 10);
      return 10 * Math.log10(p + 1e-12);
    },
  };
}

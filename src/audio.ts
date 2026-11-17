import type { Object3D, Vector3 } from '@iwsdk/core';

// Every sound in the game is synthesized here with Web Audio: no samples,
// so nothing to license and nothing to download. Three layers:
//
// - Music: a generative Japanese ambience. A low drone and wind under a
//   breathy pan flute that wanders the miyako-bushi scale, with sparse
//   koto-like plucks; taiko joins for the samurai and quickens as his
//   timer runs down.
// - Ninjas: they arrive as whispers, positioned where they leave the
//   bamboo, and breathe a sharp "hah" as they leap.
// - The samurai: a growling, distorted anime-style voice: a roaring kiai
//   on entrance, grunts when hit, a rising bellow on the windup.
//
// Spatial sounds go through HRTF panners and the listener follows the head.

const MUSIC_LEVEL = 0.32;
const SFX_LEVEL = 0.9;
/** Scheduling look-ahead for music, seconds. */
const LOOKAHEAD = 0.25;
/** D miyako-bushi (D Eb G A Bb) across two octaves, as MIDI notes. */
const SCALE = [62, 63, 67, 69, 70, 74, 75, 79, 81, 82];
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

type Vowel = 'a' | 'o' | 'u' | 'e';
const FORMANTS: Record<Vowel, [number, number, number]> = {
  a: [800, 1200, 2600],
  o: [500, 850, 2500],
  u: [350, 700, 2400],
  e: [500, 1800, 2600],
};

export class SoundScape {
  private ctx?: AudioContext;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private growl!: WaveShaperNode['curve'];
  private musicOn = false;
  private nextFlute = 0;
  private nextPluck = 0;
  private nextTaiko = 0;
  private fluteNote = 3;
  private wind?: { gain: GainNode; filter: BiquadFilterNode };
  private drone?: GainNode;
  /** 0 = calm ambience, 1 = samurai fight. */
  private tension = 0;
  /** Seconds between taiko hits during the fight. */
  private taikoGap = 1.4;

  /** Create or resume the context; call from any user gesture. */
  unlock(): void {
    if (this.ctx == null) {
      try {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.build(this.ctx);
      if (import.meta.env.DEV) {
        const ctx = this.ctx;
        ctx.addEventListener('statechange', () => console.info(`[audio] ${ctx.state}`));
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean {
    return this.ctx != null && this.ctx.state === 'running';
  }

  /** Keep the listener on the player's head; call every frame. */
  updateListener(head: Object3D): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    const e = head.matrixWorld.elements;
    const l = ctx.listener;
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(e[12], t, 0.02);
      l.positionY.setTargetAtTime(e[13], t, 0.02);
      l.positionZ.setTargetAtTime(e[14], t, 0.02);
      l.forwardX.setTargetAtTime(-e[8], t, 0.02);
      l.forwardY.setTargetAtTime(-e[9], t, 0.02);
      l.forwardZ.setTargetAtTime(-e[10], t, 0.02);
      l.upX.setTargetAtTime(e[4], t, 0.02);
      l.upY.setTargetAtTime(e[5], t, 0.02);
      l.upZ.setTargetAtTime(e[6], t, 0.02);
    } else {
      l.setPosition(e[12], e[13], e[14]);
      l.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }

  // ---------------------------------------------------------------- music

  setMusic(on: boolean): void {
    const ctx = this.ctx;
    if (ctx == null || on === this.musicOn) return;
    this.musicOn = on;
    const t = ctx.currentTime;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setTargetAtTime(on ? MUSIC_LEVEL : 0, t, on ? 1.2 : 0.6);
    if (on) {
      this.nextFlute = Math.max(this.nextFlute, t + 1.5);
      this.nextPluck = Math.max(this.nextPluck, t + 3);
    }
  }

  /** 0 = ambience; 1 = the samurai fight; `urgency` 0–1 speeds the drums. */
  setTension(tension: number, urgency = 0): void {
    this.tension = tension;
    this.taikoGap = 1.4 - urgency * 0.9;
    const ctx = this.ctx;
    if (ctx == null || this.drone == null || this.wind == null) return;
    // The bed darkens and the wind rises while he circles.
    this.drone.gain.setTargetAtTime(0.05 + tension * 0.05, ctx.currentTime, 0.8);
    this.wind.gain.gain.setTargetAtTime(0.12 + tension * 0.08, ctx.currentTime, 0.8);
    this.wind.filter.Q.setTargetAtTime(0.7 + tension * 1.5, ctx.currentTime, 0.8);
  }

  /** Schedule upcoming notes; call every frame. */
  tick(): void {
    const ctx = this.ctx;
    if (ctx == null || !this.musicOn) return;
    const horizon = ctx.currentTime + LOOKAHEAD;
    while (this.nextFlute < horizon) this.scheduleFlute();
    while (this.nextPluck < horizon) this.schedulePluck();
    if (this.tension > 0.5) {
      if (this.nextTaiko < ctx.currentTime) this.nextTaiko = ctx.currentTime + 0.05;
      while (this.nextTaiko < horizon) {
        this.taiko(this.nextTaiko, 0.55, this.music);
        this.nextTaiko += this.taikoGap;
      }
    }
  }

  private scheduleFlute(): void {
    // A short phrase: wander a step or two along the scale, slide into each note.
    const steps = [-2, -1, -1, 1, 1, 2, 0];
    let t = this.nextFlute;
    const phraseLength = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < phraseLength; i++) {
      this.fluteNote = Math.min(SCALE.length - 1, Math.max(0, this.fluteNote + steps[Math.floor(Math.random() * steps.length)]));
      const length = 0.7 + Math.random() * 1.6;
      this.flute(t, midi(SCALE[this.fluteNote]), length);
      t += length * (0.85 + Math.random() * 0.2);
    }
    // Rest between phrases; shorter and tenser during the fight.
    this.nextFlute = t + (this.tension > 0.5 ? 1 : 2.5) + Math.random() * 3;
  }

  private schedulePluck(): void {
    const t = this.nextPluck;
    const root = SCALE[Math.floor(Math.random() * 5)] - 12;
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      this.pluck(t + i * 0.18, midi(root + [0, 5, 7, 12][i % 4]), 0.18);
    }
    this.nextPluck = t + 4 + Math.random() * 6;
  }

  /** A breathy pan flute: sine body, noise breath, vibrato that blooms late. */
  private flute(t: number, freq: number, length: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    // Slide up into the note from just below, like a bent shakuhachi attack.
    osc.frequency.setValueAtTime(freq * 0.955, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.12);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibDepth = ctx.createGain();
    vibDepth.gain.setValueAtTime(0, t);
    vibDepth.gain.linearRampToValueAtTime(freq * 0.012, t + length * 0.8);
    vib.connect(vibDepth).connect(osc.frequency);
    const body = ctx.createGain();
    body.gain.setValueAtTime(0, t);
    body.gain.linearRampToValueAtTime(0.16, t + 0.09);
    body.gain.setTargetAtTime(0.11, t + 0.1, 0.3);
    body.gain.setTargetAtTime(0, t + length - 0.15, 0.12);
    osc.connect(body).connect(this.music);

    // The breath: band-passed noise riding on the note, loudest at the chiff.
    const breath = this.noiseSource(t, length + 0.4);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = freq * 2;
    band.Q.value = 1.2;
    const air = ctx.createGain();
    air.gain.setValueAtTime(0, t);
    air.gain.linearRampToValueAtTime(0.09, t + 0.03);
    air.gain.setTargetAtTime(0.025, t + 0.05, 0.08);
    air.gain.setTargetAtTime(0, t + length - 0.15, 0.1);
    breath.connect(band).connect(air).connect(this.music);

    for (const o of [osc, vib]) {
      o.start(t);
      o.stop(t + length + 0.4);
    }
  }

  /** A soft koto-like pluck. */
  private pluck(t: number, freq: number, level: number, out: AudioNode = this.music): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.setValueAtTime(freq * 8, t);
    tone.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 1.6);
    osc.connect(tone).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 1.7);
  }

  private taiko(t: number, level: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.75);
    // The skin slap.
    const slap = this.noiseSource(t, 0.08);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(level * 0.6, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    slap.connect(lp).connect(sg).connect(out);
  }

  // ---------------------------------------------------------- sound effects

  /** Two drum hits under the wave banner. */
  banner(boss: boolean): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    const t = ctx.currentTime + 0.02;
    this.taiko(t, 0.8, this.sfx);
    this.taiko(t + 0.32, boss ? 1 : 0.65, this.sfx);
    if (boss) this.gong(t + 0.32, 0.35);
  }

  /** The star leaves the hand: a quick breathy whoosh. */
  throwStar(): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    const t = ctx.currentTime;
    const src = this.noiseSource(t, 0.25);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(700, t);
    band.frequency.exponentialRampToValueAtTime(3200, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(band).connect(g).connect(this.sfx);
  }

  /** A ninja slips out of the bamboo: a whisper from that direction. */
  whisper(at: Vector3): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    const t = ctx.currentTime;
    const out = this.panner(at, 6);
    const length = 0.9 + Math.random() * 0.4;
    const src = this.noiseSource(t, length + 0.2);
    // "Sss" sliding into "hhh": a high hiss band, then a breathy mid band.
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'bandpass';
    hiss.Q.value = 2;
    hiss.frequency.setValueAtTime(6500, t);
    hiss.frequency.exponentialRampToValueAtTime(2200, t + length);
    const formant = ctx.createBiquadFilter();
    formant.type = 'peaking';
    formant.frequency.value = 1300;
    formant.gain.value = 8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + length * 0.35);
    g.gain.linearRampToValueAtTime(0.32, t + length * 0.7);
    g.gain.linearRampToValueAtTime(0, t + length);
    // A flutter, like breath through a mask.
    const flutter = ctx.createOscillator();
    flutter.frequency.value = 7 + Math.random() * 4;
    const depth = ctx.createGain();
    depth.gain.value = 0.12;
    flutter.connect(depth).connect(g.gain);
    flutter.start(t);
    flutter.stop(t + length);
    src.connect(hiss).connect(formant).connect(g).connect(out);
  }

  /** The leap: a sharp exhaled "hah!" from the ninja. */
  leap(at: Vector3): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    const t = ctx.currentTime;
    const out = this.panner(at, 2);
    const src = this.noiseSource(t, 0.35);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 900;
    f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1500;
    f2.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.1, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(f1).connect(g);
    src.connect(f2).connect(g);
    g.connect(out);
  }

  /** A star lands and the ninja burns away: a wooden thock, then a soft fwoomp. */
  ninjaDefeated(at: Vector3): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    const t = ctx.currentTime;
    const out = this.panner(at, 4);
    this.thock(t, out, 1);
    const src = this.noiseSource(t + 0.03, 0.7);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(2400, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(lp).connect(g).connect(out);
  }

  /** A star bites into the samurai's armour. */
  armorHit(at: Vector3): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    const t = ctx.currentTime;
    const out = this.panner(at, 4);
    this.thock(t, out, 0.8);
    // A short metallic ring.
    for (const f of [1840, 2710, 3920]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.35);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.4);
    }
  }

  /** A ninja got through: a heavy body blow. */
  playerHit(): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.45);
    const src = this.noiseSource(t, 0.15);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.6, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    src.connect(lp).connect(ng).connect(this.sfx);
  }

  /** Reverse lightning tearing upward: crackle over a low rumble. */
  lightning(at: Vector3, strength = 1, delay = 0): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    const t = ctx.currentTime + delay;
    const out = this.panner(at, 5);
    const length = 0.5 + strength * 0.4;
    const src = this.noiseSource(t, length);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const g = ctx.createGain();
    // Crackle: a burst of random gates.
    g.gain.setValueAtTime(0, t);
    let s = t;
    while (s < t + length) {
      g.gain.setValueAtTime((0.2 + Math.random() * 0.5) * strength * (1 - (s - t) / length), s);
      s += 0.012 + Math.random() * 0.03;
      g.gain.setValueAtTime(0, s);
      s += Math.random() * 0.02;
    }
    src.connect(hp).connect(g).connect(out);
    const rumble = this.noiseSource(t, length + 0.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.9 * strength, t);
    rg.gain.exponentialRampToValueAtTime(0.001, t + length + 0.6);
    rumble.connect(lp).connect(rg).connect(out);
  }

  /** The combo multiplier steps up: a bright pentatonic ping. */
  comboUp(level: number): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    const t = ctx.currentTime;
    this.pluck(t, midi(SCALE[4 + Math.min(level, 5)] + 12), 0.25, this.sfx);
    this.pluck(t + 0.07, midi(SCALE[4 + Math.min(level, 5)] + 24), 0.12, this.sfx);
  }

  /** The combo is broken: a dull wooden knock. */
  comboLost(): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    this.thock(ctx.currentTime, this.sfx, 0.5, 260);
  }

  /** Menu buttons. */
  click(): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    this.thock(ctx.currentTime, this.sfx, 0.6, 900);
  }

  gameOver(): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    const t = ctx.currentTime;
    this.gong(t, 0.6);
    // A falling flute sigh.
    this.flute(t + 0.4, midi(74), 1.2);
    this.flute(t + 1.4, midi(69), 1.4);
    this.flute(t + 2.6, midi(62), 2.2);
  }

  // ------------------------------------------------------ the samurai voice

  /** Entrance: a long rising roar. */
  samuraiRoar(at: Object3D): void {
    this.voice(at, [[0, 120], [0.25, 150], [1.1, 210], [1.5, 180]], 'a', 1.6, 1);
  }

  /** Stung by a star: a short angry grunt, a little different each time. */
  samuraiGrunt(at: Object3D): void {
    const p = 130 + Math.random() * 40;
    const vowel: Vowel = Math.random() < 0.5 ? 'u' : 'o';
    this.voice(at, [[0, p * 1.2], [0.08, p], [0.3, p * 0.75]], vowel, 0.32, 0.8);
  }

  /** The windup: a bellow building to the cut. */
  samuraiWindup(at: Object3D): void {
    this.voice(at, [[0, 100], [0.9, 150], [1.35, 230]], 'o', 1.4, 0.9, 'a');
  }

  /** The cut: "HA!" and a blade through the air. */
  samuraiStrike(at: Object3D): void {
    this.voice(at, [[0, 240], [0.2, 190]], 'a', 0.3, 1.1);
    const ctx = this.ctx;
    if (ctx == null) return;
    const t = ctx.currentTime;
    const src = this.noiseSource(t, 0.35);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 6;
    band.frequency.setValueAtTime(4500, t);
    band.frequency.exponentialRampToValueAtTime(900, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    src.connect(band).connect(g).connect(this.sfx);
  }

  /** Death: a long falling cry under the lightning. */
  samuraiDeath(at: Object3D): void {
    this.voice(at, [[0, 220], [0.4, 200], [1.6, 90]], 'a', 1.8, 1, 'o');
  }

  /**
   * A growled vowel: a buzzy glottal source with jitter, shaped by three
   * formants and driven through a soft-clipping waveshaper for the rasp.
   */
  private voice(
    at: Object3D,
    pitch: Array<[number, number]>,
    vowel: Vowel,
    length: number,
    level: number,
    toVowel?: Vowel,
  ): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    const t = ctx.currentTime;
    const out = this.panner(at.position, 3);
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    for (const [dt, f] of pitch) {
      if (dt === 0) src.frequency.setValueAtTime(f, t);
      else src.frequency.linearRampToValueAtTime(f, t + dt);
    }
    // Roughness: a fast irregular wobble on the pitch.
    const rough = ctx.createOscillator();
    rough.type = 'square';
    rough.frequency.value = 31;
    const roughDepth = ctx.createGain();
    roughDepth.gain.value = 9;
    rough.connect(roughDepth).connect(src.frequency);

    const drive = ctx.createWaveShaper();
    drive.curve = this.growl;
    drive.oversample = '2x';
    const pre = ctx.createGain();
    pre.gain.value = 3;
    src.connect(pre).connect(drive);

    const sum = ctx.createGain();
    const [a1, a2, a3] = FORMANTS[vowel];
    const to = toVowel ? FORMANTS[toVowel] : null;
    const formants: Array<[number, number, number]> = [[a1, 1, to ? to[0] : a1], [a2, 0.6, to ? to[1] : a2], [a3, 0.25, to ? to[2] : a3]];
    for (const [f, g, fTo] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 6;
      bp.frequency.setValueAtTime(f, t);
      if (fTo !== f) bp.frequency.linearRampToValueAtTime(fTo, t + length);
      const fg = ctx.createGain();
      fg.gain.value = g;
      drive.connect(bp).connect(fg).connect(sum);
    }
    // Breath under the voice.
    const breath = this.noiseSource(t, length);
    const bb = ctx.createBiquadFilter();
    bb.type = 'bandpass';
    bb.frequency.value = a2;
    bb.Q.value = 1;
    const bg = ctx.createGain();
    bg.gain.value = 0.25;
    breath.connect(bb).connect(bg).connect(sum);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.04);
    env.gain.setValueAtTime(level, t + length * 0.75);
    env.gain.linearRampToValueAtTime(0, t + length);
    sum.connect(env).connect(out);
    for (const o of [src, rough]) {
      o.start(t);
      o.stop(t + length + 0.05);
    }
  }

  // ------------------------------------------------------------- plumbing

  private build(ctx: AudioContext): void {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(compressor).connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = 0;
    this.music.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = SFX_LEVEL;
    this.sfx.connect(this.master);

    const length = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.5);
    }
    this.growl = curve;

    // Always-on bed: a soft drone and the wind through the bamboo.
    this.drone = ctx.createGain();
    this.drone.gain.value = 0.05;
    this.drone.connect(this.music);
    for (const [f, detune] of [[midi(38), 0], [midi(45), 4], [midi(50), -3]] as const) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(this.drone);
      o.start();
    }
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 500;
    filter.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 300;
    lfo.connect(lfoDepth).connect(filter.frequency);
    const gain = ctx.createGain();
    gain.gain.value = 0.12;
    wind.connect(filter).connect(gain).connect(this.music);
    wind.start();
    lfo.start();
    this.wind = { gain, filter };
  }

  private noiseSource(t: number, length: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.start(t, Math.random() * 1.5, length);
    return src;
  }

  /** An HRTF panner at `at`, heard clearly out to `refDistance` meters. */
  private panner(at: Vector3, refDistance: number): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.rolloffFactor = 0.8;
    if (p.positionX) {
      p.positionX.value = at.x;
      p.positionY.value = at.y;
      p.positionZ.value = at.z;
    } else {
      p.setPosition(at.x, at.y, at.z);
    }
    p.connect(this.sfx);
    return p;
  }

  private thock(t: number, out: AudioNode, level: number, freq = 620): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.03);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.14);
    const src = this.noiseSource(t, 0.04);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.4 * level, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(bp).connect(ng).connect(out);
  }

  private gong(t: number, level: number): void {
    const ctx = this.ctx!;
    for (const [f, a] of [[98, 1], [147.5, 0.5], [211, 0.35], [302, 0.2]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level * a * 0.4, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 4);
      o.connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + 4.1);
    }
  }
}

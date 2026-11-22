// Optional short "tick" on taps (iOS has no vibration API). Web Audio is
// created lazily inside a tap, which iOS requires. Note: the iPhone's silent
// switch mutes it.
let ctx: AudioContext | null = null;

export function tick() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1700;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  } catch {
    // Audio is a nicety; never let it break a tap.
  }
}

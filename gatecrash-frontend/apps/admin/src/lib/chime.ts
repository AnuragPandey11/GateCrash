/**
 * Short alert tones, synthesised with WebAudio so no sound files ship with the app.
 *
 * A browser only plays sound after the page has had a user gesture, which on a gate console or a
 * resident's open tab is always true by the time an alert arrives. If it is not, `play` fails
 * silently: the visual alert is the one that must always work, the sound is a courtesy.
 */

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context ??= new Ctor();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

function tone(ctx: AudioContext, frequency: number, start: number, duration: number, volume: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.05);
}

/** `doorbell`: someone is at the gate for you. `alarm`: an overstay — insistent, three pulses. */
export function play(kind: 'doorbell' | 'alarm'): void {
  const ctx = audio();
  if (!ctx) return;
  try {
    if (kind === 'doorbell') {
      tone(ctx, 880, 0, 0.35, 0.25);
      tone(ctx, 660, 0.3, 0.5, 0.22);
    } else {
      for (let i = 0; i < 3; i += 1) tone(ctx, 990, i * 0.28, 0.2, 0.3);
    }
  } catch {
    // No sound is acceptable; a thrown error in a socket handler is not.
  }
}

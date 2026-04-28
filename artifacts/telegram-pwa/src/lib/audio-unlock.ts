/**
 * Shared, pre-warmed AudioContext.
 *
 * Mobile browsers (especially iOS Safari and Android Chrome) require an
 * AudioContext to be created and `resume()`-d during a user gesture before
 * it can produce sound. If we wait until an incoming call arrives to create
 * one, it stays in `suspended` state and the ringtone is silent.
 *
 * To work around that, we create a single context at module load and attach
 * a one-shot listener for the very first user interaction (click / touch /
 * keypress) anywhere on the page. That gesture flips the context into
 * `running` state and plays a 1-sample silent buffer to fully "unlock" it
 * (an iOS-specific quirk). After that, any subsequent `oscillator.start()`
 * — including the ringtone played asynchronously when a `call_offer` socket
 * event arrives — will produce real sound.
 */

let sharedCtx: AudioContext | null = null;
let unlocked = false;

function getCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (window as any).AudioContext || (window as any).webkitAudioContext || null;
}

export function getSharedAudioContext(): AudioContext | null {
  if (sharedCtx) return sharedCtx;
  const Ctor = getCtor();
  if (!Ctor) return null;
  try { sharedCtx = new Ctor(); } catch { sharedCtx = null; }
  return sharedCtx;
}

export function unlockAudio(): void {
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  if (unlocked) return;
  unlocked = true;
  try {
    // Silent 1-sample buffer — required to fully unlock audio on iOS Safari.
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    /* no-op */
  }
}

// Attach the unlock to the FIRST user gesture, then remove the listeners.
if (typeof window !== 'undefined') {
  const onFirstGesture = () => {
    unlockAudio();
    window.removeEventListener('click', onFirstGesture, true);
    window.removeEventListener('touchstart', onFirstGesture, true);
    window.removeEventListener('keydown', onFirstGesture, true);
  };
  window.addEventListener('click', onFirstGesture, true);
  window.addEventListener('touchstart', onFirstGesture, true);
  window.addEventListener('keydown', onFirstGesture, true);
}

/** A phone or tablet. A desktop mouse stays on the keyboard path. */
export function prefersTouch(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse || (navigator.maxTouchPoints ?? 0) > 0;
}

export function portraitNow(): boolean {
  return window.innerHeight > window.innerWidth;
}

/**
 * Ask for landscape after a user gesture. Fullscreen first, because several
 * browsers only allow orientation.lock from a fullscreen document. Failure
 * leaves the rotate overlay in place.
 */
export async function lockLandscape(): Promise<void> {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen();
  } catch {
    /* dismissed, or unsupported */
  }
  const ori = screen.orientation as ScreenOrientation & { lock?: (mode: string) => Promise<void> };
  if (!ori?.lock) return;
  try {
    await ori.lock('landscape');
  } catch {
    /* the overlay covers portrait */
  }
}

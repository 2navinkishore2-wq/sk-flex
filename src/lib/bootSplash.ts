/**
 * Five-second branded cold-launch intro.
 *
 * The first frame is static HTML/CSS in index.html (#boot-splash), so the SK
 * logo paints before React, before the stylesheet bundle and without any
 * network request. This module only handles the exit: it always keeps the
 * intro on screen for the full five seconds (even when auth/data is ready
 * sooner) and then fades it out. If initialization is still running when the
 * intro ends, the app shows its real loading state.
 */

export const INTRO_DURATION_MS = 5000;
const EXIT_FADE_MS = 620;

let startedAt = 0;
let finished = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function introDurationMs(): number {
  return INTRO_DURATION_MS;
}

/** Mark the moment the intro started (called once, as early as possible). */
export function markIntroStart(now = Date.now()): void {
  if (!startedAt) startedAt = now;
}

function removeEl(el: HTMLElement) {
  el.style.display = 'none';
  if (el.parentNode) el.parentNode.removeChild(el);
  document.documentElement.classList.remove('boot-active');
}

/**
 * Keep the intro up for the remainder of five seconds, then fade out and
 * remove it. Safe to call more than once.
 */
export function finishIntro(): void {
  if (finished || typeof document === 'undefined') return;
  finished = true;
  const el = document.getElementById('boot-splash');
  if (!el) {
    document.documentElement.classList.remove('boot-active');
    return;
  }
  const elapsed = startedAt ? Date.now() - startedAt : INTRO_DURATION_MS;
  const remaining = Math.max(0, INTRO_DURATION_MS - elapsed);
  timer = setTimeout(() => {
    el.classList.add('boot-exit');
    setTimeout(() => removeEl(el), EXIT_FADE_MS);
  }, remaining);
}

/** Test/teardown helper. */
export function resetIntroForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  startedAt = 0;
  finished = false;
}

import type { MarketSession } from '../../data/session';
import { nextBucketStart } from '../../data/periods';
import { createReplayControls } from './controls';

interface ReplayControllerOptions {
  session: MarketSession;
  container: HTMLElement;
  trigger: HTMLButtonElement;
  cancelNavigation(): void;
  selectPointer(): void;
  onChange(): void;
  refreshSelects(): void;
}

/** Owns replay interaction state; the data session owns playback and its clock. */
export function createReplayController(options: ReplayControllerOptions) {
  const { session } = options;
  let open = false, choosing = false;
  const controls = createReplayControls({
    container: options.container, trigger: options.trigger,
    getState: () => ({
      open, choosing, active: session.replayState?.active ?? false, running: session.running,
      busy: session.loading || session.stepping, ready: session.ready,
      browsingHistory: session.browsingHistory, supported: session.replayState !== null,
      cutoff: session.replayState?.cutoff ?? null, end: session.replayState?.end ?? null, speed: session.replaySpeed,
    }),
    onTogglePanel() {
      session.pauseReplay();
      open = !open;
      if (open && session.ready && !session.loading && session.replayState && !session.replayState.active) choose();
      else { choosing = false; options.cancelNavigation(); refresh(); }
    },
    onChoose: choose,
    onPlay() { choosing = false; session.toggleReplay(); refresh(); },
    onStep() { choosing = false; void session.stepReplay(); refresh(); },
    onSpeed(speed) { session.setReplaySpeed(speed); refresh(); },
    onExit() {
      choosing = false; options.cancelNavigation(); void session.exitReplay(); refresh();
    },
    refreshSelects: options.refreshSelects,
  });
  function refresh(): void { controls.refresh(); options.onChange(); }
  function choose(): void {
    if (!session.ready || session.loading || session.stepping || !session.replayState) return;
    session.pauseReplay();
    choosing = !choosing;
    options.cancelNavigation();
    if (choosing) options.selectPointer();
    refresh();
  }
  return {
    get choosing(): boolean { return choosing; },
    select(time: number): void {
      const state = session.replayState;
      if (!choosing || !state || !session.ready || session.loading || session.stepping) return;
      const cutoff = Math.min(nextBucketStart(time, session.period), state.end);
      if (!Number.isSafeInteger(time) || cutoff <= time) return;
      choosing = false; options.cancelNavigation(); void session.enterReplay(cutoff); refresh();
    },
    cancelSelection(): void { if (choosing) { choosing = false; refresh(); } },
    refresh: controls.refresh,
    dispose: controls.dispose,
  };
}

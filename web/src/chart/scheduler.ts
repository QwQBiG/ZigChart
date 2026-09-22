export type ChartInvalidation = 'overlay' | 'full';

/** A full invalidation subsumes pointer-only work; both layers share one animation frame. */
export function createFrameScheduler(paint: (level: ChartInvalidation) => void,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancel: (handle: number) => void = cancelAnimationFrame) {
  let handle: number | null = null;
  let pending: ChartInvalidation = 'overlay';
  let disposed = false;
  return {
    request(level: ChartInvalidation = 'full'): void {
      if (disposed) return;
      if (level === 'full') pending = 'full';
      if (handle !== null) return;
      handle = schedule(() => {
        handle = null;
        const level = pending;
        pending = 'overlay';
        if (!disposed) paint(level);
      });
    },
    dispose(): void {
      disposed = true;
      if (handle !== null) cancel(handle);
      handle = null;
    },
  };
}

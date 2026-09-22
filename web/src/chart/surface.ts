export interface SurfaceSize {
  width: number;
  height: number;
  dpr: number;
  resized: boolean;
}

const CAPACITY_STEP = 128;
const SIZE_EPSILON = 1 / 64;

/** Keep storage capacity separate from the visible viewport; commit only before drawing. */
export function createCanvasSurface(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D,
  container: HTMLElement, pixelRatio: () => number = () => window.devicePixelRatio) {
  let dirty = true;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let capacityWidth = 0;
  let capacityHeight = 0;
  const readRatio = () => {
    const value = pixelRatio();
    return Number.isFinite(value) && value > 0 ? Math.max(1, value) : 1;
  };
  return {
    invalidate(): void { dirty = true; },
    observeSize(nextWidth: number, nextHeight: number): boolean {
      if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) return false;
      const changed = Math.abs(Math.max(1, nextWidth) - width) > SIZE_EPSILON
        || Math.abs(Math.max(1, nextHeight) - height) > SIZE_EPSILON || readRatio() !== dpr;
      if (changed) dirty = true;
      return changed;
    },
    commit(): SurfaceSize {
      const nextDpr = readRatio();
      if (!dirty && nextDpr === dpr) return { width, height, dpr, resized: false };
      const bounds = container.getBoundingClientRect();
      const nextWidth = Math.max(1, bounds.width);
      const nextHeight = Math.max(1, bounds.height);
      capacityWidth = Math.max(capacityWidth, Math.ceil(nextWidth / CAPACITY_STEP) * CAPACITY_STEP);
      capacityHeight = Math.max(capacityHeight, Math.ceil(nextHeight / CAPACITY_STEP) * CAPACITY_STEP);
      const pixelWidth = Math.max(1, Math.ceil(capacityWidth * nextDpr));
      const pixelHeight = Math.max(1, Math.ceil(capacityHeight * nextDpr));
      const resized = nextWidth !== width || nextHeight !== height || nextDpr !== dpr
        || canvas.width !== pixelWidth || canvas.height !== pixelHeight;
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      // The host clips this absolute surface; its pixels are never stretched to fit the viewport.
      const cssWidth = `${pixelWidth / nextDpr}px`, cssHeight = `${pixelHeight / nextDpr}px`;
      if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
      if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;
      if (resized) context.setTransform(nextDpr, 0, 0, nextDpr, 0, 0);
      width = nextWidth; height = nextHeight; dpr = nextDpr; dirty = false;
      return { width, height, dpr, resized };
    },
  };
}

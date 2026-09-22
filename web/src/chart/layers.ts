import { createCanvasSurface } from './surface';

/** Separate transient feedback from market content without introducing another viewport. */
export function createChartLayers(baseCanvas: HTMLCanvasElement, base: CanvasRenderingContext2D,
  overlayCanvas: HTMLCanvasElement, overlay: CanvasRenderingContext2D, container: HTMLElement) {
  const surfaces = [createCanvasSurface(baseCanvas, base, container),
    createCanvasSurface(overlayCanvas, overlay, container)];
  return {
    invalidate(): void { for (const surface of surfaces) surface.invalidate(); },
    observeSize(width: number, height: number): boolean {
      const results = surfaces.map(surface => surface.observeSize(width, height));
      return results.some(Boolean);
    },
    commit() {
      const [base, overlay] = surfaces.map(surface => surface.commit());
      return { ...base, resized: base.resized || overlay.resized };
    },
    clearOverlay(width: number, height: number): void { overlay.clearRect(0, 0, width, height); },
  };
}

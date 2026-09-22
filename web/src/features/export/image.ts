export interface SnapshotLabel { text: string; top: number; bottom: number; width: number; color: string }
export interface SnapshotImage {
  width: number;
  height: number;
  pixelRatio: number;
  background: string;
  foreground: string;
  muted: string;
  title: string;
  details: string;
  footer: string;
  filename: string;
  labels: readonly SnapshotLabel[];
  draw(context: CanvasRenderingContext2D): void;
}

const HEADER = 56, FOOTER = 26;
const MAX_SIDE = 8192, MAX_PIXELS = 16_000_000;

/** Bound an on-demand export allocation independently from the live canvas capacity. */
export function snapshotSize(width: number, height: number, ratio: number) {
  if (![width, height, ratio].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Invalid snapshot dimensions');
  }
  const totalHeight = height + HEADER + FOOTER;
  const w = Math.ceil(width), h = Math.ceil(totalHeight);
  const scale = Math.min(ratio, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_PIXELS / (w * h)));
  const pixelWidth = Math.max(1, Math.floor(width * scale));
  const pixelHeight = Math.max(1, Math.floor(totalHeight * scale));
  if (!Number.isFinite(scale) || scale <= 0 || pixelWidth * pixelHeight > MAX_PIXELS) {
    throw new Error('Snapshot dimensions exceed the image budget');
  }
  return { pixelWidth, pixelHeight, scale, totalHeight, chartTop: HEADER };
}

export function snapshotFilename(symbol: string, period: string, capturedAt: number): string {
  const clean = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'chart';
  const time = new Date(capturedAt).toISOString().replace(/[-:.]/g, '');
  return `zigchart-${clean(symbol)}-${clean(period)}-${time}.png`;
}

function textLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, available: number): void {
  if (available <= 0) return;
  let fitted = text;
  if (ctx.measureText(text).width > available) {
    let low = 0, high = text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (ctx.measureText(`${text.slice(0, middle)}…`).width <= available) low = middle;
      else high = middle - 1;
    }
    fitted = `${text.slice(0, low)}…`;
  }
  ctx.fillText(fitted, x, y);
}

/** Rasterize synchronously before PNG encoding, freezing one coherent chart state. */
export async function createSnapshotImage(input: SnapshotImage,
  makeCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')) {
  const size = snapshotSize(input.width, input.height, input.pixelRatio);
  const canvas = makeCanvas();
  canvas.width = size.pixelWidth; canvas.height = size.pixelHeight;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  ctx.setTransform(size.scale, 0, 0, size.scale, 0, 0);
  ctx.fillStyle = input.background; ctx.fillRect(0, 0, input.width, size.totalHeight);
  ctx.save(); ctx.translate(0, HEADER);
  ctx.beginPath(); ctx.rect(0, 0, input.width, input.height); ctx.clip();
  input.draw(ctx);
  ctx.font = '11px "Segoe UI", Arial, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  for (const label of input.labels) {
    const available = Math.min(label.width, input.width) - 20;
    if (available <= 0 || label.bottom - label.top < 20) continue;
    ctx.save(); ctx.beginPath(); ctx.rect(0, label.top, label.width, label.bottom - label.top); ctx.clip();
    ctx.fillStyle = input.background; ctx.globalAlpha = .85;
    ctx.fillRect(8, label.top + 4, Math.min(available + 4, ctx.measureText(label.text).width + 8), 17);
    ctx.globalAlpha = 1; ctx.fillStyle = label.color;
    textLine(ctx, label.text, 12, label.top + 6, available);
    ctx.restore();
  }
  ctx.restore();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = '600 13px "Segoe UI", Arial, sans-serif'; ctx.fillStyle = input.foreground;
  textLine(ctx, input.title, 12, 17, input.width - 24);
  ctx.font = '11px "Segoe UI", Arial, sans-serif'; ctx.fillStyle = input.muted;
  textLine(ctx, input.details, 12, 39, input.width - 24);
  textLine(ctx, input.footer, 12, HEADER + input.height + FOOTER / 2, input.width - 24);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value?.type === 'image/png' ? resolve(value) : reject(new Error('PNG encoding failed')), 'image/png');
  });
  return { blob, filename: input.filename, width: size.pixelWidth, height: size.pixelHeight };
}

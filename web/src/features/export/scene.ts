import type { Frame } from '../../chart/types';
import type { ProjectedDrawing } from '../../chart/bridge';
import { drawChart, formatTime, type RenderOptions } from '../../chart/render';
import { formatPrice } from '../../chart/format';
import { getPeriod } from '../../data/periods';
import { getLocale, t } from '../../ui/i18n';
import { resolvePalette } from '../appearance/model';
import { indicatorTitle } from '../analysis/catalog';
import type { StudyId } from '../analysis/model';
import { drawAnnotations } from '../drawings/render';
import type { Drawing } from '../drawings/document';
import { createSnapshotImage, snapshotFilename, type SnapshotLabel } from './image';

interface SnapshotScene {
  frame: Frame;
  options: RenderOptions;
  width: number;
  height: number;
  drawings: readonly Drawing[];
  positions: readonly ProjectedDrawing[];
  source: string;
  partial: boolean;
}

/** Compose one copied core frame without DOM overlays or transient editing feedback. */
export function captureChartSnapshot(scene: SnapshotScene) {
  const { frame, options, width, height, drawings, positions } = scene;
  const palette = resolvePalette(options.appearance), state = options.indicators;
  const locale = getLocale(), period = getPeriod(options.period);
  const periodLabel = t(`${period.unit}Period`, { n: period.multiplier });
  const overlays: StudyId[] = (['ma', 'ema', 'bb'] as const).filter(id => state[id].enabled);
  overlays.push(...state.averages.map(item => item.id));
  const labels: SnapshotLabel[] = [];
  for (const pane of frame.panes ?? []) {
    const ids: StudyId[] = pane.id === 0 ? overlays : [(['ma', 'volume', 'rsi', 'macd'] as const)[pane.id]];
    if (!ids.length) continue;
    labels.push({ text: ids.map(id => indicatorTitle(id, state, locale)).join(' · '),
      top: pane.top, bottom: pane.bottom, width: frame.meta[11], color: palette.text });
  }
  const last = options.latest;
  const ohlc = last ? (['open', 'high', 'low', 'close'] as const)
    .map(key => `${t(`${key}Short`)} ${formatPrice(last[key], options.instrument.priceScale)}`).join('   ') : '';
  const at = last ? `${formatTime(last.time)} · ${t(scene.partial ? 'partialCandle' : 'completeCandle')}` : '';
  return createSnapshotImage({ width, height, pixelRatio: options.pixelRatio,
    background: palette.backgroundColor, foreground: palette.text, muted: palette.muted,
    title: `ZigChart · ${options.instrument.symbol} · ${periodLabel}`,
    details: `${locale === 'zh-CN' ? '最新 K 线' : 'Latest bar'}: ${ohlc}`,
    footer: `${scene.source} · ${at}`, labels, filename: snapshotFilename(options.instrument.symbol, options.period, Date.now()),
    draw(ctx) {
      drawChart(ctx, frame, width, height, options);
      if (drawings.length) drawAnnotations(ctx, frame, drawings, positions, null, options.appearance, options.instrument.priceScale);
    },
  });
}

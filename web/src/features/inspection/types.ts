import type { BarInfo, Frame, PaneId } from '../../chart/types';

/** Host-owned copies; the shared core supplies the selected point and pane value. */
export interface InspectionSelection {
  bar: BarInfo;
  frame: Frame;
  paneId: PaneId;
  x: number;
  y: number;
  value: number | null;
  pointVisible: boolean;
}

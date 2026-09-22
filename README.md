# ZigChart

[English](README.md) | [简体中文](README.zh-CN.md)

A Web chart MVP built around a portable Zig core: **Zig → WebAssembly → TypeScript → Canvas 2D**.

The core owns validated OHLCV data, MA/EMA/RSI/MACD/Bollinger Bands calculations, viewport state, hit testing, and chart geometry. The browser owns data access, input, scheduling, labels, and Canvas 2D drawing, including hardware acceleration.

## Current scope

- Candlestick, hollow-candlestick, OHLC-bar, line, area, and baseline main series with optional aligned Volume, RSI, and MACD panes; new preferences start with candles and no indicators.
- Independently added MA, EMA, Volume, RSI, MACD, and Bollinger Bands, plus up to six additional MA/EMA instances, with separate settings and documented initialization.
- Pointer-centered zoom, drag/keyboard pan, crosshair inspection, and follow-latest behavior.
- Regular, logarithmic, percentage, and indexed-to-100 price scales, optional inversion, readable tick intervals, and independent manual scaling with an automatic-fit control.
- Time-axis dragging and wheel zoom, plus four crosshair modes with separate appearance preferences.
- Batched historical loading and current-bar/new-bar updates.
- Deterministic synthetic history, historical bar replay and separate pausable sample updates, visibly labeled as sample data.
- Switchable English and Simplified Chinese interface, including chart labels and messages.
- Full-viewport workbench with a collapsible watchlist/quote sidebar and series-selected settings for themes, series styles, grid, and last-price visibility.
- Resizable watchlist sidebar and adjacent pane dividers for up to four chart panes, with a shared time axis and a width-aware zoom limit.
- Analysis library grouped by Trend, Volume, Oscillators, and Volatility.
- Selectable 1/2/3/5/10/15/30-minute, 1/2/4/6/12-hour, daily, weekly, and calendar-month bars from the same synthetic series.
- Horizontal/vertical lines, horizontal rays, trend segments, rays, extended lines, rectangles, Fibonacci retracements and text annotations with selection, dragging, style editing, locking, deletion, undo/redo, and local restoration per period.

The application uses reproducible synthetic market data. Connect a market provider through the [data interface](docs/data-contract.md).

## Run locally

Use Node.js **22.21.1**, npm **10.9.4**, and Zig **0.15.2**. Vite **8.3.0** and TypeScript **5.9.3** are pinned in the package manifest and lockfile. Run these commands from the repository root in PowerShell or a POSIX shell:

```text
npm ci
npm run setup:zig
npm run build
npm test
npm run dev
```

Open the local URL printed by Vite. `setup:zig` downloads the official compiler into `.tools/` and verifies its checksum. It supports Windows, Linux, and macOS on x64 and arm64. Alternatively, set `ZIG_BIN` to a Zig 0.15.2 executable; the wrapper checks its version.

On Windows, use `$env:ZIG_BIN = 'C:\path\to\zig.exe'`. Local tool binaries and generated WebAssembly are ignored by Git. The dev server needs `web/public/core.wasm`; rerun `npm run build:wasm` after changing Zig sources.

On macOS, native tests require an installed compatible Xcode SDK. With the pinned Zig 0.15.2, use Xcode 26.3: `DEVELOPER_DIR=/Applications/Xcode_26.3.app/Contents/Developer npm test` (adjust the installed path). CI selects this SDK for its job without changing the system-wide Xcode selection. See [SDK compatibility and validation scope](docs/verification.md#automated-checks).

To inspect the production build, run `npm run preview` after `npm run build`. The build output is in `dist/`. CI builds and tests on Windows, Linux, and macOS, recording the runner platform and architecture.

## Explore the chart

The bottom-left range buttons offer **1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y and All**. They choose a supported candle resolution that fits readable spacing and display that resolution in the top toolbar. Presets end at the latest known market snapshot, not the computer clock. Months/years use UTC calendar arithmetic; All loads the provider's available monthly history.

Open the adjacent calendar control or press **Alt+G** to go to one complete UTC day or choose a custom range with both dates included. Applying directly requests bars opening before the range end, without paging backward from today's candles. Historical browsing pauses replay. **Latest** replaces the historical snapshot with the current one and leaves replay paused; it also recovers from empty or failed historical requests. With chart data available, `End` and time-axis double-click provide the same return action. Closing or cancelling the unsubmitted dialog leaves the chart unchanged.

Date ranges choose a readable resolution automatically, include the candle containing their start, and clip their end to the provider's snapshot cutoff. Selection uses candle opening times and preserves whole provider candles: weekly/monthly OHLC can include days before the requested start or after the requested end. The toolbar distinguishes no data, partial history, density limits and loading errors; All means available history and does not report an unavailable earlier start. Manual pan/zoom, Latest or a period change clears the range selection. These UTC/24×7 sample rules are not an exchange-session calendar; no holiday or weekend bars are invented.

The crosshair defaults to **Free movement**: moving vertically within one candle changes the cursor price without changing that candle's OHLC readout. Optional **Snap to close** always uses close for both rising and falling candles. The settings button's tooltip and accessible name report the applied mode. Existing saved modes remain respected; select Free movement and Apply to change an older saved magnet preference.

The top toolbar groups period, main-series type, indicators, replay, and undo/redo controls. The instrument, selected period, OHLC values, and indicator legends sit over the chart background, without a separate header taking height from the plot. The current instrument is explicitly labeled as synthetic.

The toolbar's camera opens a frozen chart preview for **Download PNG**. It includes the visible panes in their current order/maximization, committed drawings, indicator legends, instrument/period, the latest loaded bar's OHLC and UTC/sample labels. Crosshair, selection handles, unfinished edits, toolbar and sidebar are excluded. The export uses the current chart area plus a caption header/footer; it reduces pixel density when needed to stay within 8,192 pixels per side and 16 million pixels in total. Its contents remain fixed while the preview is open. The adjacent **Fullscreen** button expands the workbench with its dialogs; its state follows the browser, and unsupported or rejected requests show feedback.

Choose candles, hollow candles, OHLC bars, line, area, or baseline from the series control. Line, area, and baseline use closing prices; selecting a presentation does not replace the data, reset the viewport, or change the candle period. The choice is saved independently under the version 2 `zigchart.series` preference when storage is available. Existing drawings and indicators keep the same time and price coordinates.

Use the header's **English / 简体中文** selector to change the interface immediately. On first use, the browser's preferred supported language is selected, with English as the fallback. An explicit selection is remembered locally when browser storage is available; switching still works when storage is unavailable. Changing language preserves loaded candles, the viewport, locked vertical scales, replay progress, and indicator visibility. Numbers and dates follow the selected language; chart times remain UTC.

Drag or press Left/Right to pan. Scroll over the chart to zoom at the pointer; `+` and `-` zoom with the keyboard. `End` or **Latest** returns to the newest bars in the current source snapshot. Move over any pane to inspect the same candle. **Older history** requests another page; approaching the left edge also requests history.

Open **Replay → Choose start** and click a candle in any visible pane. Historical replay includes that candle through its period end, capped at the available sample cutoff, and starts paused. Play, pause, **Next bar**, reselect and speeds **0.25× / 0.5× / 1× / 2× / 5× / 10×** share one cutoff across all panes and period changes. A step completes the current period or adds the next; 1× waits one second between steps, with processing time additional. Future data is excluded from unfinished larger-period candles. This is synthetic replay, not reconstructed historical ticks.

Closing the replay controls pauses and retains the historical position. **Exit replay** restores the current sample snapshot and remains paused; **Latest**, `End` and time-axis double-click instead return to the active replay position while replay is active. **Play sample updates** is available outside historical replay and simulates new intrabar updates separately. Replay position and speed are not restored after reload. Providers without the optional replay capability cannot use historical replay.

Drag vertically on the right price axis to adjust only the price scale: upward magnifies, downward compresses, anchored at the initial pointer height. Movement starts after 4 CSS pixels; a click alone does not change the scale. Double-click that axis or click **Auto / Fixed** to refit the vertical ranges without moving time. The button reports the current scale mode; when focused, Up/Down adjusts price scale around its center. Indicator-pane and time axes do not accept this price-axis gesture.

Drag the bottom time axis horizontally after the same 4 CSS-pixel threshold: right magnifies and left compresses, anchored at the right plot edge. Scroll there to zoom at the pointer, or double-click to follow the latest bars and restore the default right-side space. These gestures share the chart's existing viewport and zoom limits.

Open **Chart settings → Scales**, or the price-mode button beside the axis, to choose **Regular**, **Logarithmic**, **Percentage**, or **Indexed to 100**, with optional inversion. The core generates readable tick intervals. Relative scales use the close of the first candle whose center is visible; percentage uses `(price - base) / abs(base) × 100`, and indexed values add 100. A zero reference falls back to Regular. Logarithmic mode requires a positive visible data set and range; otherwise the mode button reports a Regular fallback. Changing mode or inversion preserves the time viewport, indicator-pane ranges, fitting state and any fixed raw price range. Automatic price ranges use the selected mode's padding. Preferences are saved separately as `zigchart.scales`.

The drawing rail's **Crosshair settings** offers free movement, snap to close, hidden, and snap to nearest OHLC. Line, area, and baseline charts use close for both snapping modes; Volume snaps to volume, and oscillator panes snap to their nearest valid indicator value at the selected candle. Warm-up values are unavailable (`NaN`) and are not snap targets. Color, width (1–3 CSS pixels), solid/dashed/dotted lines, and horizontal/vertical visibility are independent of chart and indicator styles. Apply saves `zigchart.crosshair`; cancel or `Esc` discards the draft. Hiding the crosshair keeps candle readouts available, and future blank space never receives a fabricated time label.

The header's period selector loads the chosen resolution and recalculates indicators while preserving their visibility switches. It returns to the latest loaded view; historical browsing retains its snapshot cutoff and stays paused. An explicit period choice is remembered locally when storage is available. Outside historical browsing, a running replay resumes after the new snapshot loads, retaining its simulated clock. Old requests and callbacks cannot update the new period. The sample uses a UTC, 24/7 calendar: weeks begin on Monday and months follow actual calendar boundaries. Seconds and exchange-session calendars are not supported; changing the visible range is separate from changing the candle period.

Click the rendered main series to select it and display its visible handles. Line and area handles sit at closing prices; candle and OHLC-bar handles use the open/close midpoint. Click a handle to open **Chart settings**. A drag of at least 4 CSS pixels pans without opening settings; clicking blank space or pressing `Esc` clears the series selection. With the chart focused, `Enter` first selects the series, then opens settings on the next press. The instrument title also selects the series, providing a keyboard-accessible route when candle components are hidden.

**Chart settings** separates **Symbol**, **Scales**, and **Canvas** settings. Symbol controls follow the selected series: candles have independent body/border/wick visibility and rising/falling colors; OHLC bars have rising/falling colors; line and area have line color, width, and straight/step paths, with top/bottom fill colors for area. Theme, background, grid, and last-price visibility are also configurable. **Apply** commits the draft; **Cancel**, the close button, or `Esc` discards it. The dark preset uses a black background. Theme selection applies its chart color preset while preserving other options; **Restore defaults** restores current-theme appearance, default series styles while retaining the series type, and Regular non-inverted scales. Indicator and crosshair preferences remain independent. Applied preferences are saved locally when storage is available.

The right sidebar contains a **Watchlist** and current-instrument information. Open the symbol picker from the top toolbar or **Add symbol**, then choose **ZIG/USD**, **DEMO:STOCK**, **DEMO:FX** or **DEMO:INDEX**. All four are reproducible synthetic samples, with price scales 100, 100, 100000 and 10 respectively; they are not exchange quotes. Select a watched row to switch the chart. Only the active instrument has a loaded quote; inactive rows show a dash. Adding/removing membership is independent of selection and does not restart the feed; an empty watchlist remains valid. Membership uses `zigchart.watchlist`, and the validated selected symbol uses `zigchart.symbol`. Displayed change uses the latest candle close minus open in the selected period, with that open as the percentage base, not a daily/session change. The watchlist button collapses the sidebar.

Switching instruments cancels previous data work and replay, opens a fresh sample snapshot paused, and preserves the selected period and common chart/indicator styles. Each instrument keeps separate drawings and fixed baseline settings, including unsaved in-memory edits when storage is unavailable. Old ZIG/USD drawings and baseline preferences remain eligible for migration. The sample labels do not imply stock, forex or index exchange calendars; all use the documented UTC 24/7 fixture.

Drag the divider beside the watchlist sidebar to change its width. On desktop, the sidebar can use the remaining width while the chart column retains at least 220 CSS pixels. Focus that divider for arrow-key resizing; double-click restores its default width. Dropdown choices use the current page theme.

Price plus the optional Volume, RSI, and MACD panes share one time viewport and one frame schedule. Drag a divider between adjacent panes after a 4 CSS-pixel threshold. With the divider focused, Up/Down moves it by 8 CSS pixels; Home/End selects its permitted limits. Double-click restores only that pair's default proportions while preserving their combined size and all other panes. The core reserves at least 64 CSS pixels per visible pane when space permits and divides insufficient height equally. Version 3 `zigchart.layout` saves `paneWeights` and `paneOrder`; valid version 1/2 settings migrate with the default order.

Each pane's upper-right controls move it up/down or maximize it. Price can move too; its title, OHLC, overlays and drawings follow it. Maximization temporarily hides other panes and keeps one shared time viewport; Restore returns their saved proportions and current order. Adding Volume, RSI, or MACD automatically restores all active panes so the new study is visible. Parameter and style edits keep the selected maximization. Removing the maximized indicator restores the remaining panes. Reordering and maximization preserve fixed ranges. Order persists across reloads; maximization does not. While only an auxiliary pane is visible, price drawing tools and price-axis controls are unavailable.

Series selection, the drawing settings button, and the watchlist button show their current state. Replay controls distinguish starting, pausing, and resuming; unavailable actions are disabled.

Open the header's **Indicators & scripts** entry to search the analysis library in English or Chinese. Trend, Volume, Oscillators, and Volatility groups contain MA, EMA, Volume, RSI, MACD, and Bollinger Bands. New preferences start with no indicators. Once MA or EMA is added, **Add another** creates an independent instance with its own period, color, width, legend and readout; at most six additional averages can coexist with the original MA and EMA. Each added instance has a numbered identity and its own settings/removal actions. Removing it deletes only that instance. Removing a built-in indicator preserves its settings and releases its legend/pane. Version 1/2/3 `zigchart.indicators` documents migrate to version 4, preserving existing settings and extra averages while adding disabled Bollinger Bands defaults; version 1/2 have no extra averages, and version 1 also receives disabled RSI/MACD defaults.

Use an indicator's **Settings** action in the library or its chart legend to edit only that indicator. MA, EMA, and RSI each have their own period (1–500), color, and width (1–4 CSS pixels); Volume has independent rising/falling colors and opacity (10–100%). RSI reference levels obey `0 ≤ lower < upper ≤ 100` and affect display only. MACD has independent fast/slow/signal periods (1–500, fast < slow), line/signal/positive/negative colors, and line width. **Apply settings** commits the changes. Period or add/remove changes refit vertical scales without moving the horizontal viewport; style-only changes preserve scales. **Strategies** and **Scripts** remain explicit unavailable entry points without code execution or backtesting.

RSI defaults to 14 close-to-close changes: the first complete set seeds mean gains/losses, followed by Wilder smoothing. An entirely flat seed produces 50. MACD defaults to 12/26/9: its fast, slow, and signal EMAs each start from a full-period SMA of available inputs; the histogram is `MACD - signal`, without doubling. Warm-up values remain `NaN`. RSI uses a fixed 0–100 pane scale; MACD's range includes zero.

**Bollinger Bands (BB)** overlays the price pane: a close-based SMA plus/minus a multiple of the population standard deviation (divisor `N`). Defaults are 20 bars and multiplier 2; period is 1–500 and multiplier is 0.1–10. The first `N - 1` values remain unavailable. Basis, upper, lower and fill colors are independent, with line width 1–4 CSS pixels, optional fill and 0–100% fill opacity. Hover readouts show all three values. Adding BB preserves pane maximization and the existing pane layout.

Open **Lines** on the left: horizontal lines, horizontal rays, and vertical lines need one point; trend segments, rays, and extended lines need two. Rectangles have a separate tool. A ray continues from its first point through its second, in either time direction; an extended line continues both ways. A horizontal ray extends rightward, and a vertical line spans the price pane. Place anchors on existing price candles. Use the pointer tool to select an object, drag its body or endpoints, edit its color and width, lock it, or delete it. One completed edit is one undo step; `Esc` cancels an unfinished drawing or drag. Drawings keep UTC time and integer-price anchors, so they remain aligned after pan, zoom, resize, and historical loading. Each period has its own document, limited to 256 objects and 100 undo steps. Valid local documents restore after reload; undo history and selection do not. Extensions can be selected in future blank space, but creating anchors or starting a drag there is not supported.

Open **Drawing objects and style** from the left drawing rail. Its dedicated dialog selects drawings in the current period, including those outside the view, and edits their style, lock state, or deletion once unlocked. A locked selection shows **Unlock selected drawing** and a matching hint: position and deletion are protected, while color and width remain editable. Drawings whose anchor history has not been loaded remain in this list; they can only be projected onto the chart after those bars are loaded.

Choose **Text** on the left rail and click a loaded candle in the price pane to place a text box and open its editor. Plain text supports up to 1,000 characters and 20 explicit lines, automatic wrapping at 80–640 CSS pixels, font sizes 10–48, bold/italic, and optional background and border. Object color sets text color; object width sets border width. Double-click a text box to reopen its dialog. Changes commit on leaving a field, or Ctrl+Enter for text. The top-left anchor follows time and price; the visible box is selectable and draggable, including its portion over right-side blank space, while the resulting anchor must still match a loaded candle. Text participates in per-period saving, undo/redo and PNG export. Locking protects position and deletion while content and style remain editable. Empty text is rejected.

Use the left rail's **Measure** ruler, or select the pointer tool and hold **Shift** while clicking/dragging in the price pane. Click a start and end point, or drag at least 4 CSS pixels and release. The temporary result reports signed price/percentage change, candle distance and inclusive count, actual UTC elapsed time, and volume including both endpoint candles. A zero starting price has no percentage; volume exceeding safe integer precision is unavailable. An unfinished last candle contributes its current volume. Anchors require loaded candles, including after pane reordering; future blank space and auxiliary panes cannot receive them. Completion retains the result until the next chart click, Esc, another drawing tool or navigation; resizing the window reprojects a completed result. Measurements are excluded from saved drawings, undo history and PNG export.

The default view leaves about 20% of the plot width to the right of the latest candle. Drag candles left to leave more room, up to placing the latest candle at the center. The blank area contains no fabricated candles. Live appends preserve the current right-side spacing while the latest candle is visible; `End` or **Latest** restores the default spacing. With insufficient history, the left boundary can limit exact placement.

MA/EMA initially use a period of 20 when added. The core retains up to 100,000 candles. The viewport spans at least 10 candle slots and limits its maximum span according to plot width, targeting at least 6 CSS pixels between candle centers, with an absolute ceiling of 2,000 slots. Storage is fixed per WebAssembly instance. See the contracts below before implementing a provider.

Panning keeps candle spacing and the vertical ranges fixed, including after releasing the pointer. Effective zoom, **Latest**, or `End` refits automatic price and indicator ranges; RSI stays at 0–100, and further zoom input at a limit preserves the locked ranges. Newly exposed values outside a fixed range are clipped to their pane. Time labels stay anchored to UTC times and move with their candles; zooming can change label density.

Baseline charts color closes above/below a reference independently. Select **Baseline** in the top toolbar, then open the series settings to choose the first visible close or a fixed instrument price, above/below colors, width and straight/step paths. Apply saves the draft; cancel discards it. Existing version 1 series preferences migrate without losing styles. Data adapters can send explicit corrections for loaded timestamps; see the [data contract](docs/data-contract.md) for atomic validation and subscription rules.

**Fibonacci retracement** is in the **Lines → Fibonacci** group. Place two anchors on loaded candles, then open **Drawing objects and style** for that object. Each object has 1–24 independently colored/enabled ratios (−10 to 10), left/right extensions, reverse, anchor-line visibility, ratio/price labels, line style and background opacity (0–0.6). Numerical edits commit on blur or Enter and participate in undo. Ratio 0 starts at B and ratio 1 ends at A; reverse swaps them. Calculation uses raw prices unless logarithmic ratios are enabled on an effective logarithmic chart. Axis inversion changes placement, not prices. Derived prices retain fractional precision; labels use the instrument precision. Crowded labels are omitted. Settings remain independent of chart appearance and other drawings.

The touch controller accepts two contacts inside the plot to pinch-zoom the shared time axis. Moving the pair also moves its time anchor. The second contact cancels an unfinished single-pointer drag or drawing preview. After lifting a contact, lift all remaining contacts before starting another gesture; a third contact suspends navigation. A single contact retains the existing selection, drawing and pan behavior. Current gesture tests use simulated contacts with the Wasm bridge; physical-device and mobile-browser checks are listed in [Verification](docs/verification.md#browser-checklist).

## Project map

| Path | Responsibility |
| --- | --- |
| `core/` | Platform-independent chart engine, Wasm entry points, and native tests |
| `web/src/main.ts`, `web/src/app/` | Application entry, workbench composition and chart-input routing |
| `web/src/chart/` | Wasm bridge, chart types, Canvas rendering, and time labels |
| `web/src/data/` | Canonical market contracts, instrument catalog, sample provider, period rules and request/subscription lifecycle |
| `web/src/features/instruments/` | Selected symbol and per-instrument drawing/baseline persistence |
| `web/src/features/analysis/` | Independent indicator settings and the analysis library |
| `web/src/features/appearance/` | Validated appearance model and draft settings dialog |
| `web/src/features/drawings/` | Drawing document, editor, rendering, and object/style dialog |
| `web/src/features/measure/` | Temporary ruler interaction and result presentation using core measurement output |
| `web/src/features/export/` | Chart image composition, bounded PNG encoding, preview and download |
| `web/src/features/range/` | UTC date/preset selection, readable resolution policy, navigation dialog and loading controller |
| `web/src/features/replay/` | Historical replay controls and state presentation; session and provider own the clock |
| `web/src/features/series/` | Main-series preferences and selection using the current projected frame |
| `web/src/features/scales/`, `web/src/features/crosshair/` | Independent scale/crosshair preferences, settings, and interaction feedback |
| `web/src/features/watchlist/` | Symbol search/selection, independent watchlist membership and active-quote presentation |
| `web/src/ui/` | Localization, workspace layout, native fullscreen, themed dropdowns, and shared styles |
| `tests/` | Tests that exercise the built Wasm bridge and host data behavior |
| `scripts/` | Pinned compiler setup, build wrappers, and local measurements |
| `docs/` | Architecture, provider contract, verification procedures, and references |

Read the [feature map](docs/feature-map.md), [architecture](docs/architecture.md), [data contract](docs/data-contract.md), and [verification](docs/verification.md) for implementation contracts. Design research and license boundaries are recorded in [references](docs/references.md) and [THIRD_PARTY.md](THIRD_PARTY.md). Contributors should start with [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).

Maintained documentation and interface translations have English and Simplified Chinese versions. Update both languages together; keep code, identifiers, and code comments in English. Localized message values may contain Chinese text.

## Status and license

This MVP covers the Web chart workflow with synthetic data. Browser storage saves preferences and drawing documents. The [feature map](docs/feature-map.md) lists implemented capabilities and planned extensions; the [data contract](docs/data-contract.md) defines provider integration, including sessions, adjustments and reconnect behavior.

ZigChart is licensed under [Apache-2.0](LICENSE). Third-party component licenses and notices remain applicable independently; see [THIRD_PARTY.md](THIRD_PARTY.md).

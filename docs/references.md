# Charting references

[English](references.md) | [简体中文](references.zh-CN.md)

This review records the design choices informed by official repositories and documentation checked on 2026-09-20 and 2026-09-21. Repository links refer to the inspected default branches unless a version is specified.

## Open-source implementations

| Reference | Observed design | Decision for ZigChart |
| --- | --- | --- |
| [KLineChart](https://github.com/klinecharts/KLineChart) | Canvas chart implementation with separate chart, store, pane, event, and indicator components. | Learn from shared pane layout and explicit coordinate conversion; keep our data and geometry in the platform-independent Zig core. |
| [KLineChart Pro](https://github.com/klinecharts/pro) | Application shell on top of KLineChart, with a provider interface for symbol search, historical bars, subscriptions, and teardown. | Keep provider integration outside the chart core; implement only the provider operations needed by the MVP. |
| [Lightweight Charts](https://github.com/tradingview/lightweight-charts) | Separate series and time-scale APIs, full data replacement, latest-bar updates, and logical-range queries for historical loading. | Specify update ordering and viewport anchoring explicitly; use one horizontal coordinate system across all enabled panes. |

The reviewed implementation and API entry points are:

- KLineChart [Chart.ts](https://github.com/klinecharts/KLineChart/blob/main/src/Chart.ts) and [DataLoader.ts](https://github.com/klinecharts/KLineChart/blob/main/src/common/DataLoader.ts). The chart computes shared pane widths; its data loader separates historical batches and live subscriptions.
- KLineChart Pro [types.ts](https://github.com/klinecharts/pro/blob/main/src/types.ts) ([source](https://raw.githubusercontent.com/klinecharts/pro/main/src/types.ts)). Its history, subscription, and unsubscribe operations carry symbol and period metadata. ZigChart follows this explicit period/lifetime separation with its own typed interface, cancellation, and request-generation checks.
- KLineChart's [overlay guide](https://klinecharts.com/en-US/guide/overlay) describes drawing lifecycle, data-coordinate points, control handles, selection, drag events, locks, and style overrides. ZigChart uses these interaction concepts in its drawing editor, keeping projection and hit testing in Zig and document edits in the host. Its supported tools and interfaces are defined in the [feature map](feature-map.md) and [architecture](architecture.md).
- Lightweight Charts [series API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ISeriesApi) and [data-layer.ts](https://github.com/tradingview/lightweight-charts/blob/master/src/model/data-layer.ts). `setData` replaces ordered data; `update` normally replaces the latest timestamp or appends a newer one. Historical updates are an explicit separate option. Logical range queries support requesting history near the left edge.

ZigChart's chart code is implemented in this repository; the listed projects serve as design and behavior references. Their source, styles, images, and chart packages are not bundled. ZigChart's interfaces and numerical rules are documented in the [architecture](architecture.md); license details are in [THIRD_PARTY.md](../THIRD_PARTY.md).

The official Lightweight Charts 5.2 [price-mode](https://tradingview.github.io/lightweight-charts/docs/api/enumerations/PriceScaleMode), [crosshair-mode](https://tradingview.github.io/lightweight-charts/docs/api/enumerations/CrosshairMode), [series](https://tradingview.github.io/lightweight-charts/docs/series-types), and [plugin](https://tradingview.github.io/lightweight-charts/docs/plugins/intro) documentation provides the categories used in the [feature map](feature-map.md). ZigChart specifies its reference values, fallback behavior, numeric ranges and persistence separately.

Lightweight Charts documents [resizable panes](https://tradingview.github.io/lightweight-charts/docs/panes) and a [minimum bar spacing in pixels](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/TimeScaleOptions#minbarspacing). These inform ZigChart's adjacent-pane dividers and width-aware zoom bound. ZigChart uses a minimum of 6 CSS pixels between candle centers for readability; the upstream `minBarSpacing` default is 0.5 pixels. Pane geometry remains in Zig, and the host paints up to four built-in panes from one shared frame and time viewport.

The official [series API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ISeriesApi#update) distinguishes ordinary latest-bar updates from explicitly requested historical updates. ZigChart provides a batched `correct` operation for existing timestamps, with atomic validation and suffix indicator recomputation. The official [series types](https://tradingview.github.io/lightweight-charts/docs/series-types) also include baseline charts. ZigChart supports fixed-price and first-visible-close references through its Zig price projection and Canvas renderer.

The official [range-switcher example](https://tradingview.github.io/lightweight-charts/tutorials/demos/range-switcher) and [time-scale API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ITimeScaleApi#setvisiblerange) inform the separation between date-range presets and candle resolution. In ZigChart, the host loads a suitable resolution and Zig fits timestamps in the shared viewport.

Crosshair behavior follows the modes described in [Lightweight Charts v5.2.0 magnet.ts](https://github.com/tradingview/lightweight-charts/blob/v5.2.0/src/model/magnet.ts). Normal mode leaves the pointer price unchanged; Magnet considers close, while MagnetOHLC considers open, high, low and close. The same fields apply to rising and falling candles. ZigChart defaults to free movement for price inspection.

The official [chart screenshot API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/IChartApi#takescreenshot) returns a Canvas and excludes the crosshair by default. In [v5.2.0 chart-widget.ts](https://github.com/tradingview/lightweight-charts/blob/v5.2.0/src/gui/chart-widget.ts), pending drawing invalidations are committed before pane, separator and axis bitmaps are composed into a separate Canvas. ZigChart renders its copied frame and committed drawings into a bounded image, adds localized chart metadata, and excludes editing feedback.

## Indicator formulas

TradingView's official [RSI](https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/) and [MACD](https://www.tradingview.com/support/solutions/43000502344-moving-average-convergence-divergence-macd-indicator/) explanations provide formula references: RSI compares smoothed gains and losses; MACD subtracts the slow moving average from the fast one, with a signal average and a histogram equal to MACD minus signal. ZigChart uses EMA for both MACD averages and its signal.

In ZigChart, RSI defaults to 14 close-to-close changes, seeds average gains and losses from the first full period, then applies Wilder smoothing; a flat seed yields 50. MACD defaults to 12/26/9 and uses a full-period SMA seed for each EMA, including the signal EMA's first available MACD values. The histogram is `MACD - signal`. Unavailable warm-up values remain NaN. RSI uses a fixed 0–100 pane; MACD's automatic range includes zero.

TradingView's official [Bollinger Bands explanation](https://www.tradingview.com/support/solutions/43000501840-bollinger-bands-bb/) documents a moving-average basis with standard-deviation bands and defaults of close, length 20 and multiplier 2. ZigChart uses a close SMA, population variance divided by `N`, and NaN until a full window exists. The divisor is a ZigChart choice; the source page leaves it unspecified. The chart supports one BB instance calculated from closing prices at the chart's period, with an SMA basis and zero offset.

## Product references

The official Advanced Charts [required datafeed methods](https://www.tradingview.com/charting-library-docs/latest/connecting_data/datafeed-api/required-methods/) separate symbol search, metadata resolution, history and subscriptions. ZigChart uses a finite synthetic catalog, instrument-bound source instances and cancellable session replacement. Metadata remains in the host, and selecting a watchlist member is separate from managing membership.

TradingView's official [Text drawing tool guide](https://www.tradingview.com/support/solutions/43000516983-text-drawing-tool/) describes chart-point text that moves with scrolling, font styling, wrapping, backgrounds and borders. ZigChart supports bounded plain text at a single data anchor, edited in a dedicated dialog. The browser measures numeric hit boxes for Zig. Text follows its chart anchor and the drawing document's period.

TradingView's [date and price range tools](https://www.tradingview.com/support/solutions/43000516996-date-and-price-range-drawing-tools/) and [Shift measurement shortcut](https://in.tradingview.com/support/solutions/43000537228-how-to-use-measure-tool-quickly/) describe measuring between two chart points with price/time statistics and a keyboard shortcut. ZigChart's temporary ruler reports signed distance, inclusive bar count/volume and actual UTC differences, with precision limits defined in the core.

TradingView's official [Bar Replay guide](https://www.tradingview.com/support/solutions/43000474024-how-do-i-turn-bar-replay-on/) describes selecting a starting candle, play/pause, adjustable speed, stepping, reselection and returning to current data. These guide ZigChart's replay toolbar. Replay is an optional provider capability with an exclusive cutoff, synthetic partial-minute rules and period stepping. It operates on the active chart.

TradingView's [ray](https://www.tradingview.com/support/solutions/43000518113-ray-drawing-tool/), [extended line](https://www.tradingview.com/support/solutions/43000518131-extended-line-drawing-tool/), [horizontal ray](https://www.tradingview.com/support/solutions/43000518121-horizontal-ray-drawing-tool/), and [vertical line](https://www.tradingview.com/support/solutions/43000518093-vertical-line-drawing-tool/) pages identify drawing categories and editing conventions. ZigChart calculates their geometry in Zig and manages documents and gestures in the host.

Lightweight Charts exposes price/time-axis dragging, wheel scaling and double-click reset in [HandleScaleOptions](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/HandleScaleOptions), and automatic fitting through [PriceScaleOptions](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/PriceScaleOptions). ZigChart's axis controllers use these interaction conventions. Time-axis dragging anchors at the right edge, and double-clicking the time axis follows the latest bars. Zig computes shared transforms, inverse coordinates and readable ticks; the browser handles input and formatting.

The [Lightweight Charts chart widget](https://github.com/tradingview/lightweight-charts/blob/master/src/gui/chart-widget.ts) skips unchanged-size work and merges invalidations into scheduled drawing. ZigChart batches divider input and commits Canvas dimensions immediately before painting. The upstream pane lifecycle and per-series settings also inform optional, separately configured studies.

[fuchenru/TradingHero](https://github.com/fuchenru/TradingHero) describes a stock-analysis application that integrates TradingView visualizations. Its relationship to tradinghero.com is unconfirmed. The repository and product screenshots are separate references; the screenshots inform control grouping and visual hierarchy.

[MetaTrader 5 chart documentation](https://www.metatrader5.com/en/trading-platform/charts) and [technical analysis documentation](https://www.metatrader5.com/en/trading-platform/technical-analysis) provide references for readable OHLC information, indicators on the price chart or separate scales, manual scaling, and reusable chart settings. ZigChart stores appearance preferences and drawing documents locally. Trading, scripting, complete saved workspaces and strategy testing remain outside this chart MVP. Redistribution of the platform, artwork or source code requires the applicable rights.

[TradingView](https://www.tradingview.com/) is a product reference, distinct from its open-source Lightweight Charts library. Its [official product comparison](https://www.tradingview.com/charting-library-docs/latest/product-comparison/) distinguishes hosted widgets, Lightweight Charts, and Advanced Charts. Neither chart library includes market data. Widgets use TradingView-hosted data and do not accept an arbitrary replacement feed.

The [Advanced Charts datafeed documentation](https://www.tradingview.com/charting-library-docs/latest/connecting_data/Datafeed-API/) identifies integration cases addressed in ZigChart's data contract: ordered historical bars, explicit end-of-history, indicator warm-up history, complete replacement of the current bar, and independent subscription lifetimes.

The [resolution documentation](https://www.tradingview.com/charting-library-docs/latest/core_concepts/Resolution/) distinguishes minute/hour resolutions from calendar units and ties available choices to datafeed capabilities. ZigChart's period catalog lists the periods its synthetic provider delivers, starting at one minute. Aggregation uses UTC, weeks start on Monday, and months follow calendar boundaries. Screenshots and product interfaces inform workbench density and control placement.

Advanced Charts has separate usage terms: its [introduction](https://www.tradingview.com/charting-library-docs/latest/introduction/) describes free use with visible attribution in public environments, excluding private or paywalled use. Do not assume the Lightweight Charts license covers Advanced Charts, TradingView's website, or its market data.

TradingView's [Fibonacci retracement guide](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/) documents two-point retracements, configurable levels, extensions, reversal and optional logarithmic calculation. This is a TradingView product feature, separate from Lightweight Charts. ZigChart's numerical rules, limits and object controls are implemented in `core/fibonacci.zig` and `features/drawings/fibonacci-*`.

The official [HandleScaleOptions](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/HandleScaleOptions) and [HandleScrollOptions](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/HandleScrollOptions) document pinch scaling and touch dragging as distinct controls. ZigChart's touch controller uses the shared Zig viewport, defines takeover/release rules and coalesces pointer movement. Gesture tests use simulated contacts with the Wasm bridge; see the [device verification steps](verification.md#browser-checklist).

## Evaluation order

First verify historical prepend, current-bar replacement, indicator initialization, invalid input, and main/subchart alignment. Then compare candidate implementations with the same workloads. Record browser version, hardware, viewport, device-pixel ratio, retained/visible bar counts, update rate, and measurement method. Measure core computation and input-to-display latency separately.

ZigChart uses Zig + WebAssembly + TypeScript + Canvas 2D. The browser renderer is a separate module, so it can evolve while preserving the portable core.

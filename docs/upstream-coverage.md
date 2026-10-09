# Upstream capability coverage

[English](upstream-coverage.md) | [简体中文](upstream-coverage.zh-CN.md)

This inventory fixes the learning reference to official [Lightweight Charts v5.2.1](https://github.com/tradingview/lightweight-charts/releases/tag/v5.2.1), commit [`b2ce010e4ad59f6556c9ed60e2b2b30feccdd2d1`](https://github.com/tradingview/lightweight-charts/tree/b2ce010e4ad59f6556c9ed60e2b2b30feccdd2d1), checked on 2026-10-05. Source paths below are relative to that commit. The [feature map](feature-map.md) describes implemented behavior; [architecture](architecture.md) defines ownership and numerical contracts.

The comparison covers the library, official plugin/indicator examples and tutorial categories. **Covered** means the stated ZigChart behavior exists, not API compatibility. **Implemented** identifies delivered work within its stated scope. **Partial** identifies an implemented subset. **In progress** is work being implemented and still awaiting delivery verification. **Planned** requires implementation. **Specialized** is inventoried for a later applicable use case.

ZigChart learns behavior and interaction patterns while keeping its own implementation. Data, indicators, coordinates and the shared viewport stay in Zig; browser input, networking, presentation and drawing stay in the host. This inventory does not authorize importing upstream code or branded assets.

## Library capabilities

The fixed [API sources](https://github.com/tradingview/lightweight-charts/tree/b2ce010e4ad59f6556c9ed60e2b2b30feccdd2d1/src/api) and [model sources](https://github.com/tradingview/lightweight-charts/tree/b2ce010e4ad59f6556c9ed60e2b2b30feccdd2d1/src/model) are the reference for this table.

| Category | Coverage | ZigChart behavior and next boundary |
| --- | --- | --- |
| Built-in series | Partial | Candles, hollow candles, OHLC bars, line, area and baseline; Volume/MACD columns. Generic histogram data and multiple independent market series are planned. |
| Series appearance | Partial | Independent body/border/wick visibility and colors; simple/step paths, line width, area/baseline colors. Curved paths, per-item styles, persistent point markers and last-price animation remain planned. |
| Price scales | Partial | Regular, positive logarithmic, percentage, indexed and inverted transforms; auto/manual ranges and readable ticks. Multiple left/right/overlay axes, scale margins and configurable tick density remain planned. |
| Time scale | Partial | Shared logical viewport, bounded spacing, right-side space, pan/zoom, date fitting and history loading. Generic horizontal-scale behaviors and explicit whitespace data remain specialized extensions. |
| Crosshair and hit testing | Partial | Free, close magnet, hidden and nearest-OHLC modes; pane-local values, styles and main-series/drawing selection. General series hover ordering, public hit events and cross-chart synchronization remain planned. |
| Mouse/touch navigation | Partial | Plot/axis gestures, wheel normalization, keyboard pan/zoom and two-contact pinch. Long-press tracking and kinetic scrolling are planned. |
| Panes and order | Partial | Price plus optional Volume/RSI/MACD, shared time, adjacent resizing, reorder and transient maximization. Arbitrary panes, study-to-pane movement, series stacking order and independent scales need a broader core contract. |
| Data lifecycle | Partial | Atomic snapshots, strictly older prepends, latest upserts and explicit corrections to loaded timestamps. Arbitrary insertion/deletion, tail removal, generic per-series data and public change events are planned. |
| Price lines and markers | Implemented / Planned | Independent custom price lines are implemented within work package 2's scope. Event markers, price-positioned markers and expiring up/down markers are planned. Existing horizontal drawings remain separate objects. |
| Plugins | Planned | No upstream plugin compatibility. Public series/pane primitives and custom data series require versioned, bounded output and lifecycle contracts. |
| Localization and formatting | Partial | English/Chinese UI and scale-aware prices/volumes; timestamps remain UTC. Display-timezone preferences, custom formatters and fractional instrument notation are planned. |
| Images and surface lifecycle | Covered | Frozen PNG export of logical chart dimensions and committed content; shared frame scheduling and bounded reusable Canvas capacity. General external renderer/screenshot APIs are planned. |
| Large-data rendering | Partial | Bounded visible output and a minimum readable candle spacing. Upstream conflation concerns subpixel overview rendering; any equivalent must be an explicit overview mode preserving original bars. |
| Specialized chart types | Specialized | Yield curves, options charts and custom price/value horizontal scales require suitable data contracts and use cases. |

## Official tutorial families

The complete fixed [tutorial tree](https://github.com/tradingview/lightweight-charts/tree/b2ce010e4ad59f6556c9ed60e2b2b30feccdd2d1/website/tutorials) is grouped below. Tutorial integration techniques are references, not additional built-in library features.

| Family | Included examples/topics | ZigChart correspondence |
| --- | --- | --- |
| Customization | Creating a chart, chart colors, series, data points, second series, crosshair, price scale, time scale, price format and finishing touches | Core chart/settings/formatting are present; independent second series and broader appearance options are planned. |
| Demos | Multiple-series comparison, custom fonts, custom locale, infinite history, moving average, range switcher, realtime updates, whitespace and yield curve with update markers | History, averages, range navigation, updates and two locales are present. Multiple series, configurable fonts, whitespace and yield curves need dedicated work. |
| How-to | Horizontal price scale, inverted scale, legends, panes, price and volume, price line, series markers, programmatic crosshair, tooltips, two price scales and watermark | Inversion, legends, panes, Volume, tooltips and independent price lines are present. Markers, synchronized/programmatic inspection, two scales and watermarks are planned or specialized. |
| Accessibility | Introduction, keyboard navigation, screen readers, readability and conclusion | Ordinary keyboard navigation, localized labels, explicit candle/pane inspection, OHLC/study summaries and a shared polite live region are implemented. Browser interactions and DOM semantics are verified; real NVDA, VoiceOver and macOS verification remain outstanding. |
| Framework integrations | Simple/advanced React examples, Vue wrapper and Web Component | The current host is TypeScript/DOM. Optional wrappers should consume one public chart contract rather than introduce their own data or viewport model. |
| Analysis indicators | Pure calculations and data-change helpers | Zig owns calculation and incremental updates. The complete example inventory follows below. |

## Official plugin examples

Every plugin example directory in the fixed [plugin tree](https://github.com/tradingview/lightweight-charts/tree/b2ce010e4ad59f6556c9ed60e2b2b30feccdd2d1/plugin-examples/src/plugins) is listed below. Paths are relative to `plugin-examples/src/plugins/`. Similar visible behavior does not imply the same data structure, API or rendering algorithm.

| Group | Example directories | ZigChart coverage / next work |
| --- | --- | --- |
| Custom series: areas | `brushable-area-series`, `hlc-area-series`, `stacked-area-series` | Specialized: brushing, high/low/close areas and multiple stacked datasets. Existing close-based area is a different series. |
| Custom series: columns | `dual-range-histogram-series`, `grouped-bars-series`, `pretty-histogram`, `stacked-bars-series` | Specialized: paired ranges, grouped/stacked values and custom column shapes. Existing Volume/MACD columns cover their own numeric outputs. |
| Custom series: distributions | `box-whisker-series`, `heatmap-series`, `lollipop-series` | Specialized: distribution, heatmap and point/stem contracts. |
| Custom series: candles/background | `rounded-candles-series`, `background-shade-series` | Specialized: rounded bodies and data-driven background bands. |
| Semantic interaction | `accessibility` | Partial: loaded-candle/pane navigation, localized OHLC/study descriptions, focus-scoped application semantics and coalesced polite announcements are independently implemented over the shared Zig viewport and browser-tested. Real screen-reader verification remains outstanding. |
| Text/drawings | `anchored-text`, `rectangle-drawing-tool`, `trend-line`, `vertical-line` | Partial: data-anchored text, rectangles and line families exist. Screen-fixed text and broader tool behavior remain planned. |
| Bands | `bands-indicator` | Partial: BB/Donchian bands exist with documented formulas; arbitrary externally supplied bands are planned. |
| Inspection | `tooltip`, `delta-tooltip`, `highlight-bar-crosshair` | Partial: pane-aware tooltips, crosshair and ruler exist. Comparison tooltips, drag selection and whole-bar highlights are planned. |
| Price annotations | `user-price-lines`, `partial-price-line` | Implemented / Planned: independent full-width price lines are implemented; partial-span annotations are planned. |
| Price alerts | `expiring-price-alerts`, `user-price-alerts` | Planned: explicit trigger/lifetime semantics and host-owned alert state; no broker or delivery-service implication. |
| Scale overlay | `overlay-price-scale` | Planned: additional independent scale identity, projection and formatting. |
| Session and watermark | `session-highlighting`, `image-watermark` | Specialized: provider-declared sessions and user-owned image/text overlays. The sample's UTC/24×7 calendar is not an exchange calendar. |
| Volume profile | `volume-profile` | Specialized: document the allocation estimate from OHLCV or require trade-level data; do not label an estimate as observed traded volume at each price. |

The fixed [combined example](https://github.com/tradingview/lightweight-charts/tree/b2ce010e4ad59f6556c9ed60e2b2b30feccdd2d1/plugin-examples/src/combined-examples) composes Delta Tooltip and Brushable Area. It belongs to the inspection/custom-area work above rather than a separate chart model. The core's [series markers](https://github.com/tradingview/lightweight-charts/tree/b2ce010e4ad59f6556c9ed60e2b2b30feccdd2d1/src/plugins/series-markers) and [up/down markers](https://github.com/tradingview/lightweight-charts/tree/b2ce010e4ad59f6556c9ed60e2b2b30feccdd2d1/src/plugins/up-down-markers-plugin) are additional marker work, outside this example-directory list.

## Official indicator examples

Every directory under the fixed [indicator tree](https://github.com/tradingview/lightweight-charts/tree/b2ce010e4ad59f6556c9ed60e2b2b30feccdd2d1/indicator-examples/src/indicators) is included. Direct-calculation and automatic-update demos demonstrate two host integration approaches; ZigChart uses core calculations and its shared market session.

| Example directories | Coverage / next work |
| --- | --- |
| `moving-average` | Partial: MA/EMA and independent instances support eight input sources. Additional smoothing choices and offsets remain planned. |
| `average-price`, `median-price`, `weighted-close` | Partial: OHLC4, HL2 and HLCC4 are available as MA/EMA inputs. Independent derived-price presentation remains planned. |
| `momentum`, `percent-change` | Planned: documented lookback, missing-value and zero-base behavior with suitable pane scales. |
| `correlation` | Specialized: synchronized two-series windows, timestamp alignment, missing values and zero variance need explicit rules. |
| `product`, `ratio`, `spread`, `sum` | Specialized: multi-series arithmetic needs alignment, units, denominator and overflow contracts. |

ZigChart's RSI, MACD, BB and Donchian studies are its own implemented capabilities; they are not four additional indicators bundled in this upstream example tree.

## Workbench boundary

TradingView's [product comparison](https://www.tradingview.com/charting-library-docs/latest/product-comparison/) distinguishes the open-source rendering library from Advanced Charts and hosted widgets. Lightweight Charts does not provide market data or a built-in indicator catalog. Its examples supply selected integrations; they do not constitute the full trading workstation shown on the TradingView website.

ZigChart's symbol picker, watchlist/quotes, period menu, indicator library, drawing editor, historical replay, date navigation, bilingual dialogs, local documents, fullscreen and PNG controls belong to its browser application. Further object management, favorites, context actions and workspace templates should extend those feature modules. Scripts/strategies retain their reserved entries; Python execution, backtesting and broker/order integration remain outside the Web MVP agreement.

## Delivery work packages

| Package | State | Scope and ownership | Delivery evidence |
| --- | --- | --- | --- |
| 1. Formal workbench UI | Implemented | Shared presentation tokens/icons, toolbar density, independent dialogs and clear action states; retain existing feature ownership. | Desktop/mobile layout, bilingual controls, keyboard category navigation and six sidebar resize round trips. |
| 2. Custom price lines | Implemented | Up to 16 independent lines under `features/price-lines/`; explicit draft/Save feedback, exact decimal prices, independent title/style/visibility/labels, version 1 symbol/scale-isolated storage across periods, Zig batched projection with 22-pixel label spacing and last-price priority, no range expansion, and committed lines in PNG. | Creation/removal, draft cancellation, period/instrument isolation and PNG price-line pixel checks. |
| 3. Keyboard inspection | Implemented | I/button entry; neighboring/±10/first/last loaded candles and current-order visible panes use a UTC anchor, minimal shared-core pan and localized summaries. Retain ordinary pan/Latest/select shortcuts outside the mode. | Core/Wasm navigation and browser keyboard, history, pane, language, focus and DOM announcement checks passed. Real NVDA, VoiceOver and macOS checks remain outstanding. |
| 4. Touch tracking/inertia | Planned | Long-press inspection and optional kinetic pan; host contact/timer state, one core viewport and frame schedule. | Cancellation/takeover/resize checks plus physical mobile-browser verification. |
| 5. Study source selection | Implemented | Eight independent sources for built-in MA/EMA and six extra instances; Zig fractional input calculation, full-period seeds, additive configuration exports, version 6 migration, localized settings/legends and PNG labels. | Formula fixtures, live/history corrections, independent settings, old ABI behavior, bilingual drafts/focus, period/reload persistence and PNG source labels. |
| 6. Event markers | Planned | Explicit UTC/data-price anchors, bounded layouts, visible hit targets and export; distinguish annotations from provider events. | Gaps, invalid anchors, scale changes, visibility and export. |
| 7. Multiple series and extension contracts | Planned | Versioned series/pane outputs, stable identities, independent scales, membership and lifecycle; keep one horizontal model. | Contract validation, memory ownership, removal, range/time consistency and measured workloads. |
| 8. Specialized examples | Specialized | Custom distributions/heatmaps, session overlays, alerts, comparison calculations, volume profiles, yield curves and wrappers. | Each accepted use case supplies data semantics, bounds and acceptance checks before implementation. |

Work packages are tracked independently; an example appearing in the inventory is not an implementation claim. Formula names, financial data semantics and current capability limits belong in the feature map and architecture when delivered.

### Functional verification for packages 1 and 2

On Windows x64, headless Microsoft Edge 154.0.4258.53 passed 24 interaction checks across 1440×960 and 390×844 viewports with zero captured errors. Native core tests passed 77 cases and Web tests passed 308 cases. macOS and physical-device touch interactions remain untested.

### Functional verification for package 3

On Windows x64, headless Microsoft Edge 154.0.4258.62 passed 32 browser checks across 1440×960 and 390×844 viewports at device-pixel ratio 1, with zero runtime or console errors. Coverage included keyboard/history/pane navigation, language and focus, semantic nodes, light/dark themes and narrow layout; screenshots were checked. Held-key updates respected 180 ms coalescing, Enter reread the selection, blur cancelled pending announcements, and auxiliary-only maximization restored the correct ARIA semantics. These are browser/DOM checks, not real NVDA, VoiceOver or macOS verification.

Native core tests passed 84 cases. Three new semantic tests and seven tests using the built Wasm and inspection controller passed. TypeScript checking, the production build and architecture checks across 95 modules passed.

### Functional verification for package 5

On Windows x64, headless Microsoft Edge 154.0.4258.62 passed 19 interaction checks across 1440×960 and 390×844 viewports at device-pixel ratio 1 with zero captured errors. Checks covered source apply/cancel and independence, language changes with drafts/focus, layered Esc handling, menu cleanup over 12 settings/list round trips, extra instances, period/reload persistence, PNG labels, version 5-to-6 migration, light theme, narrow layout and language switching after removing an extra average.

Native core tests passed 81 cases and Web tests passed 316 cases. TypeScript checking, the production build and architecture checks across 91 modules passed. macOS/Safari and physical-device touch interactions were not verified in this batch.

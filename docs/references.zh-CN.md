# 图表参考资料

[English](references.md) | [简体中文](references.zh-CN.md)

本文记录依据官方仓库和文档作出的设计取舍，资料核查时间为 2026-09-20 和 2026-09-21。除注明版本的链接外，仓库链接指向检查时的默认分支。

## 开源实现

| 参考项目 | 观察到的设计 | ZigChart 的取舍 |
| --- | --- | --- |
| [KLineChart](https://github.com/klinecharts/KLineChart) | 基于 Canvas 的图表实现，将图表、状态存储、图窗、事件和指标分别组织为组件。 | 借鉴共享图窗布局和明确的坐标转换；数据和几何逻辑保留在平台无关的 Zig 核心中。 |
| [KLineChart Pro](https://github.com/klinecharts/pro) | 基于 KLineChart 的应用外壳，提供品种搜索、历史 K 线、订阅和清理的数据提供方接口。 | 行情提供方集成置于图表核心之外；只实现 MVP 必需的提供方操作。 |
| [Lightweight Charts](https://github.com/tradingview/lightweight-charts) | 分离序列与时间轴 API，支持全量数据替换、最新 K 线更新，以及用于历史加载的逻辑范围查询。 | 明确定义更新顺序和视口锚点；所有已启用图窗使用统一横坐标系统。 |

已审阅的实现和 API 入口：

- KLineChart 的 [Chart.ts](https://github.com/klinecharts/KLineChart/blob/main/src/Chart.ts) 和 [DataLoader.ts](https://github.com/klinecharts/KLineChart/blob/main/src/common/DataLoader.ts)。图表统一计算图窗宽度；数据加载器将历史批次与实时订阅分开。
- KLineChart Pro 的 [types.ts](https://github.com/klinecharts/pro/blob/main/src/types.ts)（[源码](https://raw.githubusercontent.com/klinecharts/pro/main/src/types.ts)）。历史、订阅和取消订阅操作都携带品种与周期元数据。ZigChart 借鉴这种明确区分周期与生命周期的方式，采用自己的类型化接口、取消及请求代次检查。
- KLineChart 的[覆盖物指南](https://klinecharts.com/en-US/guide/overlay)描述了绘图生命周期、数据坐标点、控制点、选择、拖动事件、锁定和样式覆盖。ZigChart 将这些交互概念用于绘图编辑器，投影与命中检测保留在 Zig，文档编辑放在宿主。支持的工具和接口见[功能范围](feature-map.zh-CN.md)及[架构说明](architecture.zh-CN.md)。
- Lightweight Charts 的[序列 API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ISeriesApi) 和 [data-layer.ts](https://github.com/tradingview/lightweight-charts/blob/master/src/model/data-layer.ts)。`setData` 替换有序数据；`update` 通常替换最新时间戳的数据，或追加更新的数据。历史更新是单独显式启用的选项。逻辑范围查询支持在接近左边缘时请求历史。

ZigChart 的图表代码在本仓库中实现，所列项目用于参考设计和行为，未打包其源码、样式、图片或图表包。ZigChart 的接口和数值规则见[架构说明](architecture.zh-CN.md)，许可证信息见[第三方说明](../THIRD_PARTY.zh-CN.md)。

官方 Lightweight Charts 5.2 的[价格模式](https://tradingview.github.io/lightweight-charts/docs/api/enumerations/PriceScaleMode)、[十字线模式](https://tradingview.github.io/lightweight-charts/docs/api/enumerations/CrosshairMode)、[序列](https://tradingview.github.io/lightweight-charts/docs/series-types)及[插件](https://tradingview.github.io/lightweight-charts/docs/plugins/intro)文档，为[功能范围](feature-map.zh-CN.md)提供分类依据。ZigChart 分别规定了参考值、回退行为、数值范围和持久化规则。

Lightweight Charts 文档提供了[可调整尺寸的图窗](https://tradingview.github.io/lightweight-charts/docs/panes)和[以像素定义的最小 K 线间距](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/TimeScaleOptions#minbarspacing)。ZigChart 据此设计相邻图窗分隔线和随宽度变化的缩放边界。ZigChart 为可读性将相邻蜡烛中心的最小间距设为 6 个 CSS 像素，上游 `minBarSpacing` 默认值为 0.5 像素。图窗几何仍由 Zig 负责，宿主从同一共享帧和时间视口绘制至多四个内置图窗。

官方[序列 API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ISeriesApi#update)区分普通末根更新与显式请求的历史更新。ZigChart 提供批量 `correct` 操作，只修正已存在时间戳，执行原子校验并重算指标后缀。官方[序列类型](https://tradingview.github.io/lightweight-charts/docs/series-types)也包含基准线图。ZigChart 通过 Zig 价格投影与 Canvas 渲染器支持固定价格和首根可见收盘价参考。

官方[范围切换示例](https://tradingview.github.io/lightweight-charts/tutorials/demos/range-switcher)及[时间轴 API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ITimeScaleApi#setvisiblerange)为区分日期范围预设与 K 线周期提供参考。在 ZigChart 中，宿主加载合适的周期，Zig 在共享视口内适配时间戳。

十字线模式参考 [Lightweight Charts v5.2.0 magnet.ts](https://github.com/tradingview/lightweight-charts/blob/v5.2.0/src/model/magnet.ts)：Normal 保留指针价格，Magnet 使用收盘价，MagnetOHLC 从开盘、最高、最低和收盘价中选择。上涨与下跌蜡烛使用相同字段。ZigChart 默认自由移动，方便查看价格。

官方[图表截图 API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/IChartApi#takescreenshot)返回 Canvas，默认排除十字线。[v5.2.0 chart-widget.ts](https://github.com/tradingview/lightweight-charts/blob/v5.2.0/src/gui/chart-widget.ts) 先提交待处理重绘，再将图窗、分隔条和坐标轴位图合成为独立 Canvas。ZigChart 将复制后的帧及已提交绘图绘制到有界图片，增加本地化图表元数据并排除编辑反馈。

## 指标公式

TradingView 官方 [RSI](https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/) 和 [MACD](https://www.tradingview.com/support/solutions/43000502344-moving-average-convergence-divergence-macd-indicator/) 说明提供公式参考：RSI 比较平滑后的上涨和下跌幅度；MACD 为快均线减慢均线，包含信号均线，以及等于 MACD 减信号线的柱状图。ZigChart 为 MACD 的两条均线和信号线使用 EMA。

在 ZigChart 中，RSI 默认使用 14 次相邻收盘变化，以首个完整周期的平均上涨／下跌幅度作为初值，再使用 Wilder 平滑；完全持平的初值输出 50。MACD 默认为 12/26/9，各条 EMA 都以完整周期的 SMA 作为初值，包括信号 EMA 最先可用的 MACD 值。柱状图为 `MACD - signal`。预热期不可用值保持 NaN。RSI 图窗固定为 0–100，MACD 自动范围包含零。

TradingView 官方[布林带说明](https://www.tradingview.com/support/solutions/43000501840-bollinger-bands-bb/)记录了均线中轨与标准差上下轨，默认数据源为收盘价、长度 20、倍数 2。ZigChart 采用收盘 SMA、除以 `N` 的总体方差，完整窗口之前为 NaN。该除数由 ZigChart 选定，来源页面未作规定。图表支持一项 BB，按图表周期的收盘价计算，使用 SMA 中轨和零偏移。

## 产品参考

Advanced Charts 官方[必需数据接口方法](https://www.tradingview.com/charting-library-docs/latest/connecting_data/datafeed-api/required-methods/)区分品种搜索、元数据解析、历史及订阅。ZigChart 采用有限样本目录、绑定品种的数据源实例及可取消的会话换源。元数据保留在宿主，选择自选品种与管理成员相互独立。

TradingView 官方[文字绘图工具说明](https://www.tradingview.com/support/solutions/43000516983-text-drawing-tool/)介绍随图表滚动的点位文字、字体样式、换行、背景及边框。ZigChart 支持单个数据锚点上的有界纯文本，通过独立对话框编辑，由浏览器度量命中框并将数值传入 Zig。文字跟随图表锚点，按绘图文档的周期显示。

TradingView 的[日期与价格范围工具](https://www.tradingview.com/support/solutions/43000516996-date-and-price-range-drawing-tools/)及 [Shift 测量快捷方式](https://in.tradingview.com/support/solutions/43000537228-how-to-use-measure-tool-quickly/)介绍两点间的价格／时间统计和键盘入口。ZigChart 的临时标尺报告有符号间隔、含首尾 K 线数量／成交量及真实 UTC 差，精度限制由核心规定。

TradingView 官方 [K 线回放指南](https://www.tradingview.com/support/solutions/43000474024-how-do-i-turn-bar-replay-on/)介绍选择起始蜡烛、播放／暂停、调整速度、单步、重选和返回当前数据，为 ZigChart 的回放工具栏提供参考。回放是数据提供方的可选能力，采用排他截止时间、模拟局部分钟规则及按周期单步，作用于当前图表。

TradingView 的[射线](https://www.tradingview.com/support/solutions/43000518113-ray-drawing-tool/)、[双向延长线](https://www.tradingview.com/support/solutions/43000518131-extended-line-drawing-tool/)、[水平射线](https://www.tradingview.com/support/solutions/43000518121-horizontal-ray-drawing-tool/)及[垂直线](https://www.tradingview.com/support/solutions/43000518093-vertical-line-drawing-tool/)页面提供绘图分类与编辑惯例。ZigChart 在 Zig 中计算几何，由宿主管理文档和手势。

Lightweight Charts 在 [HandleScaleOptions](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/HandleScaleOptions) 中提供价格轴／时间轴拖动、滚轮缩放及双击重置选项，通过 [PriceScaleOptions](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/PriceScaleOptions) 定义自动适配。ZigChart 的坐标轴控制器采用这些交互惯例：时间轴拖动锚定右端，双击时间轴跟随最新 K 线。Zig 计算共享变换、逆向坐标及易读刻度，浏览器处理输入与格式化。

[Lightweight Charts 图表组件](https://github.com/tradingview/lightweight-charts/blob/master/src/gui/chart-widget.ts)会跳过尺寸未变化的工作，并将失效请求合并到绘制调度中。ZigChart 合并分隔条输入，在绘制前同步提交 Canvas 尺寸。上游的图窗生命周期和逐序列设置，也为可选、独立配置的指标提供参考。

[fuchenru/TradingHero](https://github.com/fuchenru/TradingHero)描述的是集成 TradingView 可视化的股票分析应用，它与 tradinghero.com 的关系尚未确认。仓库和产品截图作为两项资料分别参考，截图用于借鉴控件分组和视觉层次。

[MetaTrader 5 图表文档](https://www.metatrader5.com/en/trading-platform/charts)和[技术分析文档](https://www.metatrader5.com/en/trading-platform/technical-analysis)为易读的 OHLC 信息、叠加在价格图上或采用独立比例的指标、手动缩放，以及可复用的图表设置提供参考。ZigChart 在本地保存外观偏好和绘图文档。交易、脚本、完整工作区保存和策略测试属于图表 MVP 之外的范围。再分发平台、视觉素材或源码须取得相应授权。

[TradingView](https://www.tradingview.com/) 是产品参考，与其开源 Lightweight Charts 库应分别看待。[官方产品对比](https://www.tradingview.com/charting-library-docs/latest/product-comparison/)区分了托管组件、Lightweight Charts 和 Advanced Charts。这两个图表库本身均不包含市场数据。托管组件使用 TradingView 托管的数据，不接受任意替换行情源。

[Advanced Charts 数据接口文档](https://www.tradingview.com/charting-library-docs/latest/connecting_data/Datafeed-API/)列出了 ZigChart 数据契约中处理的集成情形：有序历史 K 线、显式的历史结束标志、指标预热所需的历史、完整替换当前 K 线，以及各自独立的订阅生命周期。

[周期文档](https://www.tradingview.com/charting-library-docs/latest/core_concepts/Resolution/)区分分钟／小时周期和日历单位，并将可选范围与数据源能力关联。ZigChart 的周期目录列出合成提供方能够交付的周期，最小为一分钟。聚合采用 UTC，周从周一开始，月遵循自然月边界。截图和产品界面用于参考工作台信息密度和控件位置。

Advanced Charts 有单独的使用条款：[介绍页面](https://www.tradingview.com/charting-library-docs/latest/introduction/)说明，在公开环境中保留可见署名可以免费使用，但不包括私有或付费访问场景。不能假设 Lightweight Charts 的许可证同样覆盖 Advanced Charts、TradingView 网站或其市场数据。

TradingView 的[斐波那契回撤说明](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/)描述双点回撤、可配置比例、延伸、反向及可选对数计算。这是 TradingView 产品中的功能，与 Lightweight Charts 分开。ZigChart 的数值规则、边界及对象控件在 `core/fibonacci.zig` 和 `features/drawings/fibonacci-*` 中实现。

官方 [HandleScaleOptions](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/HandleScaleOptions) 与 [HandleScrollOptions](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/HandleScrollOptions) 将捏合缩放和触摸拖动作为不同控制项。ZigChart 的触摸控制器使用共享 Zig 视口，规定接管／松指规则并合并指针移动。手势测试使用模拟触点和 Wasm 桥接，设备检查见[验证步骤](verification.zh-CN.md#浏览器检查清单)。

## 评估顺序

首先验证历史前插、当前 K 线替换、指标初始化、无效输入和主副图对齐。随后在相同负载下比较候选实现，记录浏览器版本、硬件、视口尺寸、设备像素比、保留／可见 K 线数量、更新速率和测量方法。核心计算耗时与输入到显示的延迟分别测量。

ZigChart 采用 Zig + WebAssembly + TypeScript + Canvas 2D。浏览器渲染器作为单独模块，可以在保留平台无关核心的基础上演进。

# 图表参考资料

[English](references.md) | [简体中文](references.zh-CN.md)

于 2026-09-20 依据下列官方仓库和文档核查。仓库链接指向检查时的默认分支，内容可能变化。这是源码和文档审阅，不是运行性能对比，也不代表已经实现同等功能。

## 开源实现

| 参考项目 | 观察到的设计 | ZigChart 的取舍 |
| --- | --- | --- |
| [KLineChart](https://github.com/klinecharts/KLineChart) | 基于 Canvas 的图表实现，将图表、状态存储、图窗、事件和指标分别组织为组件。 | 借鉴共享图窗布局和明确的坐标转换；数据和几何逻辑保留在平台无关的 Zig 核心中。 |
| [KLineChart Pro](https://github.com/klinecharts/pro) | 基于 KLineChart 的应用外壳，提供品种搜索、历史 K 线、订阅和清理的数据提供方接口。 | 行情提供方集成置于图表核心之外；只实现 MVP 必需的提供方操作。 |
| [Lightweight Charts](https://github.com/tradingview/lightweight-charts) | 分离序列与时间轴 API，支持全量数据替换、最新 K 线更新，以及用于历史加载的逻辑范围查询。 | 明确定义更新顺序和视口锚点；所有已启用图窗使用统一横坐标系统。 |

已审阅的实现和 API 入口：

- KLineChart 的 [Chart.ts](https://github.com/klinecharts/KLineChart/blob/main/src/Chart.ts) 和 [DataLoader.ts](https://github.com/klinecharts/KLineChart/blob/main/src/common/DataLoader.ts)。图表统一计算图窗宽度；数据加载器将历史批次与实时订阅分开。
- KLineChart Pro 的 [types.ts](https://github.com/klinecharts/pro/blob/main/src/types.ts)（[源码](https://raw.githubusercontent.com/klinecharts/pro/main/src/types.ts)）。历史、订阅和取消订阅操作都携带品种与周期元数据。ZigChart 借鉴这种明确区分周期与生命周期的方式，采用自己的类型化接口、取消及请求代次检查。
- KLineChart 的[覆盖物指南](https://klinecharts.com/en-US/guide/overlay)描述了绘图生命周期、数据坐标点、控制点、选择、拖动事件、锁定和样式覆盖。ZigChart 将这些交互概念用于独立实现的绘图编辑器，投影与命中检测保留在 Zig，文档编辑放在宿主。没有实现 KLineChart 的覆盖物 API 或完整工具集。
- Lightweight Charts 的[序列 API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ISeriesApi) 和 [data-layer.ts](https://github.com/tradingview/lightweight-charts/blob/master/src/model/data-layer.ts)。`setData` 替换有序数据；`update` 通常替换最新时间戳的数据，或追加更新的数据。历史更新是单独显式启用的选项。逻辑范围查询支持在接近左边缘时请求历史。

上述项目仅作为工程参考。MVP 未包含这些项目的实现、样式、图片或图表包。以上实施取舍是我们审阅后的结论，不是参考项目提供的保证。许可边界见[第三方说明](../THIRD_PARTY.zh-CN.md)。

另于 2026-09-21 核查了官方 Lightweight Charts 5.2 的[价格模式](https://tradingview.github.io/lightweight-charts/docs/api/enumerations/PriceScaleMode)、[十字线模式](https://tradingview.github.io/lightweight-charts/docs/api/enumerations/CrosshairMode)、[序列](https://tradingview.github.io/lightweight-charts/docs/series-types)及[插件](https://tradingview.github.io/lightweight-charts/docs/plugins/intro)文档。[功能范围](feature-map.zh-CN.md)采用这些分类，区分已实现、部分实现及待实现能力。ZigChart 自行定义基准、回退、数值范围及持久化契约；模式名称相同不代表边界行为完全一致或 API 兼容。

Lightweight Charts 文档提供了[可调整尺寸的图窗](https://tradingview.github.io/lightweight-charts/docs/panes)和[以像素定义的最小 K 线间距](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/TimeScaleOptions#minbarspacing)。ZigChart 据此设计相邻图窗分隔线和随宽度变化的缩放边界。相邻蜡烛中心 6 个 CSS 像素的限制是 ZigChart 为可读性选择的值；上游 `minBarSpacing` 默认值是 0.5 像素，并非 6。图窗几何仍由 Zig 负责，宿主从同一共享帧和时间视口绘制至多四个内置图窗。

官方[序列 API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ISeriesApi#update)区分普通末根更新与显式请求的历史更新。ZigChart 独立增加批量 `correct` 操作，只修正已存在时间戳，执行原子校验并重算指标后缀。官方[序列类型](https://tradingview.github.io/lightweight-charts/docs/series-types)也包含基准线图。ZigChart 通过自身的 Zig 价格投影与 Canvas 渲染器支持固定价格和首根可见收盘价参考。这些是行为参考，不表示引入源码或兼容其 API。

于 2026-09-21 审阅官方[范围切换示例](https://tradingview.github.io/lightweight-charts/tutorials/demos/range-switcher)及[时间轴 API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ITimeScaleApi#setvisiblerange)。ZigChart 独立区分日期范围预设与 K 线周期：宿主加载合适的实际周期，Zig 在共享视口内适配时间戳；未引入示例源码。

于 2026-09-21 对照 [Lightweight Charts v5.2.0 magnet.ts](https://github.com/tradingview/lightweight-charts/blob/v5.2.0/src/model/magnet.ts) 核查十字线行为。Normal 保留指针价格，Magnet 使用收盘价，MagnetOHLC 从开盘、最高、最低和收盘价中选择；蜡烛涨跌不会改变所选字段。ZigChart 独立实现这些选项，默认自由移动以方便查看价格。

于 2026-09-21 审阅官方[图表截图 API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/IChartApi#takescreenshot)及固定版本 [v5.2.0 chart-widget.ts](https://github.com/tradingview/lightweight-charts/blob/v5.2.0/src/gui/chart-widget.ts)。API 返回 Canvas，默认排除十字线；该源码先提交待处理重绘，再将图窗、分隔条和坐标轴位图合成为独立 Canvas。ZigChart 独立将复制后的帧及已提交绘图绘制到有界图片，增加本地化图表元数据并排除编辑反馈。这是行为参考，未引入截图实现或 API。

## 指标公式

于 2026-09-21 核查了 TradingView 官方 [RSI](https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/) 和 [MACD](https://www.tradingview.com/support/solutions/43000502344-moving-average-convergence-divergence-macd-indicator/) 说明。它们提供公式参考：RSI 比较平滑后的上涨和下跌幅度；MACD 为快均线减慢均线，包含信号均线，以及等于 MACD 减信号线的柱状图。ZigChart 独立实现这些计算，并为 MACD 的两条均线和信号线选择 EMA。

ZigChart 明确定义初始化契约：RSI 默认使用 14 次相邻收盘变化，以首个完整周期的平均上涨／下跌幅度作为初值，再使用 Wilder 平滑；完全持平的初值输出 50。MACD 默认为 12/26/9，各条 EMA 都以完整周期的 SMA 作为初值，包括信号 EMA 最先可用的 MACD 值。柱状图不乘二。预热期不可用值保持 NaN。RSI 图窗固定为 0–100，MACD 自动范围包含零。这些本地初值、持平行情及范围规则不代表与 TradingView 的数值或修订行为完全一致。

于 2026-09-21 核查的 TradingView 官方[布林带说明](https://www.tradingview.com/support/solutions/43000501840-bollinger-bands-bb/)记录了均线中轨与标准差上下轨，默认数据源为收盘价、长度 20、倍数 2。ZigChart 独立规定采用收盘 SMA、除以 `N` 的总体方差，完整窗口之前为 NaN。来源页面未明确该除数，它是本项目的显式契约。只支持一项 BB，不含其他数据源／中轨类型、偏移或独立计算周期。未引入源码，不声称与该平台完全一致。

## 产品参考

于 2026-09-21 审阅 Advanced Charts 官方[必需数据接口方法](https://www.tradingview.com/charting-library-docs/latest/connecting_data/datafeed-api/required-methods/)，其区分品种搜索、元数据解析、历史及订阅。ZigChart 独立采用有限样本目录、绑定品种的数据源实例及可取消的会话换源。元数据保留在宿主，选择自选品种与管理成员相互独立。这是设计参考，没有引入或复刻 Advanced Charts 的 API 及实现。

于 2026-09-21 审阅 TradingView 官方[文字绘图工具说明](https://www.tradingview.com/support/solutions/43000516983-text-drawing-tool/)，其中介绍随图表滚动的点位文字、字体样式、换行、背景及边框。ZigChart 以单个数据锚点、有界纯文本、独立编辑对话框及传入 Zig 的浏览器度量数值边界，独立实现这些常用行为。固定屏幕位置文字、图表内直接编辑及通用周期可见性规则尚未实现；未引入源码或素材，不声称与该平台完全一致。

于 2026-09-21 审阅 TradingView 的[日期与价格范围工具](https://www.tradingview.com/support/solutions/43000516996-date-and-price-range-drawing-tools/)及 [Shift 测量快捷方式](https://in.tradingview.com/support/solutions/43000537228-how-to-use-measure-tool-quickly/)，其介绍两点间的价格／时间统计和键盘入口。ZigChart 独立实现临时标尺，在自己的核心中明确有符号间隔、含首尾 K 线数量／成交量、真实 UTC 差及精度限制。这些端点规则属于本项目契约，不代表与平台完全一致；不包含持久化范围绘图、tick／pip 推断及完整样式编辑器，未引入源码或素材。

于 2026-09-21 审阅 TradingView 官方 [K 线回放指南](https://www.tradingview.com/support/solutions/43000474024-how-do-i-turn-bar-replay-on/)，其中介绍选择起始蜡烛、播放／暂停、调整速度、单步、重选和返回当前数据。这些行为指导 ZigChart 独立实现的回放工具栏；可选提供方能力、排他截止时间、模拟局部分钟规则及按周期单步属于本项目契约。多图回放与模拟交易尚未实现，未引入产品代码或素材。

TradingView 的[射线](https://www.tradingview.com/support/solutions/43000518113-ray-drawing-tool/)、[双向延长线](https://www.tradingview.com/support/solutions/43000518131-extended-line-drawing-tool/)、[水平射线](https://www.tradingview.com/support/solutions/43000518121-horizontal-ray-drawing-tool/)及[垂直线](https://www.tradingview.com/support/solutions/43000518093-vertical-line-drawing-tool/)页面提供绘图分类与编辑惯例。ZigChart 在 Zig 中独立实现基础几何，由宿主管理文档和手势。箭头、标签、跨图窗垂直同步及完整的上游样式／可见性选项尚未实现。

Lightweight Charts 在 [HandleScaleOptions](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/HandleScaleOptions) 中提供价格轴／时间轴拖动、滚轮缩放及双击重置选项，通过 [PriceScaleOptions](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/PriceScaleOptions) 定义自动适配。这些文档提供了 ZigChart 独立坐标轴控制器采用的交互惯例。ZigChart 选择时间轴拖动锚定右端、双击时间轴跟随最新，这些是明确的本地契约。Zig 计算共享变换、逆向坐标及易读刻度，浏览器处理输入与格式化。未复制上游实现，也不代表 API 兼容。

[Lightweight Charts 图表组件](https://github.com/tradingview/lightweight-charts/blob/master/src/gui/chart-widget.ts)会跳过尺寸未变化的工作，并将失效请求合并到绘制调度中。ZigChart 独立实现分隔条输入合并，在绘制前同步提交 Canvas 尺寸；其图窗生命周期和逐序列设置也为可选、独立配置的指标提供参考。这不代表 API 兼容或性能相当。

[fuchenru/TradingHero](https://github.com/fuchenru/TradingHero)描述的是集成 TradingView 可视化的股票分析应用，未确认它是 tradinghero.com 的源码，本项目不将其用作图表实现。产品截图用于参考控件分组和视觉层次，没有引入品牌素材或专有样式。

[MetaTrader 5 图表文档](https://www.metatrader5.com/en/trading-platform/charts)和[技术分析文档](https://www.metatrader5.com/en/trading-platform/technical-analysis)展示了有用的产品惯例：易读的 OHLC 信息、叠加在价格图上或采用独立比例的指标、手动缩放，以及可复用的图表设置。这些可用于指导易用性改进。交易、脚本、保存完整工作区和策略测试仍在本 MVP 范围之外；本地外观偏好和绘图文档独立实现。产品页面并不授予再分发平台、视觉素材或源码的权利。

[TradingView](https://www.tradingview.com/) 是产品参考，与其开源 Lightweight Charts 库应分别看待。[官方产品对比](https://www.tradingview.com/charting-library-docs/latest/product-comparison/)区分了托管组件、Lightweight Charts 和 Advanced Charts。这两个图表库本身均不包含市场数据。托管组件使用 TradingView 托管的数据，不接受任意替换行情源。

[Advanced Charts 数据接口文档](https://www.tradingview.com/charting-library-docs/latest/connecting_data/Datafeed-API/)有助于识别集成边界情况：有序历史 K 线、显式的历史结束标志、指标预热所需的历史、完整替换当前 K 线，以及各自独立的订阅生命周期。ZigChart 定义自己的协议，不承诺 API 兼容。

[周期文档](https://www.tradingview.com/charting-library-docs/latest/core_concepts/Resolution/)区分分钟／小时周期和日历单位，并将可选范围与数据源能力关联。ZigChart 的受支持周期目录只列出合成提供方能够交付的周期。其 UTC 聚合、周一开始的周、自然月及不提供秒级周期，都是独立实现且明确声明的样本规则，不代表兼容 TradingView 的重采样行为。截图和产品界面用于参考工作台信息密度和控件位置；没有复制专有素材、代码或样式。

Advanced Charts 有单独的使用条款：[介绍页面](https://www.tradingview.com/charting-library-docs/latest/introduction/)说明，在公开环境中保留可见署名可以免费使用，但不包括私有或付费访问场景。不能假设 Lightweight Charts 的许可证同样覆盖 Advanced Charts、TradingView 网站或其市场数据。

TradingView 的[斐波那契回撤说明](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/)描述双点回撤、可配置比例、延伸、反向及可选对数计算。它是产品行为参考，不属于 Lightweight Charts。ZigChart 在 `core/fibonacci.zig` 和 `features/drawings/fibonacci-*` 中独立定义并实现数值规则、边界及对象控件；没有引入其实现或图像素材。

官方 [HandleScaleOptions](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/HandleScaleOptions) 与 [HandleScrollOptions](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/HandleScrollOptions) 将捏合缩放和触摸拖动作为不同控制项。ZigChart 的独立触摸控制器保留共享 Zig 视口，明确接管／松指规则并合并指针移动。设备验证、惯性及长按追踪仍需单独推进。

## 评估顺序

首先确保历史前插、当前 K 线替换、指标初始化、无效输入和主副图对齐的行为确定。随后在候选实现上测量相同负载，再进行性能比较。记录浏览器版本、硬件、视口尺寸、设备像素比、保留／可见 K 线数量、更新速率和测量方法。仅有更快的核心计算，不能证明输入到显示的延迟更低，也不能证明端到端图表性能更好。

初版 Zig + WebAssembly + TypeScript + Canvas 2D 实现保留了替换浏览器渲染器的能力，但不要求未来迁移渲染器。本 MVP 不声称优于任何竞品。

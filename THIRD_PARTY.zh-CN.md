# 第三方范围与来源说明

[English](THIRD_PARTY.md) | [简体中文](THIRD_PARTY.zh-CN.md)

第三方核查日期：2026-09-20。ZigChart 原创源码采用 [Apache-2.0](LICENSE)。本文件记录第三方组件及参考资料，不替代各自的许可条款，也不证明本项目适合任何商业分发场景。

## 图表参考项目，并非依赖

本 MVP 未引入第三方图表实现、图表素材或采购行情数据。图表运行时代码在本仓库内实现。以下项目仅作为设计参考进行研究：

| 项目 | 已核实的许可来源 | 复用注意事项 |
| --- | --- | --- |
| KLineChart | [Apache-2.0 LICENSE](https://github.com/klinecharts/KLineChart/blob/main/LICENSE) | 采用代码前应检查其 [NOTICE](https://github.com/klinecharts/KLineChart/blob/main/NOTICE)，其中同时提及 KLineChart 和 TradingView Lightweight Charts；还须检查文件级及随包声明。 |
| KLineChart Pro | [Apache-2.0 LICENSE](https://github.com/klinecharts/pro/blob/main/LICENSE) | 复用前应核查具体版本及其依赖；顶层许可证不能代替依赖审查。 |
| Lightweight Charts | [Apache-2.0 LICENSE](https://github.com/tradingview/lightweight-charts/blob/master/LICENSE) | 其 [README 许可章节](https://github.com/tradingview/lightweight-charts#license)要求提供用户可见的署名和 TradingView 链接。采用前须检查其 [NOTICE](https://github.com/tradingview/lightweight-charts/blob/master/NOTICE) 及随包第三方代码。 |

Apache-2.0 允许遵照条款再分发，包括保留许可证、适用声明及修改说明，也包含专利和商标条款。后续采用时必须保留所需材料；仅在此文档中放置来源链接不能代替履行这些要求。不会仅因研究过某个项目而在应用中加入该图表项目的署名。

MetaTrader 5、TradingView 网站、Advanced Charts 和行情订阅属于独立产品及权利范围。其公开文档是参考资料，并非复制实现或再分发行情数据的授权。详情和来源链接见[参考资料](docs/references.zh-CN.md)。

## 开发工具链

构建使用 Zig、TypeScript 和 Vite。直接 JavaScript 开发依赖及其精确版本记录在 `package.json` 中；`package-lock.json` 记录解析后的依赖关系图。不需要图表运行时依赖包。

- Zig：[MIT 许可证](https://github.com/ziglang/zig/blob/0.15.2/LICENSE)。再分发编译器或随附库时，应检查发行包中的组件声明。
- TypeScript：[Apache-2.0 许可证](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt)。
- Vite：[MIT 许可证](https://github.com/vitejs/vite/blob/main/LICENSE)。

这些链接标识直接工具，不会列出全部传递依赖，也不能替代已安装软件包内附的许可证。发布打包版本前，应检查锁定的软件包版本和实际发布产物，保留所需许可证及声明，并为包含的运行时组件更新本文件。漏洞扫描与许可审查是不同工作。

## Web 构建随附声明

Vite 会将 [web/public/third-party-notices.txt](web/public/third-party-notices.txt) 复制到 `dist/third-party-notices.txt`。再分发生产文件时应保留此文件。它保留了编译到 `core.wasm` 中的 Zig 0.15.2 库代码，以及 Vite 8.3.0 / Rolldown 1.2.9 生成的 modulepreload 辅助代码所需的 MIT 条款和版权声明。

声明文件中的上游法律文本保留英文原文不变。本文的译文仅解释适用范围和义务，不能替代原始声明或许可条款。

虽然项目未声明运行时软件包依赖，生产 JavaScript 中仍包含上述辅助代码。[Rolldown 插件文档](https://github.com/rolldown/rolldown/blob/main/crates/rolldown_plugin_vite_module_preload_polyfill/README.md)说明它源自 es-module-shims；随附声明也保留了 Guy Bedford 的上游版权。本地 Zig、Vite 和 Rolldown 许可文件已按所安装版本核对。此记录仅覆盖这些已包含的组件，不覆盖完整编译器或整个开发工具依赖关系图的再分发。

## 添加第三方内容

复制代码或素材前，记录精确来源地址与版本、用途、许可证和声明文件、本地位置及修改内容。优先采用接口范围小、可替换的依赖。升级版本时重新核查许可兼容性。采购数据、凭据及行情提供方的保密材料不得进入公开版本控制。

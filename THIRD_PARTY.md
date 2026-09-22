# Third-party scope and source references

[English](THIRD_PARTY.md) | [简体中文](THIRD_PARTY.zh-CN.md)

Third-party review date: 2026-09-20. ZigChart's original source is covered by [Apache-2.0](LICENSE). This file records third-party components and references; it does not replace their license terms or certify suitability for any commercial distribution.

## Chart references, not dependencies

No third-party chart implementation, chart assets, or purchased market data is vendored in this MVP. The chart runtime is implemented in this repository. The following projects were reviewed as design references:

| Project | Verified license source | Reuse considerations |
| --- | --- | --- |
| KLineChart | [Apache-2.0 LICENSE](https://github.com/klinecharts/KLineChart/blob/main/LICENSE) | Review the [NOTICE](https://github.com/klinecharts/KLineChart/blob/main/NOTICE), which names both KLineChart and TradingView Lightweight Charts, plus any file-level and bundled notices before adopting code. |
| KLineChart Pro | [Apache-2.0 LICENSE](https://github.com/klinecharts/pro/blob/main/LICENSE) | Review the exact release and its dependencies before reuse; the top-level license alone is not a dependency audit. |
| Lightweight Charts | [Apache-2.0 LICENSE](https://github.com/tradingview/lightweight-charts/blob/master/LICENSE) | Its [README license section](https://github.com/tradingview/lightweight-charts#license) calls for user-visible attribution and a TradingView link. Inspect its [NOTICE](https://github.com/tradingview/lightweight-charts/blob/master/NOTICE) and bundled third-party code before adoption. |

Apache-2.0 allows redistribution subject to its terms, including license and applicable notice retention and notices of changes. It also contains patent and trademark provisions. Any later adoption must preserve required material; linking a source in this document is not a substitute. No chart attribution is added to the application merely because a project was studied.

MetaTrader 5, TradingView's website, Advanced Charts, and market-data subscriptions are separate products and rights. Their public documentation is a reference, not permission to copy implementations or redistribute data. Details and source links are in [docs/references.md](docs/references.md).

## Development toolchain

The build uses Zig, TypeScript, and Vite. Direct JavaScript development dependencies and their exact versions are recorded in `package.json`; `package-lock.json` records the resolved dependency graph. No chart runtime package is required.

- Zig: [MIT license](https://github.com/ziglang/zig/blob/0.15.2/LICENSE). Review the distribution's component notices if redistributing the compiler or bundled libraries.
- TypeScript: [Apache-2.0 license](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt).
- Vite: [MIT license](https://github.com/vitejs/vite/blob/main/LICENSE).

These links identify the direct tools; they do not enumerate the full transitive dependency graph or replace the licenses distributed with installed packages. Before publishing a packaged release, inspect the locked package versions and actual shipped output, retain required licenses/notices, and update this file for any included runtime component. A vulnerability scan is separate from a license review.

## Notices shipped with the Web build

[web/public/third-party-notices.txt](web/public/third-party-notices.txt) is copied to `dist/third-party-notices.txt` by Vite. Keep it with redistributed production files. It preserves the MIT terms and copyright notices for Zig 0.15.2 library code compiled into `core.wasm` and the modulepreload helper emitted by Vite 8.3.0 / Rolldown 1.2.9.

Keep the upstream legal text in that notice file unchanged in English. Translations in this document explain scope and obligations; they do not replace the original notices or license terms.

The production JavaScript contains that helper even though the project declares no runtime package dependencies. The [Rolldown plugin documentation](https://github.com/rolldown/rolldown/blob/main/crates/rolldown_plugin_vite_module_preload_polyfill/README.md) identifies its es-module-shims origin; the shipped notice also retains Guy Bedford's upstream copyright. Local Zig, Vite, and Rolldown license files were checked against the installed versions. This targeted record covers those included components, not redistribution of the complete compiler or development-tool dependency graph.

## Adding third-party material

Record the exact source URL and version, its purpose, license and notice files, local destination, and modifications before copying code or assets. Prefer replaceable dependencies with a narrow interface. Recheck license compatibility when changing versions. Keep paid data, credentials, and provider-specific confidential material outside public version control.

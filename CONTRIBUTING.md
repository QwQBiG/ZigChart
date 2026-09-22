# Contributing

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md)

Read [AGENTS.md](AGENTS.md), the [architecture](docs/architecture.md), and the [data contract](docs/data-contract.md) before changing interfaces. ZigChart uses the [Apache License 2.0](LICENSE). Contributions must be compatible with that license.

## Development workflow

1. Use the versions and setup commands in [README.md](README.md). Inspect the current worktree and preserve unrelated changes.
2. Keep a change focused on a concrete behavior. Update contracts whenever data semantics, the Wasm ABI, or memory ownership changes. Update the English and Simplified Chinese documentation together whenever their subject changes.
3. Add tests for meaningful invariants or regression cases. Prefer deterministic fixtures with explicit expected values.
4. Run `npm run check:architecture`, `npm test` and `npm run build`. Run `npm run check:docs` for documentation changes. After UI changes, use the [browser verification checklist](docs/verification.md) and inspect browser errors.
5. Review the complete net diff, including new files, before requesting review. State what ran, its result, and what remains unverified.

Use English in source code, identifiers, and code comments. Issues may use English or Simplified Chinese; commit and pull request descriptions must include both languages. Maintain documentation in English and Simplified Chinese: the English file keeps its original name, and its counterpart uses `.zh-CN.md`. Each pair must provide language links, matching facts, examples, source links, and limitations. Link to the matching language for local documentation. Keep the shared `AGENTS.md` and pull request template bilingual in one file; preserve upstream legal notices verbatim. All text files use UTF-8 and LF, including scripts; `.editorconfig` and `.gitattributes` define the policy for Windows and Unix checkouts. Keep comments about present behavior and maintenance constraints.

`check:docs` checks document pairs, reciprocal language links, and local links. With `DOCS_BASE_REF` set to the comparison commit, it also checks that both members of a changed pair were updated; CI supplies this reference when available. These structural checks cannot prove semantic equivalence. Review the translations for matching meaning before requesting review.

## Boundaries

- Import provider types from `web/src/data/contracts.ts`; keep data dependencies within `data/`. Reusable modules must not import `app/`; `main.ts` is the bootstrap exception. Keep plot interaction ownership in `app/chart-input.ts` and reject relative runtime dependency cycles with `npm run check:architecture`.
- Keep browser APIs, networking, and Canvas calls out of `core/`.
- Keep numeric data exchange batched and version the ABI when its contract changes.
- Never retain a borrowed Wasm memory view across calls. The TypeScript bridge returns copied output.
- Validate the whole batch before mutation; preserve ordering, update semantics, and viewport anchoring.
- Preserve indicator warm-up gaps and test replacement/prepend behavior as well as appends.
- Put provider normalization at the host boundary. Paid data, credentials, and private configuration belong outside version control. A browser bundle cannot keep an embedded credential secret.
- Keep future scripting and strategy execution behind host boundaries. Do not add these systems to the chart MVP.

## Dependencies and review

Pin direct dependencies, update the lockfile intentionally, and inspect the actual shipped output. Before adopting code or assets, record sources and verify licenses and notices as described in [THIRD_PARTY.md](THIRD_PARTY.md). License changes require the owner's review and approval.

Write about the current result, the reason for the change and the checks performed. Describe each fact once, alongside the feature or decision it explains. Include constraints that affect use, compatibility, security or interpretation of results. Keep discarded approaches and conversation history out of product documentation. GitHub provides the file diff; link it from review discussions. Performance results must include reproducible measurements, environment and workload.

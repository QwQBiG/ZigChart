# Data contract

[English](data-contract.md) | [简体中文](data-contract.zh-CN.md)

## Normalized bars and metadata

A bar is a complete OHLCV snapshot with numeric fields `time`, `open`, `high`, `low`, `close`, and `volume`. Partial field patches and raw ticks are not accepted. Instrument metadata stays in the host: `symbol`, `name`, `priceScale`, `volumeScale`, and `intervalMs`. For the sample, `intervalMs` describes the canonical one-minute source. The selected `PeriodId` is separate metadata; a calendar month has no constant millisecond duration.

| Field | Core acceptance | Meaning |
| --- | --- | --- |
| `time` | Integer, 0 through 8,640,000,000,000,000 | UTC epoch milliseconds at the bar's start; within the nonnegative JavaScript Date range |
| OHLC | Integers, -1,000,000,000,000 through 1,000,000,000,000 | Price units; displayed price is units divided by `priceScale` |
| `volume` | Integer, 0 through 1,000,000,000,000 | Cumulative volume units for the bar; display divides by `volumeScale` |

All fields must be finite. Low must be no greater than open or close; high must be no less than open or close. These conditions also enforce high >= low. Negative prices and zero volume are valid. These integer ranges are exactly representable in `f64`/JavaScript numbers; indicator results may be fractional and are not order-entry prices.

Choose consistent positive safe-integer scales before loading an instrument. The host formatter requires a reciprocal that terminates within 20 decimal places: only factors 2 and 5 are allowed. For example, scales 8, 32, and 1,000,000,000 preserve units of 0.125, 0.03125, and 0.000000001; invalid or unsupported scales throw. Normalize decimal provider values into integer units before calling the bridge; do not depend on arbitrary floating-point rounding to determine ticks. Reject values that cannot be represented under the selected scale and bounds. The core does not receive metadata or validate tick size, interval alignment, sessions, currency, adjustments, or exchange rules. The adapter is responsible for these semantics.

Changing instrument, scale, interval, or adjustment regime requires a coherent replacement snapshot or a new chart instance. Do not combine incompatible series. Uniform bar-index spacing compresses timestamp gaps; the MVP does not construct session calendars or missing bars.

## Atomic operations

Each batch must be in strictly increasing timestamp order with no duplicates. The core does not sort, deduplicate, or merge overlapping history. It validates the whole batch and storage limit before mutation; failure preserves existing bars, indicators, and viewport.

| Operation | Accepted data | Result |
| --- | --- | --- |
| `replace` | Any valid ordered batch, including empty | Replace all bars, recalculate indicators, and restore the default following view with approximately 20% right spacing |
| `prepend` | Every timestamp strictly older than the first retained bar | Insert historical bars, recalculate indicators, and offset the viewport to preserve its anchor within bounds |
| `upsert` | First timestamp equal to or newer than the latest retained bar; remaining timestamps strictly newer | Replace the final bar when equal, then append any newer bars; recompute the changed indicator suffix |
| `correct` | Every timestamp already exists in the loaded series, including its final bar | Replace complete rows atomically; recompute all affected indicator suffixes without moving the viewport |

An empty prepend/upsert is a no-op. Prepend/upsert can initialize an empty engine. Total retained bars and individual input batches are limited to 100,000. Exceeding capacity returns an error; there is no eviction.

An upsert replaces the entire current bar, including its cumulative volume. Sending the same bar twice is idempotent; volume is not added twice. The core does not require each replacement to increase high/volume, because a provider can correct the current snapshot. A newer timestamp makes preceding bars historical; there is no separate finalization flag.

An append preserves the existing right spacing when the newest edge was already visible: the viewport start increases by the number of appended bars. A view panned into older history remains anchored, and replacing the final candle without appending leaves the viewport unchanged. The default following view places the latest candle's center at 80% of the plot width; panning permits it as far left as 50%. The viewport's zero lower bound can limit exact placement for short histories. **Latest** or `End` restores the default spacing. See [Architecture](architecture.md#coordinates-and-interaction) for the exact bounds. Blank space beyond the retained series changes neither stored data nor timestamps; hit testing there returns `-1`.

Upsert rejects a timestamp older than the final retained bar. Use explicit `correct` batches for already loaded timestamps. Corrections cannot insert, delete, or change timestamps; a missing target rejects the entire batch. Empty or identical corrections are no-ops. Binary searches validate all targets before mutation, then indicators recompute once from the earliest changed index. Cost grows with the affected suffix; early-history corrections are more expensive than latest-bar revisions. Bar count, time viewport, follow position, pane weights and locked raw ranges stay unchanged; automatic ranges reflect revised values on the next frame. Corrections invalidate cached geometry and preserve the host's last-bar completion flag.

Changes to the instrument, scale or adjustment regime still require a coherent replacement snapshot. Automatic correction queues, reconnect recovery, and sequence-gap recovery are not implemented. Provider revisions have no sequence number in this ABI: the adapter must reconcile stale/out-of-order snapshots, including any history request racing with corrections, before delivery.

## Host adapter interface

History pages may include `asOf`, the exclusive UTC millisecond snapshot cutoff, independent of candle resolution and later than the final returned bar's start. Invalid cutoffs reject the page. The sample supplies it so selecting a range from a partial monthly bar cannot advance the market clock to month end. Without it, completed bars use the next bucket boundary; a partial bar conservatively uses its start plus one millisecond. Live updates advance this bound only with known bar timestamps/completion; precise intrabar clocks require provider metadata.

`MarketDataSource` and its market/replay value types are defined in `web/src/data/contracts.ts`. The former `chart/types.ts` imports remain available as type-only compatibility exports:

```typescript
interface MarketDataSource {
  readonly replay?: MarketReplay;
  getHistory(periodId: PeriodId, before: number | undefined, limit: number, signal?: AbortSignal): Promise<HistoryPage>;
  subscribe(periodId: PeriodId, onBars: (bars: Bar[], partialLastBar: boolean) => void,
    onError: (error: Error) => void, onCorrections?: (bars: Bar[]) => void): () => void;
}

interface MarketReplay {
  readonly state: { readonly active: boolean; readonly cutoff: number; readonly end: number };
  seek(cutoff: number): void;
  reset(): void;
  advance(period: PeriodId, signal?: AbortSignal): Promise<HistoryPage>;
}
```

A source instance represents one instrument and supports explicit periods. `getHistory(periodId, undefined, limit)` requests an initial recent snapshot; a defined `before` is an exclusive UTC millisecond cursor for bar start times. `HistoryPage` returns the matching `periodId`, at most `limit` ordered `bars`, `hasMore`, and `partialLastBar`. The last flag means the final returned bucket is still developing at the source's snapshot cutoff. It is host metadata, not an incomplete OHLCV row or a core finalization flag. An empty page ends history loading in the current host. Reject on failure rather than returning a successful empty page for a network error; honor cancellation where possible.

Instrument identity and scales must remain fixed for the lifetime of a source instance. Symbol selection resolves host metadata from the catalog and creates a bound source before `MarketSession.replaceSource(nextFeed, period)`. This cancels and invalidates earlier work before switching, clears history/replay intent and starts the replacement paused. It preserves the selected period but does not carry a previous instrument replay cutoff, cached date cutoff or raw fixed baseline into the new one. A failed replacement must remain an empty/error state for the selected symbol, never show old-symbol bars with new metadata. Watchlist membership itself does not switch sources or create subscriptions.

Subscriptions deliver normalized current-bar/new-bar batches through `onBars` and optional historical batches through `onCorrections`, and return a cleanup function. Report stream failures through `onError`. The host applies the two channels as `upsert` and `correct`, respectively. Both channels share generation and subscription guards; a rejected update stops the active subscription and reports an update error. Existing adapters may ignore the optional fourth argument. A production adapter must coordinate initial snapshots and subscriptions, reconcile overlap, and handle reconnects and stale callbacks; the interface alone does not provide these guarantees. Separate instrument subscriptions must never deliver data into the wrong chart instance.

The current host requests up to 500 bars initially and per historical page. It serializes history requests and requests older data after navigation approaches the left boundary. Explicit **Older history** remains available. A period switch unsubscribes, aborts outstanding history, advances a request generation, and replaces the series after the new snapshot arrives. Results and stream callbacks from an older generation are ignored even if an adapter fails to honor cancellation. A running replay resumes after successful replacement; its simulated clock is preserved. Teardown also cancels pending work. Replay is paused initially and retains its sequence position across pause/resume.

The host invalidates a subscription before invoking its cleanup function. An adapter cleanup exception cannot prevent switching periods or disposal, and retired callbacks remain ignored. A cleanup failure during an explicit Pause is reported as a stream error while the session stays paused. Adapters should still make cleanup idempotent and release their own resources; ignoring stale callbacks does not stop an adapter's underlying connection.

### Optional historical replay

`MarketReplay` is defined in `web/src/data/contracts.ts`; `data/replay.ts` retains a compatibility type reexport. `cutoff` is an exclusive UTC information boundary; `end` is the available source cutoff captured when replay starts. A source validates `seek` before mutation, serves all subsequent history as of that cutoff, and keeps ordinary `before` pagination separate. `advance` completes the current period or adds the next up to `end`, returning at most one complete changed OHLCV row and an advancing `asOf` matching its new state. On abort or source-generation change, unfinished work must not move the cutoff. `reset` returns to the source's current snapshot. Adapters without this optional capability remain usable for ordinary history/subscriptions; the host does not manufacture replay from full historical candles.

The session applies replay steps through existing `upsert`, preserves one cutoff across period changes, serializes steps and cancels retired timers/requests. It offers 0.25×, 0.5×, 1×, 2×, 5× and 10× speeds, waiting `1000 / speed` milliseconds between completed steps; aggregation time is additional. Closing controls pauses at the retained cutoff; explicit Exit reloads current data paused. Normal sample updates use `subscribe` only outside active historical replay. The replay cursor/speed are not persisted, and no trading or strategy execution is involved.

## Period boundaries

`web/src/data/periods.ts` defines supported sample periods: `1m`, `2m`, `3m`, `5m`, `10m`, `15m`, `30m`, `1h`, `2h`, `4h`, `6h`, `12h`, `1d`, `1w`, and `1M`. Unsupported periods are rejected. All sample boundaries use UTC on a 24/7 calendar. Minute/hour/day buckets are aligned to UTC boundaries; weeks begin Monday at 00:00 UTC; months begin on the first day of the actual calendar month. Month lengths and leap years follow the calendar, not a 30-day approximation. Stable period ordinals also anchor time-axis labels across panning and pagination.

Aggregate bars use the first constituent open, maximum high, minimum low, final constituent close, and sum of constituent cumulative volumes. Replacing a partial minute replaces its contribution rather than adding its volume twice. Larger periods derive from the same canonical minute bars, including the current replay snapshot. The leading incomplete bucket at the beginning of the fixture is omitted; the current unfinished trailing bucket is returned with `partialLastBar` set.

Seconds cannot be reconstructed from minute OHLCV and are not offered. Real providers must declare available resolutions and supply their own session, timezone, holiday, adjustment, and calendar semantics. The synthetic UTC rules are not a production exchange calendar or a generic resampling promise.

## Sample feed

`SampleFeed(symbol)` lazily generates canonical one-minute history for four fictional catalog entries: `ZIG/USD` (price scale 100), `DEMO:STOCK` (100), `DEMO:FX` (100000), and `DEMO:INDEX` (10); all use volume scale 1. Unknown symbols are rejected. The original ZIG/USD sequence remains unchanged; other entries use independent fixed profiles. The fixture spans 2022-01-01 00:00 through 2026-01-13 07:59 UTC, yielding 49 monthly bars including unfinished January 2026. Values derive from the index, fixed arithmetic and counter-based noise, without clock or network quotes. Each instance owns its simulation/replay clock and bounded completed-day cache; chunked aggregation yields for input/cancellation. All entries use the same documented UTC 24/7 calendar, not the trading sessions of their descriptive asset labels. Full minute history is not allocated in the core.

Historical calls are asynchronous and capture the source cutoff when requested. Outside historical replay, **Play sample updates** first repeats the latest snapshot, then emits four cumulative snapshots per new simulated minute at 750 ms wall-clock intervals. Pausing stops emissions rather than advancing simulated time. Each selected period uses this same clock, and subsequent history requests include elapsed sample updates as appropriate.

Historical replay accepts available 15-second-aligned cutoffs strictly after the sample start. Its deterministic partial-minute model interpolates close and cumulative volume; high/low include only that synthetic path until the completed minute supplies the final extremes. Coarse candles aggregate only through the replay cutoff; cached complete days cannot cross it. Selecting a candle includes it through its period end, capped at the available source end. Replay does not advance the separate current-sample clock. These are explicit synthetic rules, not reconstructed historical ticks, an exchange session or an investment dataset.

The UI identifies the data as synthetic. Purchased data and private credentials must stay outside public version control. A future authenticated provider should keep confidential credentials in a backend or another appropriate secure host; neither Wasm nor a browser bundle can conceal shipped keys.

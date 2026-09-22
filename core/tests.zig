const std = @import("std");
const core = @import("engine.zig");
const expect = std.testing.expect;
const equal = std.testing.expectEqual;
const approx = std.testing.expectApproxEqAbs;

test {
    _ = @import("drawings-tests.zig");
    _ = @import("fibonacci-tests.zig");
    _ = @import("scale-tests.zig");
    _ = @import("price-scale-tests.zig");
    _ = @import("oscillator-tests.zig");
    _ = @import("average-tests.zig");
    _ = @import("bollinger-tests.zig");
    _ = @import("measurement-tests.zig");
}

// Large fixtures are static, keeping tests independent of host thread stack size.
var engine: core.Engine = .{};
var batch: [core.capacity]core.Row = undefined;
var frame_rows: [core.max_visible]core.FrameRow = undefined;
var meta: [13]f64 = undefined;

fn bar(time: usize, close: f64) core.Row {
    return .{ @floatFromInt(time), close, close + 2, close - 2, close, 100 };
}

fn seed(count: usize, time_offset: usize) void {
    engine.reset();
    std.debug.assert(engine.configureIndicators(20, 20, 7) == .ok);
    for (0..count) |i| batch[i] = bar(time_offset + i, @floatFromInt(i + 1));
    std.debug.assert(engine.apply(0, batch[0..count]) == .ok);
}

test "atomic validation rejects malformed rows without changing state" {
    seed(30, 100);
    engine.setView(3.25, 15);
    const original_ma = engine.ma[29];
    var update = [_]core.Row{ bar(129, 50), bar(130, 51) };
    update[1][5] = -1;
    try equal(core.Status.invalid_data, engine.apply(2, &update));
    try equal(@as(usize, 30), engine.len);
    try equal(@as(f64, 30), engine.bars[29][4]);
    try equal(original_ma, engine.ma[29]);
    try equal(@as(f64, 3.25), engine.start);
    update[1] = bar(130, 51);
    update[1][0] = core.nan;
    try equal(core.Status.invalid_data, engine.apply(0, &update));
    update[1] = bar(130, 51);
    update[1][2] = 50;
    try equal(core.Status.invalid_data, engine.apply(1, &update));
    update[1] = bar(130, 51.5);
    try equal(core.Status.invalid_data, engine.apply(2, &update));
    update[1] = bar(130, 1e12);
    try equal(core.Status.invalid_data, engine.apply(2, &update));
    try equal(@as(usize, 30), engine.len);
}

test "ordering and mode rejection retain existing bars" {
    seed(30, 100);
    const duplicate = [_]core.Row{ bar(130, 1), bar(130, 2) };
    const overlap = [_]core.Row{bar(100, 2)};
    const correction = [_]core.Row{bar(128, 2)};
    try equal(core.Status.ordering, engine.apply(2, &duplicate));
    try equal(core.Status.ordering, engine.apply(1, &overlap));
    try equal(core.Status.ordering, engine.apply(2, &correction));
    try equal(core.Status.bad_mode, engine.apply(9, &.{}));
    try equal(@as(usize, 30), engine.len);
    try equal(core.Status.ok, engine.apply(0, &.{}));
    try equal(@as(usize, 0), engine.len);
    try equal(@as(i32, -1), engine.hit(10, 500));
}

test "SMA and EMA use full-period seeds and recompute partial live bars" {
    seed(19, 100);
    for (0..19) |i| {
        try expect(std.math.isNan(engine.ma[i]));
        try expect(std.math.isNan(engine.ema[i]));
    }
    try equal(core.Status.ok, engine.apply(2, &.{bar(119, 20)}));
    try approx(@as(f64, 10.5), engine.ma[19], 1e-10);
    try approx(@as(f64, 10.5), engine.ema[19], 1e-10);
    try equal(core.Status.ok, engine.apply(2, &.{bar(119, 40)}));
    try approx(@as(f64, 11.5), engine.ma[19], 1e-10);
    try approx(@as(f64, 11.5), engine.ema[19], 1e-10);
    try equal(core.Status.ok, engine.apply(2, &.{bar(120, 30)}));
    try approx(@as(f64, 12.95), engine.ma[20], 1e-10);
    try approx(@as(f64, 11.5 + 37.0 / 21.0), engine.ema[20], 1e-10);
}

test "incremental indicators match a complete snapshot after batched upsert" {
    seed(50, 100);
    const update = [_]core.Row{ bar(149, -5), bar(152, 15), bar(153, 18) };
    try equal(core.Status.ok, engine.apply(2, &update));
    const live_ma = engine.ma[51];
    const live_ema = engine.ema[51];
    @memcpy(batch[0..engine.len], engine.bars[0..engine.len]);
    try equal(core.Status.ok, engine.apply(0, batch[0..engine.len]));
    try approx(live_ma, engine.ma[51], 1e-10);
    try approx(live_ema, engine.ema[51], 1e-10);
}

test "prepend preserves the timestamp viewport and rebuilds indicator warmup" {
    seed(200, 100);
    engine.setView(12.25, 100);
    const visible_time = engine.bars[12][0];
    for (0..20) |i| batch[i] = bar(80 + i, 10);
    try equal(core.Status.ok, engine.apply(1, batch[0..20]));
    try equal(@as(usize, 220), engine.len);
    try equal(@as(f64, 32.25), engine.start);
    try equal(visible_time, engine.bars[32][0]);
    try approx(@as(f64, 10), engine.ma[19], 1e-10);
    try approx(@as(f64, 9.55), engine.ma[20], 1e-10);
    try approx(@as(f64, 10 - 18.0 / 21.0), engine.ema[20], 1e-10);
}

test "live updates follow only when already at the newest viewport" {
    seed(200, 100);
    try equal(@as(f64, 103.5), engine.start);
    engine.setView(20, 120);
    try equal(core.Status.ok, engine.apply(2, &.{bar(300, 5)}));
    try equal(@as(f64, 20), engine.start);
    engine.follow();
    try equal(@as(f64, 104.5), engine.start);
    try equal(core.Status.ok, engine.apply(2, &.{ bar(300, 9), bar(301, 10), bar(302, 11) }));
    try equal(@as(f64, 106.5), engine.start);
    try equal(@as(usize, 203), engine.len);
}

test "zoom preserves anchor and pan clamps at available history" {
    seed(500, 100);
    engine.setView(100, 100);
    engine.zoom(2, 0.25);
    try equal(@as(f64, 50), engine.span);
    try equal(@as(f64, 112.5), engine.start);
    engine.pan(-50);
    try equal(@as(f64, 62.5), engine.start);
    engine.pan(-1000);
    try equal(@as(f64, 0), engine.start);
    engine.setView(900, 2);
    try equal(@as(f64, 10), engine.span);
    try equal(@as(f64, 494.5), engine.start);
    engine.zoom(core.nan, 0.5);
    engine.pan(std.math.inf(f64));
    try equal(@as(f64, 494.5), engine.start);
    engine.setView(0, 3000);
    try equal(@as(f64, 2000), engine.span);
}

test "default whitespace and centered newest candle use actual bar geometry" {
    seed(200, 100);
    var count = engine.frame(1000, 600, &frame_rows, &meta);
    try approx(@as(f64, 800), frame_rows[count - 1][9], 1e-10);
    try equal(@as(i32, 199), engine.hit(800, 1000));
    try equal(@as(i32, -1), engine.hit(900, 1000));
    engine.pan(1000);
    try equal(@as(f64, 139.5), engine.start);
    count = engine.frame(1000, 600, &frame_rows, &meta);
    try equal(@as(usize, 61), count);
    try approx(@as(f64, 500), frame_rows[count - 1][9], 1e-10);
    try equal(@as(f64, 199), frame_rows[count - 1][0]);
    try equal(@as(f64, 299), frame_rows[count - 1][1]);
    try equal(@as(i32, -1), engine.hit(750, 1000));
    engine.follow();
    try equal(@as(f64, 103.5), engine.start);
}

test "live revisions and appends preserve a chosen right whitespace offset" {
    seed(200, 100);
    engine.setView(127.5, 120);
    const count = engine.frame(1000, 600, &frame_rows, &meta);
    const newest_x = frame_rows[count - 1][9];
    try approx(@as(f64, 600), newest_x, 1e-10);
    try equal(core.Status.ok, engine.apply(2, &.{bar(299, 15)}));
    try equal(@as(f64, 127.5), engine.start);
    try equal(core.Status.ok, engine.apply(2, &.{ bar(299, 20), bar(300, 21), bar(301, 22) }));
    try equal(@as(f64, 129.5), engine.start);
    const next_count = engine.frame(1000, 600, &frame_rows, &meta);
    try approx(newest_x, frame_rows[next_count - 1][9], 1e-10);
    engine.pan(1000);
    try equal(core.Status.ok, engine.apply(2, &.{bar(302, 23)}));
    const centered_count = engine.frame(1000, 600, &frame_rows, &meta);
    try approx(@as(f64, 500), frame_rows[centered_count - 1][9], 1e-10);
}

test "zoom in future whitespace preserves the anchor without fabricating a bar" {
    seed(200, 100);
    const anchor = engine.start + engine.span * 0.9;
    try equal(@as(i32, -1), engine.hit(900, 1000));
    engine.zoom(2, 0.9);
    try approx(anchor, engine.start + engine.span * 0.9, 1e-10);
    try equal(@as(f64, 157.5), engine.start);
    try equal(@as(i32, -1), engine.hit(900, 1000));
    const count = engine.frame(1000, 600, &frame_rows, &meta);
    try equal(@as(usize, 43), count);
    try equal(@as(f64, 199), frame_rows[count - 1][0]);
}

test "history prepend preserves centered whitespace and the latest timestamp" {
    seed(200, 100);
    engine.pan(1000);
    const start = engine.start;
    for (0..20) |i| batch[i] = bar(80 + i, 10);
    try equal(core.Status.ok, engine.apply(1, batch[0..20]));
    try equal(start + 20, engine.start);
    const count = engine.frame(1000, 600, &frame_rows, &meta);
    try approx(@as(f64, 500), frame_rows[count - 1][9], 1e-10);
    try equal(@as(f64, 299), frame_rows[count - 1][1]);
}

test "empty and short snapshots keep finite bounds and first upsert follows defaults" {
    engine.reset();
    engine.pan(1000);
    try equal(@as(f64, 0), engine.start);
    try equal(@as(usize, 0), engine.frame(1000, 600, &frame_rows, &meta));
    try equal(@as(i32, -1), engine.hit(500, 1000));
    for (0..200) |i| batch[i] = bar(100 + i, 10);
    try equal(core.Status.ok, engine.apply(2, batch[0..200]));
    try equal(@as(f64, 103.5), engine.start);
    seed(3, 100);
    engine.setView(1000, 2000);
    try equal(@as(f64, 0), engine.start);
    try equal(@as(usize, 3), engine.frame(1000, 600, &frame_rows, &meta));
    for (meta) |value| try expect(std.math.isFinite(value));
    try equal(@as(i32, -1), engine.hit(500, 1000));
    engine.setView(1000, 10);
    try equal(@as(f64, 0), engine.start);
    try equal(@as(usize, 3), engine.frame(1000, 600, &frame_rows, &meta));
}

test "maximum capacity and span stay within output storage with or without whitespace" {
    seed(core.capacity, 100);
    engine.setView(90000.25, 2000);
    const full_count = engine.frame(1000, 600, &frame_rows, &meta);
    try equal(@as(usize, 2001), full_count);
    try expect(full_count <= core.max_visible);
    try equal(@as(f64, 92000), frame_rows[full_count - 1][0]);
    engine.pan(100000);
    const centered_count = engine.frame(1000, 600, &frame_rows, &meta);
    try equal(@as(usize, 1001), centered_count);
    try expect(centered_count <= core.max_visible);
    try equal(@as(f64, core.capacity - 1), frame_rows[centered_count - 1][0]);
    try approx(@as(f64, 500), frame_rows[centered_count - 1][9], 1e-10);
    try equal(@as(i32, -1), engine.hit(750, 1000));
}

test "frame and hit share candle coordinates across price and volume panes" {
    seed(500, 100);
    engine.setView(100.25, 100);
    const count = engine.frame(1000, 600, &frame_rows, &meta);
    try equal(@as(usize, 101), count);
    try expect(meta[4] < meta[5]);
    for (frame_rows[0..count]) |row| {
        if (row[9] >= 0 and row[9] < 1000) try equal(@as(i32, @intFromFloat(row[0])), engine.hit(row[9], 1000));
        try expect(row[11] <= row[12]);
        try expect(row[11] >= meta[3] and row[12] <= meta[4]);
        try expect(row[14] >= meta[5] and row[14] <= meta[6]);
    }
    try equal(@as(i32, -1), engine.hit(-1, 1000));
    try equal(@as(i32, -1), engine.hit(1000, 1000));
    try equal(@as(i32, -1), engine.hit(core.nan, 1000));
    try equal(@as(usize, 0), engine.frame(0, 600, &frame_rows, &meta));
    try equal(@as(usize, 0), engine.frame(core.nan, 600, &frame_rows, &meta));
    try equal(@as(usize, 0), engine.frame(1000, -1, &frame_rows, &meta));
    try equal(@as(usize, 0), engine.frame(1000, std.math.inf(f64), &frame_rows, &meta));
    try equal(count, engine.frame(1e300, 1e300, &frame_rows, &meta));
    for (frame_rows[0][9..17]) |coordinate| try expect(std.math.isFinite(coordinate));
    try equal(count, engine.frame(1e-300, 1e-300, &frame_rows, &meta));
    for (frame_rows[0][9..17]) |coordinate| try expect(std.math.isFinite(coordinate));
    engine.reset();
    try equal(@as(usize, 0), engine.frame(1000, 600, &frame_rows, &meta));
}

test "negative flat prices and zero volume produce finite geometry" {
    engine.reset();
    try equal(core.Status.ok, engine.apply(0, &.{.{ 8.64e15, -3, -3, -3, -3, 0 }}));
    try equal(@as(usize, 1), engine.frame(1000, 600, &frame_rows, &meta));
    for (frame_rows[0][9..15]) |coordinate| try expect(std.math.isFinite(coordinate));
    try equal(meta[6], frame_rows[0][14]);
    try expect(std.math.isNan(frame_rows[0][15]));
    try expect(std.math.isNan(frame_rows[0][16]));
}

test "capacity overflow is atomic and a final-bar replacement remains legal" {
    seed(core.capacity, 100);
    const previous_close = engine.bars[core.capacity - 1][4];
    const overflow = [_]core.Row{ bar(core.capacity + 99, 5), bar(core.capacity + 100, 6) };
    try equal(core.Status.capacity, engine.apply(2, &overflow));
    try equal(previous_close, engine.bars[core.capacity - 1][4]);
    try equal(@as(usize, core.capacity), engine.len);
    try equal(core.Status.ok, engine.apply(2, overflow[0..1]));
    try equal(@as(f64, 5), engine.bars[core.capacity - 1][4]);
}

test "pan preserves price and volume transforms and only translates shared candles" {
    seed(300, 100);
    engine.bars[90][5] = 5000;
    engine.setView(80, 100);
    _ = engine.frame(1000, 600, &frame_rows, &meta);
    const before = meta;
    const candle = frame_rows[50];
    engine.pan(20);
    _ = engine.frame(1000, 600, &frame_rows, &meta);
    try equal(before[0..3].*, meta[0..3].*);
    try equal(before[7], meta[7]);
    try equal(before[9], meta[9]);
    try equal(candle[1], frame_rows[30][1]);
    try approx(candle[9] - 200, frame_rows[30][9], 1e-10);
    for (10..17) |column| try approx(candle[column], frame_rows[30][column], 1e-10);
    _ = engine.frame(700, 1200, &frame_rows, &meta);
    try equal(before[0..3].*, meta[0..3].*);
    for (10..17) |column| try approx(candle[column] * 2, frame_rows[30][column], 1e-10);
}

test "pan before the first frame captures the same original viewport bounds" {
    seed(300, 100);
    engine.setView(80, 100);
    _ = engine.frame(1000, 600, &frame_rows, &meta);
    const before = meta[0..3].*;
    seed(300, 100);
    engine.setView(80, 100);
    engine.pan(20);
    try equal(@as(usize, 0), engine.frame(0, 600, &frame_rows, &meta));
    _ = engine.frame(1000, 600, &frame_rows, &meta);
    try equal(before, meta[0..3].*);
}

test "locked transforms survive prepends and distant live updates" {
    seed(300, 100);
    engine.setView(80, 100);
    engine.pan(20);
    _ = engine.frame(1000, 600, &frame_rows, &meta);
    const before = meta;
    const candle = frame_rows[30];
    for (0..20) |i| batch[i] = bar(80 + i, -10000);
    try equal(core.Status.ok, engine.apply(1, batch[0..20]));
    _ = engine.frame(1000, 600, &frame_rows, &meta);
    try equal(before[0..3].*, meta[0..3].*);
    try equal(before[8] + 20, meta[8]);
    try equal(candle[1], frame_rows[30][1]);
    try equal(candle[9..15].*, frame_rows[30][9..15].*);
    try expect(candle[8] != frame_rows[30][8]);
    try equal(core.Status.ok, engine.apply(2, &.{.{ 400, 20000, 30000, 10000, 25000, 100000 }}));
    _ = engine.frame(1000, 600, &frame_rows, &meta);
    try equal(before[0..3].*, meta[0..3].*);
    try equal(before[8] + 20, meta[8]);
}

test "locked following updates can leave the pane until explicit refitting" {
    seed(300, 100);
    engine.pan(10000);
    _ = engine.frame(1000, 600, &frame_rows, &meta);
    const before = meta[0..3].*;
    const extreme = core.Row{ 399, 20000, 30000, 10000, 25000, 100000 };
    try equal(core.Status.ok, engine.apply(2, &.{extreme}));
    _ = engine.frame(1000, 600, &frame_rows, &meta);
    try equal(before, meta[0..3].*);
    try equal(core.Status.ok, engine.apply(2, &.{.{ 400, 25000, 40000, 20000, 35000, 200000 }}));
    const count = engine.frame(1000, 600, &frame_rows, &meta);
    try equal(before, meta[0..3].*);
    try approx(@as(f64, 500), frame_rows[count - 1][9], 1e-10);
    try expect(frame_rows[count - 1][11] < meta[3]);
    try expect(frame_rows[count - 1][14] < meta[5]);
    engine.zoom(2, 0.5);
    _ = engine.frame(1000, 600, &frame_rows, &meta);
    try expect(meta[1] > 40000);
    try equal(@as(f64, 200000), meta[2]);
    engine.pan(-10);
    engine.follow();
    const followed = engine.frame(1000, 600, &frame_rows, &meta);
    try approx(@as(f64, 800), frame_rows[followed - 1][9], 1e-10);
    try expect(meta[1] > 40000);
}

test "invalid and clamped no-op pans keep automatic live scaling" {
    for ([_]f64{ 0, core.nan, std.math.inf(f64), -10000 }) |delta| {
        seed(300, 100);
        engine.setView(0, 2000);
        _ = engine.frame(1000, 600, &frame_rows, &meta);
        engine.pan(delta);
        try equal(@as(f64, 0), engine.start);
        try equal(core.Status.ok, engine.apply(2, &.{.{ 399, 20000, 30000, 10000, 25000, 100000 }}));
        _ = engine.frame(1000, 600, &frame_rows, &meta);
        try expect(meta[1] > 30000);
        try equal(@as(f64, 100000), meta[2]);
    }
}

test "viewport transforms preserve a moving anchor and pan locks at zoom limits" {
    seed(500, 100);
    engine.resizePlot(1000);
    engine.setView(100, 100);
    engine.transformView(2, 0.2, 0.25);
    try approx(@as(f64, 50), engine.span, 1e-10);
    try approx(@as(f64, 120), engine.start + engine.span * 0.25, 1e-10);
    try expect(engine.locked_range == null);
    engine.transformView(1, 0.25, 0.27);
    try approx(@as(f64, 106.5), engine.start, 1e-10);
    const locked = engine.locked_range.?;
    engine.transformView(1, 0.27, 0.28);
    try equal(locked, engine.locked_range.?);
    engine.setView(100, 10);
    engine.pan(1);
    const limit_lock = engine.locked_range.?;
    engine.transformView(10, 0.5, 0.5);
    try equal(@as(f64, 101), engine.start);
    try equal(limit_lock, engine.locked_range.?);
    engine.transformView(10, 0.5, 0.6);
    try approx(@as(f64, 100), engine.start, 1e-10);
    try equal(limit_lock, engine.locked_range.?);
    for ([_]f64{ 0, -1, core.nan, std.math.inf(f64) }) |factor| engine.transformView(factor, 0.2, 0.8);
    engine.transformView(2, core.nan, 0.5);
    engine.transformView(2, 0.5, core.nan);
    try approx(@as(f64, 100), engine.start, 1e-10);
    try equal(@as(f64, 10), engine.span);
    engine.transformView(0.5, 0.5, 0.5);
    try expect(engine.locked_range == null);
}

test "explicit view and replacement clear locked ranges including empty snapshots" {
    seed(300, 100);
    engine.setView(80, 100);
    engine.pan(20);
    _ = engine.frame(1000, 600, &frame_rows, &meta);
    const locked_min = meta[0];
    engine.setView(engine.start, engine.span);
    _ = engine.frame(1000, 600, &frame_rows, &meta);
    try expect(meta[0] > locked_min);
    engine.pan(20);
    try equal(core.Status.ok, engine.apply(0, &.{}));
    engine.pan(10);
    try equal(@as(usize, 0), engine.frame(1000, 600, &frame_rows, &meta));
    try equal(core.Status.ok, engine.apply(2, &.{bar(1000, -10000)}));
    _ = engine.frame(1000, 600, &frame_rows, &meta);
    try expect(meta[0] < -10000 and meta[1] > -10000);
    for (meta) |value| try expect(std.math.isFinite(value));
}

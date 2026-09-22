const std = @import("std");
const core = @import("engine.zig");
const equal = std.testing.expectEqual;
const expect = std.testing.expect;
const approx = std.testing.expectApproxEqAbs;
var engine: core.Engine = .{};
var other: core.Engine = .{};
var rows: [core.max_visible]core.FrameRow = undefined;
var bands: [core.max_visible]core.BollingerFrameRow = undefined;
var meta: [13]f64 = undefined;

fn bar(time: usize, close: f64) core.Row {
    return .{ @floatFromInt(time), close, close, close, close, 1 };
}

fn assertReference(bars: []const core.Row, period: usize, multiplier: f64) !void {
    for (period - 1..bars.len) |i| {
        const window = bars[i + 1 - period .. i + 1];
        const origin = window[0][4];
        var sum: f64 = 0;
        for (window) |row| sum += row[4] - origin;
        const mean = sum / @as(f64, @floatFromInt(period));
        var squared: f64 = 0;
        for (window) |row| squared += std.math.pow(f64, (row[4] - origin) - mean, 2);
        const deviation = multiplier * @sqrt(squared / @as(f64, @floatFromInt(period)));
        const expected: [3]f64 = .{ origin + mean, origin + mean + deviation, origin + mean - deviation };
        for (expected, engine.bands.values[i]) |value, actual| {
            try approx(value, actual, @max(1e-10, (@abs(origin) + @abs(mean) + deviation) * 1e-14));
        }
    }
}

test "Bollinger uses population deviation and full SMA warmup including period one" {
    engine.reset();
    try expect(!engine.bands.config.enabled);
    try equal(.ok, engine.apply(0, &.{ bar(0, 1), bar(1, 2), bar(2, 3), bar(3, 4), bar(4, 5) }));
    try equal(.ok, engine.configureBollinger(5, 2, 1));
    for (engine.bands.values[0..4]) |values| for (values) |value| try expect(std.math.isNan(value));
    try equal(@as(f64, 3), engine.bands.values[4][0]);
    try approx(3 + 2 * @sqrt(@as(f64, 2)), engine.bands.values[4][1], 1e-12);
    try approx(3 - 2 * @sqrt(@as(f64, 2)), engine.bands.values[4][2], 1e-12);
    try equal(.ok, engine.configureBollinger(1, 10, 1));
    for (engine.bars[0..engine.len], engine.bands.values[0..engine.len]) |row, values| {
        for (values) |value| try equal(row[4], value);
    }
}

test "Bollinger invalid config is atomic and disabled calculations do not touch values" {
    engine.reset();
    try equal(.ok, engine.apply(0, &.{ bar(0, 10), bar(1, 30) }));
    try equal(.ok, engine.configureBollinger(2, 2, 1));
    const saved = engine.bands.values[1];
    const config = engine.bands.config;
    for ([_]u32{ 0, 501, std.math.maxInt(u32) }) |period| try equal(.invalid_data, engine.configureBollinger(period, 2, 1));
    for ([_]f64{ 0, 0.09, 10.01, core.nan, std.math.inf(f64) }) |multiplier| try equal(.invalid_data, engine.configureBollinger(2, multiplier, 1));
    try equal(.invalid_data, engine.configureBollinger(2, 2, 2));
    try equal(config, engine.bands.config);
    try equal(saved, engine.bands.values[1]);
    try equal(.ok, engine.configureBollinger(2, 2, 0));
    try equal(.ok, engine.apply(2, &.{bar(1, 100)}));
    try equal(saved, engine.bands.values[1]);
    const count = engine.frame(900, 600, &rows, &meta);
    engine.bollingerFrame(rows[0..count], engine.priceAxis(&meta), bands[0..count]);
    for (bands[0..count]) |values| for (values) |value| try expect(std.math.isNan(value));
    try equal(.ok, engine.configureBollinger(2, 2, 1));
    try equal(@as(f64, 55), engine.bands.values[1][0]);
}

test "Bollinger preserves narrow high-price variation after large shifting windows" {
    engine.reset();
    var input: [1200]core.Row = undefined;
    for (&input, 0..) |*row, i| {
        const close: f64 = if (i < 550) (if (i % 2 == 0) -1e12 else 1e12) else 1e12 - 200 + @as(f64, @floatFromInt(i % 3));
        row.* = bar(i, close);
    }
    try equal(.ok, engine.apply(0, &input));
    for ([_]u32{ 3, 20, 500 }) |period| {
        try equal(.ok, engine.configureBollinger(period, 2, 1));
        try assertReference(&input, period, 2);
        const window = input[1200 - period ..];
        var mean: f64 = 0;
        for (window) |row| mean += row[4] - (1e12 - 200);
        mean /= @floatFromInt(period);
        var squared: f64 = 0;
        for (window) |row| squared += std.math.pow(f64, row[4] - (1e12 - 200) - mean, 2);
        const deviation = 2 * @sqrt(squared / @as(f64, @floatFromInt(period)));
        try approx(deviation, engine.bands.values[1199][1] - engine.bands.values[1199][0], 0.0001);
    }
    try equal(.ok, engine.configureBollinger(3, 2, 1));
    const last = engine.bands.values[1199];
    try equal(@as(f64, 1e12 - 199), last[0]);
    try approx(2 * @sqrt(@as(f64, 2.0 / 3.0)), last[1] - last[0], 0.0001);
}

test "Bollinger prepend revision and sparse correction match fresh replacement" {
    engine.reset();
    other.reset();
    var input: [80]core.Row = undefined;
    for (&input, 0..) |*row, i| row.* = bar(i + 100, @floatFromInt((i * 37) % 251));
    try equal(.ok, engine.configureBollinger(17, 2.5, 1));
    try equal(.ok, other.configureBollinger(17, 2.5, 1));
    try equal(.ok, engine.apply(0, input[20..60]));
    try equal(.ok, engine.apply(1, input[0..20]));
    input[59] = bar(159, 999);
    try equal(.ok, engine.apply(2, input[59..]));
    input[23] = bar(123, -250);
    input[45] = bar(145, 155);
    engine.setView(10, 30);
    engine.pan(1);
    const locked = engine.locked_range;
    try equal(.ok, engine.apply(3, &.{ input[23], input[45] }));
    try equal(locked, engine.locked_range);
    try equal(.ok, other.apply(0, &input));
    for (16..80) |i| try equal(other.bands.values[i], engine.bands.values[i]);
    const before = engine.bands.values[79];
    try equal(.missing_bar, engine.apply(3, &.{bar(500, 500)}));
    try equal(before, engine.bands.values[79]);
}

test "Bollinger fits all bands and excludes nonpositive lower bands from logarithmic scaling" {
    engine.reset();
    try equal(.ok, engine.apply(0, &.{ bar(0, 1), bar(1, 101), bar(2, 1) }));
    try equal(.ok, engine.configurePriceScale(1, 0));
    _ = engine.frame(900, 600, &rows, &meta);
    try equal(.logarithmic, engine.priceAxis(&meta).effective);
    try equal(.ok, engine.configureBollinger(2, 2, 1));
    const count = engine.frame(900, 600, &rows, &meta);
    const axis = engine.priceAxis(&meta);
    try equal(.normal, axis.effective);
    try expect(meta[0] < -49 and meta[1] > 151);
    engine.bollingerFrame(rows[0..count], axis, bands[0..count]);
    for (bands[1..count]) |values| {
        for (values[0..3], values[3..6]) |value, y| {
            try equal(axis.toY(value), y);
            try expect(y >= meta[3] and y <= meta[4]);
        }
    }
    try equal(.ok, engine.configureBollinger(2, 2, 0));
    _ = engine.frame(900, 600, &rows, &meta);
    try equal(.logarithmic, engine.priceAxis(&meta).effective);
    try equal(.ok, engine.apply(0, &.{ bar(0, -1e12), bar(1, 1e12) }));
    try equal(.ok, engine.configureBollinger(2, 10, 1));
    _ = engine.frame(900, 600, &rows, &meta);
    try equal(@as(f64, 1e13), engine.bands.values[1][1]);
    try equal(@as(f64, -1e13), engine.bands.values[1][2]);
    try expect(std.math.isFinite(meta[0]) and meta[0] < -1e13);
    try expect(std.math.isFinite(meta[1]) and meta[1] > 1e13);
}

test "Bollinger settings preserve pane focus and idempotent config preserves price locks" {
    engine.reset();
    var input: [60]core.Row = undefined;
    for (&input, 0..) |*row, i| row.* = bar(i, @floatFromInt(i + 10));
    try equal(.ok, engine.apply(0, &input));
    try equal(.ok, engine.configureIndicators(20, 20, 4));
    try equal(.ok, engine.maximizePane(1));
    const order = engine.pane_order;
    const weights = engine.pane_weights;
    engine.setView(10, 20);
    engine.pan(1);
    try equal(.ok, engine.configureBollinger(20, 2, 1));
    try equal(@as(i32, 1), engine.maximized_pane);
    try equal(@as(f64, 11), engine.start);
    try equal(@as(f64, 20), engine.span);
    try equal(order, engine.pane_order);
    try equal(weights, engine.pane_weights);
    try equal(@as(?[3]f64, null), engine.locked_range);
    engine.pan(1);
    const locked = engine.locked_range;
    try expect(locked != null);
    try equal(.ok, engine.configureBollinger(20, 2, 1));
    try equal(locked, engine.locked_range);
    const count = engine.frame(900, 600, &rows, &meta);
    engine.bollingerFrame(rows[0..count], engine.priceAxis(&meta), bands[0..count]);
    for (bands[8..count]) |values| {
        for (values[0..3]) |value| try expect(std.math.isFinite(value));
        for (values[3..6]) |value| try expect(std.math.isNan(value));
    }
}

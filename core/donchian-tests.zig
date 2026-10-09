const std = @import("std");
const core = @import("engine.zig");
const equal = std.testing.expectEqual;
const expect = std.testing.expect;
var engine: core.Engine = .{};
var fresh: core.Engine = .{};
var rows: [core.max_visible]core.FrameRow = undefined;
var channels: [core.max_visible]core.DonchianFrameRow = undefined;
var meta: [13]f64 = undefined;

fn bar(time: usize, close: f64) core.Row {
    return .{ @floatFromInt(time), close, close + 5, close - 7, close, 1 };
}

fn assertReference(input: []const core.Row, period: usize) !void {
    for (input, 0..) |_, index| {
        if (index + 1 < period) {
            for (engine.channels.values[index]) |value| try expect(std.math.isNan(value));
            continue;
        }
        var upper = -std.math.inf(f64);
        var lower = std.math.inf(f64);
        for (input[index + 1 - period .. index + 1]) |row| {
            upper = @max(upper, row[2]);
            lower = @min(lower, row[3]);
        }
        try equal(core.donchian.Values{ (upper + lower) / 2, upper, lower }, engine.channels.values[index]);
    }
}

test "Donchian uses current bar high and low with a complete window" {
    engine.reset();
    try expect(!engine.channels.config.enabled);
    try equal(.ok, engine.apply(0, &.{ bar(0, 10), bar(1, 20), bar(2, 15), bar(3, 30) }));
    try equal(.ok, engine.configureDonchian(3, 1));
    try assertReference(engine.bars[0..engine.len], 3);
    try equal(core.donchian.Values{ 14, 25, 3 }, engine.channels.values[2]);
    try equal(core.donchian.Values{ 21.5, 35, 8 }, engine.channels.values[3]);
    try equal(.ok, engine.configureDonchian(1, 1));
    for (engine.bars[0..engine.len], engine.channels.values[0..engine.len]) |row, values| {
        try equal(core.donchian.Values{ (row[2] + row[3]) / 2, row[2], row[3] }, values);
    }
}

test "Donchian invalid settings are atomic and disabled channels do not update" {
    engine.reset();
    try equal(.ok, engine.apply(0, &.{ bar(0, 10), bar(1, 20) }));
    try equal(.ok, engine.configureDonchian(2, 1));
    const saved = engine.channels.values[1];
    const config = engine.channels.config;
    for ([_]u32{ 0, 501, std.math.maxInt(u32) }) |period| try equal(.invalid_data, engine.configureDonchian(period, 1));
    try equal(.invalid_data, engine.configureDonchian(2, 2));
    try equal(config, engine.channels.config);
    try equal(saved, engine.channels.values[1]);
    try equal(.ok, engine.configureDonchian(2, 0));
    try equal(.ok, engine.apply(2, &.{bar(1, 100)}));
    try equal(saved, engine.channels.values[1]);
    const count = engine.frame(900, 600, &rows, &meta);
    engine.donchianFrame(rows[0..count], engine.priceAxis(&meta), channels[0..count]);
    for (channels[0..count]) |values| for (values) |value| try expect(std.math.isNan(value));
    try equal(.ok, engine.configureDonchian(2, 1));
    try equal(core.donchian.Values{ 54, 105, 3 }, engine.channels.values[1]);
}

test "Donchian rolling windows match replacement after prepend, upsert, and corrections" {
    engine.reset();
    fresh.reset();
    var input: [1200]core.Row = undefined;
    for (&input, 0..) |*row, index| row.* = bar(index + 100, @floatFromInt((index * 37) % 251));
    try equal(.ok, engine.configureDonchian(500, 1));
    try equal(.ok, fresh.configureDonchian(500, 1));
    try equal(.ok, engine.apply(0, input[200..1000]));
    try equal(.ok, engine.apply(1, input[0..200]));
    input[999] = bar(1099, 400);
    try equal(.ok, engine.apply(2, input[999..]));
    input[235] = bar(335, -300);
    input[845] = bar(945, 900);
    engine.setView(10, 30);
    engine.pan(1);
    const locked = engine.locked_range;
    try equal(.ok, engine.apply(3, &.{ input[235], input[845] }));
    try equal(locked, engine.locked_range);
    try equal(.ok, fresh.apply(0, &input));
    try assertReference(&input, 500);
    for (499..input.len) |index| try equal(fresh.channels.values[index], engine.channels.values[index]);
    const saved = engine.channels.values[1199];
    try equal(.missing_bar, engine.apply(3, &.{bar(9000, 9)}));
    try equal(saved, engine.channels.values[1199]);
}

test "Donchian extends visible bounds, respects logarithmic eligibility and hidden panes" {
    engine.reset();
    var input: [60]core.Row = undefined;
    for (&input, 0..) |*row, index| row.* = bar(index, 100);
    input[0] = bar(0, -10);
    try equal(.ok, engine.apply(0, &input));
    try equal(.ok, engine.configureDonchian(20, 1));
    try equal(.ok, engine.configurePriceScale(1, 0));
    engine.setView(10, 10);
    var count = engine.frame(900, 600, &rows, &meta);
    try equal(.normal, engine.priceAxis(&meta).effective);
    try expect(meta[0] < 0);
    engine.setView(20, 10);
    count = engine.frame(900, 600, &rows, &meta);
    const axis = engine.priceAxis(&meta);
    try equal(.logarithmic, axis.effective);
    engine.donchianFrame(rows[0..count], axis, channels[0..count]);
    for (channels[0..count]) |values| {
        for (values[0..3], values[3..6]) |price, y| {
            try equal(axis.toY(price), y);
            try expect(y >= meta[3] and y <= meta[4]);
        }
    }
    engine.pan(1);
    const locked = engine.locked_range;
    try expect(locked != null);
    try equal(.ok, engine.configureDonchian(20, 1));
    try equal(locked, engine.locked_range);
    try equal(.ok, engine.configureDonchian(21, 1));
    try equal(@as(?[3]f64, null), engine.locked_range);
    try equal(.ok, engine.configureDonchian(20, 1));
    try equal(.ok, engine.configureIndicators(20, 20, 4));
    try equal(.ok, engine.maximizePane(1));
    const order = engine.pane_order;
    const weights = engine.pane_weights;
    try equal(.ok, engine.configureDonchian(21, 1));
    try equal(@as(i32, 1), engine.maximized_pane);
    try equal(order, engine.pane_order);
    try equal(weights, engine.pane_weights);
    count = engine.frame(900, 600, &rows, &meta);
    engine.donchianFrame(rows[0..count], engine.priceAxis(&meta), channels[0..count]);
    for (channels[1..count]) |values| {
        for (values[0..3]) |price| try expect(std.math.isFinite(price));
        for (values[3..6]) |y| try expect(std.math.isNan(y));
    }
}

test "Donchian nonpositive value disables log projection under a positive pan lock" {
    engine.reset();
    var input: [60]core.Row = undefined;
    for (&input, 0..) |*row, index| row.* = bar(index, 100);
    input[0] = bar(0, -10);
    try equal(.ok, engine.apply(0, &input));
    try equal(.ok, engine.configureDonchian(20, 1));
    try equal(.ok, engine.configurePriceScale(1, 0));
    engine.setView(20, 10);
    _ = engine.frame(900, 600, &rows, &meta);
    try equal(.logarithmic, engine.priceAxis(&meta).effective);
    engine.pan(-1);
    try equal(@as(f64, 19), engine.start);
    const locked = engine.locked_range.?;
    try expect(locked[0] > 0);
    try equal(@as(f64, -17), engine.channels.values[19][2]);
    _ = engine.frame(900, 600, &rows, &meta);
    try equal(locked[0], meta[0]);
    try equal(.logarithmic, engine.priceAxis(&meta).requested);
    try equal(.normal, engine.priceAxis(&meta).effective);
    engine.pan(1);
    _ = engine.frame(900, 600, &rows, &meta);
    try equal(locked, engine.locked_range.?);
    try equal(.logarithmic, engine.priceAxis(&meta).effective);
}

const std = @import("std");
const core = @import("engine.zig");
const equal = std.testing.expectEqual;
const expect = std.testing.expect;
var engine: core.Engine = .{};

fn bar(time: f64, price: f64) core.Row {
    return .{ time, price, price + 2, price - 2, price + 1, 100 };
}

fn seed() !void {
    engine.reset();
    var bars: [80]core.Row = undefined;
    for (&bars, 0..) |*row, i| row.* = bar(@floatFromInt(1000 + i * 60000), @floatFromInt(i * i + 10));
    try equal(.ok, engine.apply(0, &bars));
}

test "time lookup accepts exact loaded UTC integers across gaps and prepends" {
    engine.reset();
    try equal(@as(i32, -1), engine.indexAtTime(60000));
    try equal(.ok, engine.apply(0, &.{ bar(60000, 10), bar(180000, 20), bar(8.64e15, 30) }));
    try equal(@as(i32, 0), engine.indexAtTime(60000));
    try equal(@as(i32, 1), engine.indexAtTime(180000));
    try equal(@as(i32, 2), engine.indexAtTime(8.64e15));
    for ([_]f64{ -1, 0, 120000, 60000.5, 8.64e15 + 1, core.nan, std.math.inf(f64) }) |time| {
        try equal(@as(i32, -1), engine.indexAtTime(time));
    }
    try equal(.ok, engine.apply(1, &.{bar(0, 5)}));
    try equal(@as(i32, 0), engine.indexAtTime(0));
    try equal(@as(i32, 1), engine.indexAtTime(60000));
    try equal(@as(i32, 2), engine.indexAtTime(180000));
    try equal(.ok, engine.apply(3, &.{bar(180000, 25)}));
    try equal(@as(i32, 2), engine.indexAtTime(180000));
}

test "revealing bars pans minimally and preserves time span pane state and existing locks" {
    try seed();
    try equal(.ok, engine.configureIndicators(3, 5, 7));
    try equal(.ok, engine.configureOscillators(3, 2, 4, 2, 3));
    try equal(.ok, engine.setPaneOrder(.{ 1, 0, 3, 2 }));
    try equal(.ok, engine.setPaneWeights(.{ 4, 3, 2, 1 }));
    try equal(.ok, engine.maximizePane(3));
    engine.setView(30, 20);
    try equal(@as(i32, 0), engine.revealBar(40));
    try expect(engine.locked_range == null and engine.locked_macd_range == null);
    var meta: [13]f64 = undefined;
    try expect(engine.frameMetadata(800, 500, &meta));
    try equal(@as(i32, 1), engine.revealBar(10));
    try equal(@as(f64, 8.5), engine.start);
    try equal([3]f64{ meta[0], meta[1], meta[2] }, engine.locked_range.?);
    const price_lock = engine.locked_range;
    const macd_lock = engine.locked_macd_range;
    try expect(macd_lock != null);
    try equal(@as(i32, 0), engine.revealBar(10));
    try equal(@as(i32, 1), engine.revealBar(60));
    try equal(@as(f64, 42.5), engine.start);
    try equal(@as(i32, 0), engine.revealBar(60));
    try equal(@as(i32, 1), engine.revealBar(43));
    try equal(@as(f64, 41.5), engine.start);
    try equal(@as(f64, 20), engine.span);
    try equal(price_lock, engine.locked_range);
    try equal(macd_lock, engine.locked_macd_range);
    try equal([4]usize{ 1, 0, 3, 2 }, engine.pane_order);
    try equal([4]f64{ 4, 3, 2, 1 }, engine.pane_weights);
    try equal(@as(i32, 3), engine.maximized_pane);
}

test "reveal rejects invalid indices and boundary no-ops never acquire scale locks" {
    engine.reset();
    try equal(@as(i32, -1), engine.revealBar(0));
    try seed();
    engine.setView(0, 10);
    for ([_]f64{ -1, 80, 0.25, core.nan, std.math.inf(f64) }) |index| {
        try equal(@as(i32, -1), engine.revealBar(index));
    }
    try equal(@as(i32, 0), engine.revealBar(0));
    try equal(@as(i32, 0), engine.revealBar(5));
    try equal(@as(f64, 0), engine.start);
    try expect(engine.locked_range == null);
    try equal(@as(i32, 1), engine.revealBar(20));
    try equal(@as(f64, 11.5), engine.start);
    try equal(@as(f64, 10), engine.span);
    try equal(@as(i32, 1), engine.revealBar(79));
    try equal(@as(f64, 70.5), engine.start);
    try equal(@as(i32, 0), engine.revealBar(79));
    try equal(@as(i32, 1), engine.revealBar(0));
    try equal(@as(f64, 0), engine.start);
}

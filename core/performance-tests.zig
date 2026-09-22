const std = @import("std");
const core = @import("engine.zig");
const equal = std.testing.expectEqual;
const expect = std.testing.expect;

var engine: core.Engine = .{};
var input: [1100]core.Row = undefined;
var rows: [core.max_visible]core.FrameRow = undefined;

fn bar(index: usize, close: f64) core.Row {
    return .{ @floatFromInt(index), close, close + 1, close - 1, close, 100 };
}

fn verifyEma() !void {
    var seed_sum: f64 = 0;
    var expected = core.nan;
    const divisor: f64 = @floatFromInt(engine.ema_period);
    for (engine.bars[0..engine.len], 0..) |row, i| {
        if (i < engine.ema_period) seed_sum += row[4];
        if (i + 1 == engine.ema_period) expected = seed_sum / divisor;
        if (i + 1 > engine.ema_period) expected += 2.0 / (divisor + 1) * (row[4] - expected);
        if (std.math.isNan(expected)) try expect(std.math.isNan(engine.ema[i])) else try equal(expected, engine.ema[i]);
    }
}

test "EMA seed and mature revisions match independent recurrence for all period boundaries" {
    for ([_]usize{ 1, 20, 500 }) |period| {
        engine.reset();
        try equal(core.Status.ok, engine.configureIndicators(20, @floatFromInt(period), 3));
        const initial = @max(1, period - 1);
        for (0..initial) |i| input[i] = bar(i + 100, @floatFromInt(700 + i * 47 % 177));
        try equal(core.Status.ok, engine.apply(0, input[0..initial]));
        try verifyEma();
        // Revising the warmup/seed bar must rebuild that seed rather than reuse itself.
        try equal(core.Status.ok, engine.apply(2, &.{bar(initial + 99, -900)}));
        try verifyEma();
        for (0..period + 3) |i| input[i] = bar(initial + 100 + i, @floatFromInt(500 + i * 31 % 99));
        try equal(core.Status.ok, engine.apply(2, input[0 .. period + 3]));
        try verifyEma();
        for (0..64) |revision| {
            const close: f64 = if (revision % 2 == 0) -999999999999 else 999999999999;
            try equal(core.Status.ok, engine.apply(2, &.{bar(engine.len + 99, close)}));
            try verifyEma();
        }
        for (0..100) |i| input[i] = bar(i, @floatFromInt(i * 13 % 37));
        try equal(core.Status.ok, engine.apply(1, input[0..100]));
        try verifyEma();
        try equal(core.Status.ok, engine.configureIndicators(20, @floatFromInt(501 - period), 3));
        try verifyEma();
    }
}

test "drawing metadata agrees with frame under resizing pane visibility and locked ranges" {
    engine.reset();
    for (0..1000) |i| input[i] = bar(i, @floatFromInt(i * 13 % 37));
    try equal(core.Status.ok, engine.apply(0, input[0..1000]));
    engine.resizePlot(1400);
    engine.setView(120.25, 2000);
    for ([_]f64{ 0, 7 }) |mask| {
        try equal(core.Status.ok, engine.configureIndicators(20, 500, mask));
        for ([_]f64{ 0.30, 0.85 }) |split| {
            engine.setPaneSplit(split);
            engine.pan(10);
            for ([_][2]f64{ .{ 1400, 750 }, .{ 220, 400 }, .{ 0, 400 }, .{ 220, core.nan } }) |size| {
                var metadata: [13]f64 = undefined;
                var frame_metadata: [13]f64 = undefined;
                const valid = engine.frameMetadata(size[0], size[1], &metadata);
                const count = engine.frame(size[0], size[1], &rows, &frame_metadata);
                try equal(valid, count > 0);
                try equal(metadata, frame_metadata);
            }
        }
    }
    engine.reset();
    var metadata: [13]f64 = undefined;
    var frame_metadata: [13]f64 = undefined;
    try expect(engine.frameMetadata(800, 600, &metadata));
    try equal(@as(usize, 0), engine.frame(800, 600, &rows, &frame_metadata));
    try equal(metadata, frame_metadata);
}

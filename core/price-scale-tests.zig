const std = @import("std");
const core = @import("engine.zig");
const scale = @import("price-scale.zig");
const drawings = @import("drawings.zig");
const expect = std.testing.expect;
const equal = std.testing.expectEqual;
const near = std.testing.expectApproxEqAbs;
var engine: core.Engine = .{};
var rows: [core.max_visible]core.FrameRow = undefined;
var meta: [13]f64 = undefined;
var ticks: [scale.maximum_ticks]scale.Tick = undefined;

fn seed() !void {
    engine.reset();
    var input: [40]core.Row = undefined;
    for (&input, 0..) |*bar, i| {
        const close: f64 = @floatFromInt(100 + i * 5);
        bar.* = .{ @floatFromInt(i + 1), close - 2, close + 5, close - 5, close, @floatFromInt(i + 1) };
    }
    try equal(core.Status.ok, engine.apply(0, &input));
    try equal(core.Status.ok, engine.configureIndicators(3, 3, 7));
    engine.setView(5.75, 20);
}

test "all scale modes project bars indicators and drawing anchors through the same reversible axis" {
    try seed();
    _ = engine.frame(900, 600, &rows, &meta);
    const original = meta;
    for (0..4) |mode| {
        for ([_]f64{ 0, 1 }) |inverted| {
            try equal(core.Status.ok, engine.configurePriceScale(@floatFromInt(mode), inverted));
            _ = engine.frame(900, 600, &rows, &meta);
            try std.testing.expectEqualSlices(f64, original[2..], meta[2..]);
            const axis = engine.priceAxis(&meta);
            try equal(@as(u8, @intCast(mode)), @intFromEnum(axis.effective));
            try equal(@as(f64, 130), axis.base); // index 5 center is left of start; index 6 is first visible center.
            try near(rows[1][13], axis.toY(rows[1][5]), 1e-9);
            try near(rows[1][15], axis.toY(rows[1][7]), 1e-9);
            try near(rows[1][16], axis.toY(rows[1][8]), 1e-9);
            try near(rows[1][5], axis.atY(rows[1][13]), 1e-9);
            const input = [_]drawings.Input{.{ 0, rows[1][1], rows[1][5], rows[1][1], rows[1][5], 0 }};
            var output: [1]drawings.Geometry = undefined;
            drawings.project(&engine, &meta, &input, &output);
            try equal(@as(f64, 1), output[0][0]);
            try near(rows[1][13], output[0][2], 1e-9);
            const point = drawings.point(&engine, &meta, rows[1][9], rows[1][13]).?;
            try equal(rows[1][5], point[1]);
        }
    }
}

test "logarithmic precision and ticks remain finite at supported price extremes" {
    for ([_][2]f64{ .{ 1, 10000 }, .{ 1e12 - 1, 1e12 + 1 }, .{ 100, 150 } }) |range| {
        const axis = scale.Axis.init(.{ .mode = .logarithmic }, range[0], range[1], 20, 700, 100, true);
        const middle = (range[0] + range[1]) / 2;
        try near(middle, axis.atY(axis.toY(middle)), 0.001);
        const count = axis.ticks(&ticks);
        try expect(count > 0 and count <= 16);
        for (ticks[0..count], 0..) |tick, i| {
            for (tick) |value| try expect(std.math.isFinite(value));
            try expect(tick[0] >= range[0] and tick[0] <= range[1]);
            try near(tick[1], axis.toY(tick[0]), 1e-8);
            if (i > 0) try expect(tick[0] > ticks[i - 1][0] and @abs(tick[1] - ticks[i - 1][1]) >= 48 - 1e-8);
        }
    }
}

test "fallback is explicit for nonpositive ranges data and zero bases" {
    try seed();
    try equal(core.Status.ok, engine.configurePriceScale(1, 0));
    _ = engine.frame(900, 600, &rows, &meta);
    engine.locked_range = .{ meta[0], meta[1], meta[2] };
    engine.bars[6][3] = 0;
    try equal(scale.Mode.normal, engine.priceAxis(&meta).effective);
    engine.bars[6][3] = 125;
    engine.ma[6] = -1;
    try equal(scale.Mode.normal, engine.priceAxis(&meta).effective);
    engine.indicator_mask = 0;
    try equal(scale.Mode.logarithmic, engine.priceAxis(&meta).effective);
    meta[0] = -1;
    try equal(scale.Mode.normal, engine.priceAxis(&meta).effective);
    for ([_]f64{ 2, 3 }) |mode| {
        engine.bars[6][4] = 0;
        try equal(core.Status.ok, engine.configurePriceScale(mode, 1));
        try equal(scale.Mode.normal, engine.priceAxis(&meta).effective);
        engine.bars[6][4] = -100;
        const axis = engine.priceAxis(&meta);
        try equal(@as(u8, @intFromFloat(mode)), @intFromEnum(axis.effective));
        try expect(axis.display(-90) > axis.display(-100));
        try near(if (mode == 2) @as(f64, 10) else 110, axis.display(-90), 1e-9);
    }
    const config = engine.price_config;
    for ([_]f64{ -1, 4, 1.5, core.nan, std.math.inf(f64) }) |mode| {
        try equal(core.Status.invalid_data, engine.configurePriceScale(mode, 0));
        try equal(config, engine.price_config);
    }
    try equal(core.Status.invalid_data, engine.configurePriceScale(0, 2));
}

test "manual scaling anchors screen prices in every mode and preserves raw pan locks" {
    for (0..4) |mode| {
        for ([_]f64{ 0, 1 }) |inverted| {
            try seed();
            try equal(core.Status.ok, engine.configurePriceScale(@floatFromInt(mode), inverted));
            _ = engine.frame(900, 600, &rows, &meta);
            const before = meta;
            const anchor_y = meta[3] + (meta[4] - meta[3]) * 0.2;
            const price = engine.priceAtY(anchor_y, 900, 600);
            engine.scalePrice(1.5, 0.2);
            _ = engine.frame(900, 600, &rows, &meta);
            try near(anchor_y, engine.priceToY(price, 900, 600), 1e-7);
            try equal(before[2], meta[2]);
            try std.testing.expectEqualSlices(f64, before[8..], meta[8..]);
            const locked = engine.locked_range.?;
            engine.pan(3);
            _ = engine.frame(900, 600, &rows, &meta);
            try std.testing.expectEqualSlices(f64, &locked, meta[0..3]);
            engine.resetScale();
            try expect(engine.locked_range == null);
            try equal(@as(u8, @intCast(mode)), @intFromEnum(engine.price_config.mode));
            try equal(inverted == 1, engine.price_config.inverted);
        }
    }
}

test "automatic log padding keeps positive flat and broad data eligible" {
    for ([_]f64{ 1, 1e12 }) |high| {
        engine.reset();
        try equal(core.Status.ok, engine.apply(0, &.{.{ 1, 1, high, 1, 1, 1 }}));
        try equal(core.Status.ok, engine.configurePriceScale(1, 0));
        _ = engine.frame(900, 600, &rows, &meta);
        try expect(meta[0] > 0 and meta[0] < 1 and meta[1] > high);
        try equal(scale.Mode.logarithmic, engine.priceAxis(&meta).effective);
        engine.locked_range = .{ -1, 10, 1 };
        _ = engine.frame(900, 600, &rows, &meta);
        try equal(scale.Mode.normal, engine.priceAxis(&meta).effective);
    }
}

test "normal and log narrow ticks respect integer raw precision at high offsets" {
    for ([_]scale.Mode{ .normal, .logarithmic }) |mode| {
        const axis = scale.Axis.init(.{ .mode = mode }, 1e12 - 1, 1e12 + 1, 20, 700, 1e12, true);
        const count = axis.ticks(&ticks);
        try expect(count > 0 and count <= 3);
        for (ticks[0..count], 0..) |tick, i| {
            try equal(@round(tick[0]), tick[0]);
            if (i > 0) try expect(tick[0] - ticks[i - 1][0] >= 1);
        }
    }
}

test "log padding follows the visible move and raw unit instead of a fixed percentage" {
    for ([_][2]f64{ .{ 4e6, 4.03e6 }, .{ 1e12 - 2, 1e12 } }) |range| {
        engine.reset();
        try equal(core.Status.ok, engine.apply(0, &.{.{ 1, range[0], range[1], range[0], range[1], 1 }}));
        try equal(core.Status.ok, engine.configurePriceScale(1, 0));
        _ = engine.frame(900, 600, &rows, &meta);
        try equal(scale.Mode.logarithmic, engine.priceAxis(&meta).effective);
        const lower_padding = range[0] - meta[0];
        const upper_padding = meta[1] - range[1];
        if (range[0] == 4e6) {
            const span = range[1] - range[0];
            try expect(lower_padding > span * 0.07 and lower_padding < span * 0.09);
            try expect(upper_padding > span * 0.07 and upper_padding < span * 0.09);
        } else {
            try near(@as(f64, 1), lower_padding, 0.001);
            try near(@as(f64, 1), upper_padding, 0.001);
        }
    }
}

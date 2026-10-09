const std = @import("std");
const core = @import("engine.zig");
const equal = std.testing.expectEqual;
const expect = std.testing.expect;
var engine: core.Engine = .{};

test "all eight average sources retain fractional units and full-period seeds" {
    const bars = [_]core.Row{
        .{ 1, 10, 21, 4, 14, 77 },  .{ 2, 16, 23, 8, 19, 88 },
        .{ 3, 18, 28, 11, 25, 99 }, .{ 4, 20, 30, 15, 22, 11 },
    };
    const prices = [_][8]f64{
        .{ 14, 10, 21, 4, 12.5, 13, 12.25, 13.25 },
        .{ 19, 16, 23, 8, 15.5, 50.0 / 3.0, 16.5, 17.25 },
        .{ 25, 18, 28, 11, 19.5, 64.0 / 3.0, 20.5, 22.25 },
        .{ 22, 20, 30, 15, 22.5, 67.0 / 3.0, 21.75, 22.25 },
    };
    for (0..8) |id| {
        const source: core.averages.Source = @enumFromInt(id);
        for (bars, prices) |bar, row| try equal(row[id], core.averages.sourceValue(bar, source));
        var output: [4]f64 = undefined;
        const seed = (prices[0][id] + prices[1][id] + prices[2][id]) / 3;
        for ([_]bool{ false, true }) |exponential| {
            core.averages.updateSource(&bars, &output, 0, 3, exponential, source);
            try expect(std.math.isNan(output[0]) and std.math.isNan(output[1]));
            try equal(seed, output[2]);
            const fourth = if (exponential) seed + 0.5 * (prices[3][id] - seed) else (prices[1][id] + prices[2][id] + prices[3][id]) / 3;
            try std.testing.expectApproxEqAbs(fourth, output[3], 1e-12);
            core.averages.updateSource(&bars, &output, 0, 1, exponential, source);
            for (prices, output) |row, value| try std.testing.expectApproxEqAbs(row[id], value, 1e-12);
        }
    }
    const large: core.Row = .{ 5, 999999999999, 1000000000000, 999999999997, 999999999998, 1 };
    try equal(@as(f64, 999999999998.5), core.averages.sourceValue(large, .hl2));
    try equal(@as(f64, 999999999998.25), core.averages.sourceValue(large, .hlcc4));
}

test "fractional high-price windows retain exact weighted sums after long history and revisions" {
    engine.reset();
    for (engine.bars[0..core.capacity], 0..) |*bar, i| {
        const p: f64 = 999999999990 - @as(f64, @floatFromInt(i % 7));
        bar.* = .{ @floatFromInt(i + 1), p, p + 2, p - 1, p, 1 };
    }
    engine.len = core.capacity;
    for ([_]core.averages.Source{ .hl2, .hlc3, .ohlc4, .hlcc4 }) |source| {
        for ([_]usize{ 1, 20, 500 }) |window| {
            core.averages.updateSource(engine.bars[0..engine.len], &engine.ma, 0, window, false, source);
            const before = engine.ma[core.capacity - 1];
            core.averages.updateSource(engine.bars[0..engine.len], &engine.ma, core.capacity - 1, window, false, source);
            try equal(before, engine.ma[core.capacity - 1]);
            var numerator: f64 = 0;
            for (engine.bars[core.capacity - window .. core.capacity]) |bar| {
                numerator += switch (source) {
                    .hl2 => bar[2] + bar[3],
                    .hlc3 => bar[2] + bar[3] + bar[4],
                    .ohlc4 => bar[1] + bar[2] + bar[3] + bar[4],
                    .hlcc4 => bar[2] + bar[3] + 2 * bar[4],
                    else => unreachable,
                };
            }
            const divisor: f64 = if (source == .hl2) 2 else if (source == .hlc3) 3 else 4;
            try equal(numerator / (@as(f64, @floatFromInt(window)) * divisor), before);
        }
    }
}

fn expectFreshSources() !void {
    var expected: [64]f64 = undefined;
    const bars = engine.bars[0..engine.len];
    core.averages.updateSource(bars, &expected, 0, engine.ma_period, false, engine.ma_source);
    try equalSeries(expected[0..engine.len], engine.ma[0..engine.len]);
    core.averages.updateSource(bars, &expected, 0, engine.ema_period, true, engine.ema_source);
    try equalSeries(expected[0..engine.len], engine.ema[0..engine.len]);
    for (engine.overlays.config, engine.overlays.sources, 0..) |config, source, slot| {
        if (config[0] == 0) continue;
        core.averages.updateSource(bars, &expected, 0, @intFromFloat(config[1]), config[0] == 2, source);
        try equalSeries(expected[0..engine.len], engine.overlays.values[slot][0..engine.len]);
    }
}

fn equalSeries(expected: []const f64, actual: []const f64) !void {
    for (expected, actual) |a, b| {
        if (std.math.isNan(a)) try expect(std.math.isNan(b)) else try std.testing.expectApproxEqAbs(a, b, 1e-10);
    }
}

test "independent average sources match replacement after revisions corrections and prepends" {
    engine.reset();
    var bars: [52]core.Row = undefined;
    for (&bars, 0..) |*bar, i| {
        const p: f64 = @floatFromInt(100 + i * i);
        bar.* = .{ @floatFromInt(1000 + i * 60), p, p + 21, p - 11, p + 7, 5 };
    }
    try equal(.ok, engine.apply(0, bars[10..45]));
    try equal(.ok, engine.configureIndicatorsV2(5, 7, 3, 1, 0));
    var configs: [6]core.averages.ConfigV2 = undefined;
    for (&configs, 0..) |*config, i| config.* = .{ @floatFromInt(1 + i % 2), @floatFromInt(3 + i), @floatFromInt(2 + i) };
    try equal(.ok, engine.configureOverlaysV2(&configs));
    try expectFreshSources();
    bars[44][1] -= 5;
    bars[44][2] += 7;
    try equal(.ok, engine.apply(2, bars[44..45]));
    try expectFreshSources();
    try equal(.ok, engine.apply(2, bars[45..]));
    try expectFreshSources();
    try equal(.ok, engine.apply(1, bars[0..10]));
    try expectFreshSources();
    bars[3][1] -= 8;
    bars[3][3] -= 2;
    bars[28][2] += 5;
    try equal(.ok, engine.apply(3, &.{ bars[3], bars[28] }));
    try expectFreshSources();
    try equal(.ok, engine.configureIndicatorsV2(500, 500, 3, 7, 6));
    try expect(std.math.isNan(engine.ma[51]) and std.math.isNan(engine.ema[51]));
}

test "source configurations validate atomically preserve pane state and retain legacy close behavior" {
    engine.reset();
    var bars: [40]core.Row = undefined;
    for (&bars, 0..) |*bar, i| {
        const p: f64 = @floatFromInt(100 + i * i);
        bar.* = .{ @floatFromInt(100 + i), p, p + 20, p - 10, p + 5, 1 };
    }
    try equal(.ok, engine.apply(0, &bars));
    try equal(.ok, engine.configureIndicatorsV2(3, 4, 7, 3, 4));
    var configs: [6]core.averages.ConfigV2 = @splat(.{ 0, 20, 0 });
    configs[0] = .{ 1, 3, 7 };
    configs[5] = .{ 2, 4, 4 };
    try equal(.ok, engine.configureOverlaysV2(&configs));
    try equal(.ok, engine.setPaneOrder(.{ 1, 0, 3, 2 }));
    try equal(.ok, engine.setPaneWeights(.{ 4, 3, 2, 1 }));
    try equal(.ok, engine.maximizePane(1));
    engine.setView(10, 12);
    engine.pan(-1);
    const locked = engine.locked_range;
    try expect(locked != null);
    const view = [2]f64{ engine.start, engine.span };
    const old_ma = engine.ma[39];
    const old_ema = engine.ema[39];
    const old_overlay = engine.overlays.values[0][39];
    for ([_]f64{ -1, 8, 0.5, std.math.nan(f64), std.math.inf(f64), -std.math.inf(f64) }) |invalid| {
        try equal(.invalid_data, engine.configureIndicatorsV2(9, 10, 0, 1, invalid));
        try equal(.invalid_data, engine.configureIndicatorsV2(9, 10, 0, invalid, 1));
        var bad = configs;
        bad[0] = .{ 2, 10, 0 };
        bad[5][2] = invalid;
        try equal(.invalid_data, engine.configureOverlaysV2(&bad));
        try equal(@as(usize, 3), engine.ma_period);
        try equal(@as(usize, 4), engine.ema_period);
        try equal(core.averages.Source.low, engine.ma_source);
        try equal(core.averages.Source.hl2, engine.ema_source);
        try equal(@as(u8, 7), engine.indicator_mask);
        try equal(old_ma, engine.ma[39]);
        try equal(old_ema, engine.ema[39]);
        try equal(old_overlay, engine.overlays.values[0][39]);
        try equal(core.averages.Source.hlcc4, engine.overlays.sources[0]);
        try equal(@as(f64, 3), engine.overlays.config[0][1]);
        try equal(locked, engine.locked_range);
    }
    try equal(.invalid_data, engine.configureIndicatorsV2(0, 4, 7, 7, 6));
    var bad_disabled = configs;
    bad_disabled[1][2] = 8;
    try equal(.invalid_data, engine.configureOverlaysV2(&bad_disabled));
    try equal(.ok, engine.configureIndicatorsV2(3, 4, 7, 3, 4));
    try equal(.ok, engine.configureOverlaysV2(&configs));
    try equal(locked, engine.locked_range);
    try equal(.ok, engine.configureIndicatorsV2(3, 4, 7, 2, 4));
    try expect(engine.locked_range == null);
    try expect(old_ma != engine.ma[39]);
    try equal(old_ema, engine.ema[39]);
    try equal(view, .{ engine.start, engine.span });
    try equal([4]usize{ 1, 0, 3, 2 }, engine.pane_order);
    try equal([4]f64{ 4, 3, 2, 1 }, engine.pane_weights);
    try equal(@as(i32, 1), engine.maximized_pane);
    engine.pan(-1);
    configs[0][2] = 1;
    try equal(.ok, engine.configureOverlaysV2(&configs));
    try expect(engine.locked_range == null);
    try equal(old_ema, engine.ema[39]);
    try equal(@as(i32, 1), engine.maximized_pane);
    try equal(.ok, engine.configureIndicators(3, 4, 7));
    try equal(core.averages.Source.close, engine.ma_source);
    try equal(core.averages.Source.close, engine.ema_source);
    var legacy: [6]core.averages.Config = undefined;
    for (configs, &legacy) |config, *row| row.* = config[0..2].*;
    try equal(.ok, engine.configureOverlays(&legacy));
    for (engine.overlays.sources) |source| try equal(core.averages.Source.close, source);
    try expectFreshSources();
    var close_values: [40]f64 = undefined;
    core.averages.update(&bars, &close_values, 0, 3, false);
    try equalSeries(&close_values, engine.ma[0..40]);
    try equal(.ok, engine.configureIndicatorsV2(3, 4, 7, 1, 2));
    try equal(.ok, engine.configureOverlaysV2(&configs));
    engine.reset();
    try equal(core.averages.Source.close, engine.ma_source);
    try equal(core.averages.Source.close, engine.ema_source);
    for (engine.overlays.sources) |source| try equal(core.averages.Source.close, source);
}

test "additional averages validate atomically and resume after corrections and prepends" {
    engine.reset();
    var bars: [40]core.Row = undefined;
    for (&bars, 0..) |*bar, i| {
        const close: f64 = @floatFromInt(i * i + 10);
        bar.* = .{ @floatFromInt(100 + i), close, close, close, close, 1 };
    }
    try equal(.ok, engine.apply(0, bars[10..]));
    var config: [6]core.averages.Config = @splat(.{ 0, 20 });
    config[0] = .{ 1, 5 };
    config[5] = .{ 2, 7 };
    try equal(.ok, engine.configureOverlays(&config));
    try equal(@as(u8, 33), engine.overlays.mask());
    try expect(std.math.isNan(engine.overlays.values[0][3]));
    try equal(.ok, engine.apply(1, bars[0..10]));
    bars[20] = .{ 120, 7, 7, 7, 7, 1 };
    engine.setView(10, 10);
    engine.pan(-1);
    const locked = engine.locked_range;
    try expect(locked != null);
    try equal(.ok, engine.apply(3, bars[20..21]));
    try equal(locked, engine.locked_range);
    var expected: [40]f64 = undefined;
    for ([_]usize{ 0, 5 }) |slot| {
        core.averages.update(&bars, &expected, 0, @intFromFloat(config[slot][1]), slot == 5);
        for (7..40) |i| try std.testing.expectApproxEqAbs(expected[i], engine.overlays.values[slot][i], 1e-9);
    }
    const saved = engine.overlays.values[0][39];
    config[0][1] = 10;
    config[5][1] = 0;
    try equal(.invalid_data, engine.configureOverlays(&config));
    try equal(@as(f64, 5), engine.overlays.config[0][1]);
    try equal(saved, engine.overlays.values[0][39]);
    config = @splat(.{ 0, 20 });
    try equal(.ok, engine.configureOverlays(&config));
    try equal(@as(u8, 0), engine.overlays.mask());
}

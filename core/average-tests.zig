const std = @import("std");
const core = @import("engine.zig");
const equal = std.testing.expectEqual;
const expect = std.testing.expect;
var engine: core.Engine = .{};

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

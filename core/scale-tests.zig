const std = @import("std");
const core = @import("engine.zig");
var engine: core.Engine = .{};
var rows: [core.max_visible]core.FrameRow = undefined;
var meta: [13]f64 = undefined;

test "price scaling preserves its anchor, horizontal view and volume scale" {
    engine.reset();
    const bars = [_]core.Row{ .{ 1, -10, 30, -20, 20, 100 }, .{ 2, 20, 40, -5, 25, 200 } };
    try std.testing.expectEqual(core.Status.ok, engine.apply(0, &bars));
    _ = engine.frame(600, 400, &rows, &meta);
    const before = meta;
    const anchor = before[1] - (before[1] - before[0]) * 0.25;
    engine.scalePrice(2, 0.25);
    _ = engine.frame(600, 400, &rows, &meta);
    try std.testing.expectApproxEqAbs((before[1] - before[0]) / 2, meta[1] - meta[0], 1e-9);
    try std.testing.expectApproxEqAbs(anchor, meta[1] - (meta[1] - meta[0]) * 0.25, 1e-9);
    try std.testing.expectEqualSlices(f64, before[2..], meta[2..]);
    const locked = meta;
    const revision = [_]core.Row{.{ 2, 20, 900, -500, 25, 9000 }};
    try std.testing.expectEqual(core.Status.ok, engine.apply(2, &revision));
    _ = engine.frame(600, 400, &rows, &meta);
    try std.testing.expectEqualSlices(f64, locked[0..3], meta[0..3]);
    engine.resetScale();
    _ = engine.frame(600, 400, &rows, &meta);
    try std.testing.expect(meta[0] < -500 and meta[1] > 900);
    try std.testing.expectEqualSlices(f64, before[8..10], meta[8..10]);
}

test "price scale rejects invalid inputs and bounds extreme ranges" {
    engine.reset();
    engine.scalePrice(2, 0.5);
    try std.testing.expect(engine.locked_range == null);
    const bars = [_]core.Row{.{ 1, 1e12, 1e12, 1e12, 1e12, 0 }};
    try std.testing.expectEqual(core.Status.ok, engine.apply(0, &bars));
    for ([_]f64{ 0, -1, core.nan, std.math.inf(f64) }) |factor| engine.scalePrice(factor, 0.5);
    engine.scalePrice(2, core.nan);
    engine.scalePrice(1, 0.5);
    try std.testing.expect(engine.locked_range == null);
    engine.scalePrice(1e-300, 0.5);
    const wide = engine.locked_range.?;
    try std.testing.expectEqual(@as(f64, 4e12), wide[1] - wide[0]);
    try std.testing.expect(wide[0] >= -4e12 and wide[1] <= 4e12);
    engine.scalePrice(1e300, 0.5);
    const narrow = engine.locked_range.?;
    try std.testing.expectEqual(@as(f64, 2), narrow[1] - narrow[0]);
    try std.testing.expect(std.math.isFinite(narrow[0]) and std.math.isFinite(narrow[1]));
}

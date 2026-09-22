const std = @import("std");
const core = @import("engine.zig");
const measurement = @import("measurement.zig");
const equal = std.testing.expectEqual;
const expect = std.testing.expect;
var engine: core.Engine = .{};
var bars: [core.capacity]core.Row = undefined;
var meta: [13]f64 = undefined;

test "measurement distinguishes signed slots from elapsed time and includes both volume endpoints" {
    engine.reset();
    const input = [_]core.Row{ .{ 1000, 100, 110, 90, 100, 1 }, .{ 3000, 100, 110, 90, 100, 2 }, .{ 10000, 100, 110, 90, 100, 3 } };
    try equal(.ok, engine.apply(0, &input));
    try expect(engine.frameMetadata(900, 600, &meta));
    const forward = measurement.measure(&engine, &meta, .{ 1000, 100 }, .{ 10000, 120 }).?;
    try equal([_]f64{ 20, 20, 2, 9000, 6, 3 }, forward[4..10].*);
    const reverse = measurement.measure(&engine, &meta, .{ 10000, 120 }, .{ 1000, 100 }).?;
    try equal(@as(f64, -20), reverse[4]);
    try std.testing.expectApproxEqAbs(@as(f64, -100.0 / 6.0), reverse[5], 1e-12);
    try equal([_]f64{ -2, -9000, 6, 3 }, reverse[6..10].*);
    const same = measurement.measure(&engine, &meta, .{ 3000, 0 }, .{ 3000, 10 }).?;
    try expect(std.math.isNan(same[5]));
    try equal([_]f64{ 0, 0, 2, 1 }, same[6..10].*);
    const negative = measurement.measure(&engine, &meta, .{ 1000, -100 }, .{ 3000, -50 }).?;
    try equal(@as(f64, 50), negative[5]);
    for ([_]measurement.Anchor{ .{ 1001, 100 }, .{ 1000, 0.5 }, .{ 1000, core.nan }, .{ 1000, 1e12 + 1 } }) |invalid| {
        try equal(@as(?measurement.Output, null), measurement.measure(&engine, &meta, invalid, .{ 10000, 100 }));
    }
}

test "measurement sums exact integer volume and only exposes JavaScript-safe totals" {
    engine.reset();
    for (&bars, 0..) |*bar, i| bar.* = .{ @floatFromInt(i), 100, 101, 99, 100, 1e12 };
    bars[9007][5] = 199_254_740_991;
    try equal(.ok, engine.apply(0, &bars));
    try expect(engine.frameMetadata(900, 600, &meta));
    const boundary = measurement.measure(&engine, &meta, .{ 0, -1e12 }, .{ 9007, 1e12 }).?;
    try equal(@as(f64, 9_007_199_254_740_991), boundary[8]);
    try equal(@as(f64, 2e12), boundary[4]);
    bars[9007][5] += 1;
    try equal(.ok, engine.apply(3, bars[9007..9008]));
    const overflow = measurement.measure(&engine, &meta, .{ 0, 100 }, .{ 9007, 100 }).?;
    try expect(std.math.isNan(overflow[8]));
    const maximum = measurement.measure(&engine, &meta, .{ 0, 100 }, .{ 99999, 100 }).?;
    try expect(std.math.isNan(maximum[8]));
    try equal(@as(f64, 100000), maximum[9]);
}

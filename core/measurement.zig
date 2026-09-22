const core = @import("engine.zig");
const drawings = @import("drawings.zig");

pub const Anchor = [2]f64; // Loaded timestamp, integer price.
pub const Output = [10]f64; // x1, y1, x2, y2, price delta, percent, signed slots, elapsed ms, volume, count.
const maximum_safe_integer: u64 = 9_007_199_254_740_991;

/// Measure loaded bars inclusively, using the shared price transform and exact integer volume.
pub fn measure(engine: *const core.Engine, meta: *const [13]f64, a: Anchor, b: Anchor) ?Output {
    const input = [_]drawings.Input{.{ 1, a[0], a[1], b[0], b[1], 0 }};
    var geometry: [1]drawings.Geometry = undefined;
    drawings.project(engine, meta, &input, &geometry);
    if (geometry[0][0] != 1) return null;
    const first = drawings.indexAtTime(engine, a[0]).?;
    const last = drawings.indexAtTime(engine, b[0]).?;
    const lower = @min(first, last);
    const upper = @max(first, last);
    var volume: u64 = 0;
    for (engine.bars[lower .. upper + 1]) |bar| volume += @intFromFloat(bar[5]);
    const delta = b[1] - a[1];
    const distance = @as(i64, @intCast(last)) - @as(i64, @intCast(first));
    return .{ geometry[0][1], geometry[0][2], geometry[0][3], geometry[0][4], delta, if (a[1] == 0) core.nan else delta / @abs(a[1]) * 100, @floatFromInt(distance), b[0] - a[0], if (volume > maximum_safe_integer) core.nan else @floatFromInt(volume), @floatFromInt(upper - lower + 1) };
}

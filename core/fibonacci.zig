const std = @import("std");
const Axis = @import("price-scale.zig").Axis;

pub const maximum_levels = 24;
pub const Input = [25]f64; // flags, 24 ratios; NaN disables a level
pub const Level = [6]f64; // valid, ratio, raw price, clipped left x, y, clipped right x
pub const Output = [maximum_levels]Level;
pub const extend_left = 1;
pub const extend_right = 2;
pub const reverse = 4;
pub const logarithmic = 8;
pub const trend = 16;

pub fn flags(input: *const Input) ?u8 {
    const value = input[0];
    if (!std.math.isFinite(value) or value < 0 or value > 31 or @floor(value) != value) return null;
    for (input[1..]) |ratio| {
        if (std.math.isNan(ratio)) continue;
        if (!std.math.isFinite(ratio) or ratio < -10 or ratio > 10) return null;
    }
    return @intFromFloat(value);
}

/// Ratios retrace from B (0) to A (1), independently of screen inversion.
pub fn project(axis: Axis, width: f64, a: f64, b: f64, anchors: [5]f64, input: *const Input) Output {
    var output: Output = @splat(@splat(0));
    const options = flags(input) orelse return output;
    if (!axis.valid or anchors[0] != 1 or !std.math.isFinite(width) or width <= 0) return output;
    const left = if ((options & extend_left) != 0) 0 else @max(0, @min(anchors[1], anchors[3]));
    const right = if ((options & extend_right) != 0) width else @min(width, @max(anchors[1], anchors[3]));
    if (left > right) return output;
    const start = if ((options & reverse) != 0) a else b;
    const finish = if ((options & reverse) != 0) b else a;
    const use_log = (options & logarithmic) != 0 and axis.effective == .logarithmic;
    if (use_log and (start <= 0 or finish <= 0)) return output;
    for (input[1..], 0..) |ratio, index| {
        if (std.math.isNan(ratio)) continue;
        const price = if (ratio == 0) start else if (ratio == 1) finish else if (use_log)
            interpolateLog(start, finish, ratio)
        else
            start + ratio * (finish - start);
        if (!std.math.isFinite(price)) continue;
        const y = axis.toY(price);
        if (!std.math.isFinite(y)) continue;
        output[index] = .{ 1, ratio, price, left, y, right };
    }
    return output;
}

fn interpolateLog(start: f64, finish: f64, ratio: f64) f64 {
    const relative = (finish - start) / start;
    // Preserve narrow high-price ranges without subtracting nearly equal logarithms.
    if (@abs(relative) < 0.5) return start + start * std.math.expm1(ratio * std.math.log1p(relative));
    return @exp(@log(start) + ratio * (@log(finish) - @log(start)));
}

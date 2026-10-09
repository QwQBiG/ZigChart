const std = @import("std");
const scale = @import("price-scale.zig");

pub const capacity = 16;
pub const Input = [2]f64; // integer price, axis label enabled
pub const Output = [3]f64; // integer price, line y, axis label y
const nan = std.math.nan(f64);

/// The current quote has priority; suppress conflicting reference labels, not their lines.
pub fn reserveLabel(output: []Output, y: f64) void {
    if (!std.math.isFinite(y)) return;
    for (output) |*row| {
        if (std.math.isFinite(row[2]) and @abs(row[2] - y) < 22) row[2] = nan;
    }
}
const label_height: f64 = 22;
const label_inset = label_height / 2;

/// Price references never participate in automatic ranges or mutate the viewport.
pub fn project(axis: scale.Axis, input: []const Input, output: []Output) void {
    std.debug.assert(input.len <= capacity);
    std.debug.assert(output.len == input.len);
    var ordered: [capacity]usize = undefined;
    var count: usize = 0;
    const height = axis.bottom - axis.top;
    const valid_axis = axis.valid and std.math.isFinite(axis.top) and std.math.isFinite(axis.bottom) and
        std.math.isFinite(height) and height > 0 and std.math.isFinite(axis.minimum) and
        std.math.isFinite(axis.maximum) and axis.maximum > axis.minimum;
    const available: usize = if (valid_axis)
        @intFromFloat(@min(@as(f64, capacity), @floor(height / label_height)))
    else
        0;
    for (input, output, 0..) |row, *result, index| {
        result.* = .{ row[0], nan, nan };
        if (!valid_axis) continue;
        if (!std.math.isFinite(row[0]) or @floor(row[0]) != row[0] or @abs(row[0]) > 1e12) continue;
        if (row[0] < axis.minimum or row[0] > axis.maximum) continue;
        const y = axis.toY(row[0]);
        if (!std.math.isFinite(y)) continue;
        // Validate raw bounds before clamping projection roundoff at the pane edges.
        result[1] = std.math.clamp(y, axis.top, axis.bottom);
        if (row[1] != 1 or count >= available) continue;
        result[2] = std.math.clamp(y, axis.top + label_inset, axis.bottom - label_inset);
        var slot = count;
        while (slot > 0 and output[ordered[slot - 1]][2] > result[2]) : (slot -= 1) ordered[slot] = ordered[slot - 1];
        ordered[slot] = index;
        count += 1;
    }
    for (0..count) |slot| {
        if (slot > 0) output[ordered[slot]][2] = @max(output[ordered[slot]][2], output[ordered[slot - 1]][2] + label_height);
    }
    var remaining = count;
    var ceiling = axis.bottom - label_inset;
    while (remaining > 0) {
        remaining -= 1;
        const index = ordered[remaining];
        output[index][2] = @min(output[index][2], ceiling);
        ceiling = output[index][2] - label_height;
    }
}

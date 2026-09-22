const std = @import("std");

pub const minimum_bar_spacing = 6;
pub const minimum_span = 10;
pub const maximum_span = 2000;
pub const minimum_pane_split = 0.30;
pub const maximum_pane_split = 0.85;
pub const default_weights = [4]f64{ 0.74, 0.26, 0.26, 0.26 };
pub const default_order = [4]usize{ 0, 1, 2, 3 };
pub const minimum_pane_height: f64 = 64;

pub const Pane = struct {
    id: usize,
    top: f64,
    bottom: f64,
    content_top: f64,
    content_bottom: f64,
    minimum: f64 = 0,
    maximum: f64 = 1,

    pub fn toY(self: Pane, value: f64) f64 {
        return self.content_bottom - (value - self.minimum) / (self.maximum - self.minimum) * (self.content_bottom - self.content_top);
    }

    pub fn atY(self: Pane, y: f64) f64 {
        return self.minimum + (self.content_bottom - y) / (self.content_bottom - self.content_top) * (self.maximum - self.minimum);
    }

    pub fn row(self: Pane) [7]f64 {
        return .{ @floatFromInt(self.id), self.top, self.bottom, self.content_top, self.content_bottom, self.minimum, self.maximum };
    }
};

pub const Stack = struct {
    panes: [4]Pane = undefined,
    count: usize = 0,
    minimum: f64 = 0,
    scale: f64 = 0,
    weight_max: f64 = 1,

    pub fn find(self: *const Stack, id: usize) ?Pane {
        for (self.panes[0..self.count]) |pane| if (pane.id == id) return pane;
        return null;
    }
};

pub const Tick = [3]f64; // pane id, raw value, CSS y
pub const maximum_ticks = 48;

pub fn ticks(panes: *const Stack, output: *[maximum_ticks]Tick) usize {
    var count: usize = 0;
    for (panes.panes[0..panes.count]) |pane| {
        if (pane.id == 0) continue;
        const id: f64 = @floatFromInt(pane.id);
        if (pane.id == 1 or pane.id == 2) {
            output[count] = .{ id, pane.minimum, pane.toY(pane.minimum) };
            count += 1;
            if (pane.id == 2 and pane.content_bottom - pane.content_top >= 48) {
                output[count] = .{ id, 50, pane.toY(50) };
                count += 1;
            }
            output[count] = .{ id, pane.maximum, pane.toY(pane.maximum) };
            count += 1;
            continue;
        }
        const target = std.math.clamp(@floor((pane.content_bottom - pane.content_top) / 64), 2, 14);
        const step = @import("price-scale.zig").niceStep((pane.maximum - pane.minimum) / target);
        const first = @ceil(pane.minimum / step);
        for (0..16) |i| {
            const value = (first + @as(f64, @floatFromInt(i))) * step;
            if (value > pane.maximum) break;
            output[count] = .{ id, if (value == 0) 0 else value, pane.toY(value) };
            count += 1;
        }
    }
    return count;
}

/// Only active weights participate. Small canvases fit all panes deterministically.
pub fn stack(height: f64, weights: [4]f64, active: u8) Stack {
    return orderedStack(height, weights, active, default_order);
}

pub fn orderedStack(height: f64, weights: [4]f64, active: u8, order: [4]usize) Stack {
    var result: Stack = .{};
    if (!std.math.isFinite(height) or height <= 0) return result;
    var ids: [4]usize = undefined;
    var maximum: f64 = 0;
    for (order) |id| {
        if ((active & (@as(u8, 1) << @intCast(id))) == 0) continue;
        ids[result.count] = id;
        result.count += 1;
        maximum = @max(maximum, weights[id]);
    }
    if (result.count == 0) return result;
    result.minimum = @min(minimum_pane_height, height / @as(f64, @floatFromInt(result.count)));
    result.weight_max = maximum;
    var normalized: [4]f64 = @splat(0);
    var fixed: [4]bool = @splat(false);
    var heights: [4]f64 = @splat(0);
    var sum: f64 = 0;
    for (ids[0..result.count], 0..) |id, i| {
        normalized[i] = weights[id] / maximum;
        sum += normalized[i];
    }
    var remaining = height;
    for (0..result.count) |_| {
        var changed = false;
        for (0..result.count) |i| {
            if (fixed[i] or sum <= 0) continue;
            if (remaining * normalized[i] / sum < result.minimum) {
                heights[i] = result.minimum;
                remaining -= result.minimum;
                sum -= normalized[i];
                fixed[i] = true;
                changed = true;
            }
        }
        if (!changed) break;
    }
    result.scale = if (sum > 0) remaining / sum else 0;
    var top: f64 = 0;
    const legacy = (active & 12) == 0;
    for (ids[0..result.count], 0..) |id, i| {
        if (!fixed[i]) heights[i] = normalized[i] * result.scale;
        const bottom = if (i + 1 == result.count) height else top + heights[i];
        const pane_height = bottom - top;
        const top_padding = if (id == 0) @min(height * 0.04, pane_height * 0.2) else if (legacy)
            @min(height * 0.015, pane_height * 0.2)
        else
            @min(24, pane_height * 0.25);
        const bottom_padding = @min(height * (if (i + 1 == result.count) @as(f64, 0.02) else 0.015), pane_height * 0.2);
        result.panes[i] = .{ .id = id, .top = top, .bottom = bottom, .content_top = top + top_padding, .content_bottom = bottom - bottom_padding };
        top = bottom;
    }
    return result;
}

pub fn maximumSpan(width: f64) f64 {
    if (width <= 0) return maximum_span;
    return std.math.clamp(width / minimum_bar_spacing, minimum_span, maximum_span);
}

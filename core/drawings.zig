const std = @import("std");
const core = @import("engine.zig");
pub const fibonacci = @import("fibonacci.zig");
pub const LevelBatch = struct { input: []const fibonacci.Input, output: []const fibonacci.Output };

pub const capacity = 256;
pub const Input = [6]f64; // kind (0..8), time/price a, time/price b, reserved
pub const Geometry = [5]f64; // valid, x1, y1, x2, y2
pub const Point = [3]f64; // timestamp, integer price, bar index
pub const Hit = [2]f64; // batch index, handle (0 = body, 1 = a, 2 = b)
pub const TextBounds = [2]f64; // Browser-measured width and height in CSS pixels.

fn integer(value: f64, minimum: f64, maximum: f64) bool {
    return std.math.isFinite(value) and value >= minimum and value <= maximum and @floor(value) == value;
}

pub fn indexAtTime(engine: *const core.Engine, time: f64) ?usize {
    if (!integer(time, 0, 8.64e15)) return null;
    var low: usize = 0;
    var high = engine.len;
    while (low < high) {
        const middle = low + (high - low) / 2;
        if (engine.bars[middle][0] < time) low = middle + 1 else high = middle;
    }
    return if (low < engine.len and engine.bars[low][0] == time) low else null;
}

fn validSpace(meta: *const [13]f64) bool {
    for (meta) |value| if (!std.math.isFinite(value)) return false;
    return meta[11] > 0 and meta[12] > 0 and meta[9] > 0 and meta[1] > meta[0] and meta[4] > meta[3];
}

fn anchor(engine: *const core.Engine, meta: *const [13]f64, axis: core.price_scale.Axis, time: f64, price: f64) ?[2]f64 {
    if (!integer(price, -1e12, 1e12)) return null;
    const index = indexAtTime(engine, time) orelse return null;
    const x = (@as(f64, @floatFromInt(index)) + 0.5 - meta[8]) / meta[9] * meta[11];
    const y = axis.toY(price);
    if (!std.math.isFinite(x) or !std.math.isFinite(y)) return null;
    return .{ x, y };
}

pub fn project(engine: *const core.Engine, meta: *const [13]f64, input: []const Input, output: []Geometry) void {
    const axis = engine.priceAxis(meta);
    for (input, output) |row, *result| {
        result.* = @splat(0);
        if (!validSpace(meta) or !integer(row[0], 0, 8)) continue;
        const a = anchor(engine, meta, axis, row[1], row[2]) orelse continue;
        const b = if (singleAnchor(row[0])) a else anchor(engine, meta, axis, row[3], row[4]) orelse continue;
        result.* = .{ 1, a[0], a[1], b[0], b[1] };
    }
}

fn singleAnchor(kind: f64) bool {
    return kind == 0 or kind == 3 or kind == 6 or kind == 8;
}

/// Clip a parametric line to the price pane. Original anchors stay available for handles.
pub fn stroke(meta: *const [13]f64, kind: f64, geometry: Geometry) ?Geometry {
    if (!validSpace(meta) or geometry[0] != 1 or !integer(kind, 0, 6) or kind == 2) return null;
    for (geometry) |value| if (!std.math.isFinite(value)) return null;
    const x = geometry[1];
    const y = geometry[2];
    const dx = if (kind == 0 or kind == 6) 1 else if (kind == 3) 0 else geometry[3] - x;
    const dy = if (kind == 0 or kind == 6) 0 else if (kind == 3) 1 else geometry[4] - y;
    var first: f64 = if (kind == 0 or kind == 3 or kind == 5) -std.math.inf(f64) else 0;
    var last: f64 = if (kind == 1) 1 else std.math.inf(f64);
    if (dx == 0 and dy == 0) {
        return if (x >= 0 and x <= meta[11] and y >= meta[3] and y <= meta[4]) geometry else null;
    }
    const axes = [_][4]f64{ .{ x, dx, 0, meta[11] }, .{ y, dy, meta[3], meta[4] } };
    for (axes) |axis| {
        const origin, const delta, const lower, const upper = axis;
        if (delta == 0) {
            if (origin < lower or origin > upper) return null;
        } else {
            const a = (lower - origin) / delta;
            const b = (upper - origin) / delta;
            first = @max(first, @min(a, b));
            last = @min(last, @max(a, b));
            if (first > last) return null;
        }
    }
    return .{ 1, std.math.clamp(x + first * dx, 0, meta[11]), std.math.clamp(y + first * dy, meta[3], meta[4]), std.math.clamp(x + last * dx, 0, meta[11]), std.math.clamp(y + last * dy, meta[3], meta[4]) };
}

pub fn point(engine: *const core.Engine, meta: *const [13]f64, x: f64, y: f64) ?Point {
    if (!validSpace(meta) or !std.math.isFinite(y) or y < meta[3] or y > meta[4]) return null;
    const index = engine.hit(x, meta[11]);
    if (index < 0) return null;
    const price = @round(engine.priceAxis(meta).atY(y));
    if (!integer(price, -1e12, 1e12)) return null;
    return .{ engine.bars[@intCast(index)][0], price, @floatFromInt(index) };
}

pub fn translate(engine: *const core.Engine, time: f64, price: f64, slots: f64, delta: f64) ?Point {
    if (!integer(price, -1e12, 1e12) or !integer(slots, -core.capacity, core.capacity) or !integer(delta, -2e12, 2e12)) return null;
    const index = indexAtTime(engine, time) orelse return null;
    const next = @as(f64, @floatFromInt(index)) + slots;
    const next_price = price + delta;
    if (next < 0 or next >= @as(f64, @floatFromInt(engine.len)) or !integer(next_price, -1e12, 1e12)) return null;
    return .{ engine.bars[@intFromFloat(next)][0], next_price, next };
}

/// Move a loaded anchor by pointer displacement, including drags starting in blank time space.
pub fn shiftAnchor(engine: *const core.Engine, meta: *const [13]f64, time: f64, price: f64, from: [2]f64, to: [2]f64) ?Point {
    if (!validSpace(meta)) return null;
    for ([_][2]f64{ from, to }) |position| {
        if (!std.math.isFinite(position[0]) or !std.math.isFinite(position[1]) or
            position[0] < 0 or position[0] >= meta[11] or position[1] < meta[3] or position[1] > meta[4]) return null;
    }
    const axis = engine.priceAxis(meta);
    const origin = anchor(engine, meta, axis, time, price) orelse return null;
    const slots = @round((to[0] - from[0]) / meta[11] * meta[9]);
    const next_price = @round(axis.atY(origin[1] + (to[1] - from[1])));
    if (!integer(next_price, -1e12, 1e12) or (axis.effective == .logarithmic and next_price <= 0)) return null;
    return translate(engine, time, price, slots, next_price - price);
}

fn near(x: f64, y: f64, ax: f64, ay: f64, tolerance: f64) bool {
    return @abs(x - ax) <= tolerance and @abs(y - ay) <= tolerance and
        (x - ax) * (x - ax) + (y - ay) * (y - ay) <= tolerance * tolerance;
}

fn nearSegment(x: f64, y: f64, ax: f64, ay: f64, bx: f64, by: f64, tolerance: f64) bool {
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    if (length == 0) return near(x, y, ax, ay, tolerance);
    const fraction = std.math.clamp(((x - ax) * dx + (y - ay) * dy) / length, 0, 1);
    return near(x, y, ax + fraction * dx, ay + fraction * dy, tolerance);
}

pub fn hit(meta: *const [13]f64, input: []const Input, projected: []const Geometry, x: f64, y: f64, tolerance: f64) ?Hit {
    return hitWithLevels(meta, input, projected, null, x, y, tolerance);
}

pub fn hitWithLevels(meta: *const [13]f64, input: []const Input, projected: []const Geometry, levels: ?LevelBatch, x: f64, y: f64, tolerance: f64) ?Hit {
    return hitWithBounds(meta, input, projected, levels, null, x, y, tolerance);
}

fn nearText(meta: *const [13]f64, row: Geometry, bounds: TextBounds, x: f64, y: f64, tolerance: f64) bool {
    for (bounds) |value| if (!std.math.isFinite(value) or value <= 0 or value > 65536) return false;
    const left = @max(0, row[1]);
    const right = @min(meta[11], row[1] + bounds[0]);
    const top = @max(meta[3], row[2]);
    const bottom = @min(meta[4], row[2] + bounds[1]);
    // Fully clipped text is not selectable through an invisible tolerance margin.
    return right > left and bottom > top and x >= left - tolerance and x <= right + tolerance and
        y >= top - tolerance and y <= bottom + tolerance;
}

pub fn hitWithBounds(meta: *const [13]f64, input: []const Input, projected: []const Geometry, levels: ?LevelBatch, text_bounds: ?[]const TextBounds, x: f64, y: f64, tolerance: f64) ?Hit {
    if (!validSpace(meta) or !std.math.isFinite(x) or !std.math.isFinite(y) or
        !std.math.isFinite(tolerance) or tolerance < 0 or tolerance > 64 or
        x < 0 or x >= meta[11] or y < meta[3] or y > meta[4] or projected.len < input.len) return null;
    var remaining = input.len;
    while (remaining > 0) {
        remaining -= 1;
        const row = projected[remaining];
        if (row[0] != 1) continue;
        const index: f64 = @floatFromInt(remaining);
        const kind = input[remaining][0];
        if (kind == 8) {
            if (row[1] >= 0 and row[1] < meta[11] and row[2] >= meta[3] and row[2] <= meta[4] and
                near(x, y, row[1], row[2], tolerance)) return .{ index, 1 };
            if (text_bounds) |bounds| {
                if (remaining < bounds.len and nearText(meta, row, bounds[remaining], x, y, tolerance)) return .{ index, 0 };
            }
            continue;
        }
        if (near(x, y, row[1], row[2], tolerance)) return .{ index, 1 };
        if (!singleAnchor(kind) and near(x, y, row[3], row[4], tolerance)) return .{ index, 2 };
        if (kind == 7) {
            if (levels) |batch| {
                const options = fibonacci.flags(&batch.input[remaining]) orelse continue;
                if ((options & fibonacci.trend) != 0) {
                    if (stroke(meta, 1, row)) |line| {
                        if (nearSegment(x, y, line[1], line[2], line[3], line[4], tolerance)) return .{ index, 0 };
                    }
                }
                for (batch.output[remaining]) |level| {
                    if (level[0] == 1 and level[4] >= meta[3] and level[4] <= meta[4] and
                        nearSegment(x, y, level[3], level[4], level[5], level[4], tolerance)) return .{ index, 0 };
                }
            }
            continue;
        }
        const segment = stroke(meta, kind, row);
        const body = if (segment) |line|
            nearSegment(x, y, line[1], line[2], line[3], line[4], tolerance)
        else if (kind == 2)
            nearSegment(x, y, row[1], row[2], row[3], row[2], tolerance) or
                nearSegment(x, y, row[3], row[2], row[3], row[4], tolerance) or
                nearSegment(x, y, row[3], row[4], row[1], row[4], tolerance) or
                nearSegment(x, y, row[1], row[4], row[1], row[2], tolerance)
        else
            false;
        if (body) return .{ index, 0 };
    }
    return null;
}

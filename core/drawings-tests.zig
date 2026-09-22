const std = @import("std");
const core = @import("engine.zig");
const drawings = @import("drawings.zig");
const equal = std.testing.expectEqual;
const expect = std.testing.expect;
const approx = std.testing.expectApproxEqAbs;
var engine: core.Engine = .{};
var bars: [300]core.Row = undefined;
var frame: [core.max_visible]core.FrameRow = undefined;
var meta: [13]f64 = undefined;

test "drawing line extensions clip in both directions without moving control points" {
    seed();
    meta[3] = 20;
    meta[4] = 400;
    const anchors: drawings.Geometry = .{ 1, 100, 100, 200, 200 };
    try equal(drawings.Geometry{ 1, 100, 100, 400, 400 }, drawings.stroke(&meta, 4, anchors).?);
    try equal(drawings.Geometry{ 1, 20, 20, 400, 400 }, drawings.stroke(&meta, 5, anchors).?);
    try equal(drawings.Geometry{ 1, 200, 200, 20, 20 }, drawings.stroke(&meta, 4, .{ 1, 200, 200, 100, 100 }).?);
    try equal(drawings.Geometry{ 1, 100, 20, 100, 400 }, drawings.stroke(&meta, 3, anchors).?);
    try equal(drawings.Geometry{ 1, 100, 100, 1000, 100 }, drawings.stroke(&meta, 6, anchors).?);
    try equal(anchors, drawings.stroke(&meta, 1, anchors).?);
    const input = [_]drawings.Input{.{ 4, 0, 0, 0, 0, 0 }};
    const output = [_]drawings.Geometry{anchors};
    try equal(drawings.Hit{ 0, 0 }, drawings.hit(&meta, &input, &output, 300, 300, 6).?);
    try equal(@as(?drawings.Hit, null), drawings.hit(&meta, &input, &output, 50, 50, 6));
    try equal(drawings.Hit{ 0, 2 }, drawings.hit(&meta, &input, &output, 200, 200, 6).?);
}

test "drawing clipping handles offscreen, parallel, coincident and invalid lines" {
    seed();
    meta[3] = 20;
    meta[4] = 400;
    const outside: drawings.Geometry = .{ 1, -100, 100, -50, 100 };
    try equal(drawings.Geometry{ 1, 0, 100, 1000, 100 }, drawings.stroke(&meta, 4, outside).?);
    try equal(@as(?drawings.Geometry, null), drawings.stroke(&meta, 1, outside));
    try equal(@as(?drawings.Geometry, null), drawings.stroke(&meta, 4, .{ 1, -50, 100, -100, 100 }));
    try equal(@as(?drawings.Geometry, null), drawings.stroke(&meta, 5, .{ 1, 100, 10, 200, 10 }));
    try equal(@as(?drawings.Geometry, null), drawings.stroke(&meta, 5, .{ 1, core.nan, 10, 200, 10 }));
    const point: drawings.Geometry = .{ 1, 100, 100, 100, 100 };
    try equal(point, drawings.stroke(&meta, 4, point).?);
    try equal(point, drawings.stroke(&meta, 5, point).?);
    try equal(@as(?drawings.Geometry, null), drawings.stroke(&meta, 7, point));
}

fn seed() void {
    engine.reset();
    std.debug.assert(engine.configureIndicators(20, 20, 7) == .ok);
    for (0..300) |i| {
        const price: f64 = @floatFromInt(1000 + i);
        bars[i] = .{ @floatFromInt(10000 + i * 60), price, price + 10, price - 10, price, 100 };
    }
    std.debug.assert(engine.apply(0, &bars) == .ok);
    engine.setView(80, 100);
    _ = engine.frame(1000, 600, &frame, &meta);
}

test "text uses one loaded anchor and has no stroke" {
    seed();
    const input = [_]drawings.Input{.{ 8, bars[120][0], bars[120][4], core.nan, core.nan, 0 }};
    var output: [1]drawings.Geometry = undefined;
    drawings.project(&engine, &meta, &input, &output);
    try equal(@as(f64, 1), output[0][0]);
    try approx(frame[40][9], output[0][1], 1e-10);
    try approx(frame[40][13], output[0][2], 1e-10);
    try equal(output[0][1], output[0][3]);
    try equal(output[0][2], output[0][4]);
    try equal(@as(?drawings.Geometry, null), drawings.stroke(&meta, 8, output[0]));
    try equal(drawings.Hit{ 0, 1 }, drawings.hit(&meta, &input, &output, output[0][1], output[0][2], 6).?);
    try equal(@as(?drawings.Hit, null), drawings.hit(&meta, &input, &output, output[0][1] + 40, output[0][2], 6));
}

test "text boxes hit the full visible body and retain topmost object priority" {
    seed();
    meta[3] = 20;
    meta[4] = 400;
    const input = [_]drawings.Input{ .{ 8, 0, 0, 0, 0, 0 }, .{ 8, 0, 0, 0, 0, 0 } };
    const output = [_]drawings.Geometry{ .{ 1, 100, 100, 100, 100 }, .{ 1, 120, 110, 120, 110 } };
    const bounds = [_]drawings.TextBounds{ .{ 100, 40 }, .{ 80, 30 } };
    try equal(drawings.Hit{ 1, 0 }, drawings.hitWithBounds(&meta, &input, &output, null, &bounds, 150, 130, 6).?);
    try equal(drawings.Hit{ 1, 1 }, drawings.hitWithBounds(&meta, &input, &output, null, &bounds, 120, 110, 6).?);
    try equal(drawings.Hit{ 0, 0 }, drawings.hitWithBounds(&meta, input[0..1], output[0..1], null, &bounds, 205, 130, 6).?);
    try equal(@as(?drawings.Hit, null), drawings.hitWithBounds(&meta, &input, &output, null, &bounds, 207, 130, 6));
    for ([_]drawings.TextBounds{ .{ 0, 40 }, .{ 40, -1 }, .{ core.nan, 40 }, .{ 40, std.math.inf(f64) }, .{ 65537, 40 } }) |invalid| {
        try equal(@as(?drawings.Hit, null), drawings.hitWithBounds(&meta, input[0..1], output[0..1], null, &.{invalid}, 150, 130, 6));
    }
    try equal(@as(?drawings.Hit, null), drawings.hitWithBounds(&meta, &input, &output, null, &.{}, 150, 130, 6));
    const partial = [_]drawings.Geometry{.{ 1, -20, 390, -20, 390 }};
    try equal(drawings.Hit{ 0, 0 }, drawings.hitWithBounds(&meta, input[0..1], &partial, null, &bounds, 30, 395, 6).?);
    try equal(@as(?drawings.Hit, null), drawings.hitWithBounds(&meta, input[0..1], &partial, null, &bounds, 30, 401, 6));
    const hidden = [_]drawings.Geometry{.{ 1, 100, 401, 100, 401 }};
    try equal(@as(?drawings.Hit, null), drawings.hitWithBounds(&meta, input[0..1], &hidden, null, &bounds, 100, 399, 6));
}

test "text body shifts start in blank time space but retain loaded anchors and price transforms" {
    seed();
    engine.setView(259.5, 50);
    for (0..4) |mode| {
        for ([_]f64{ 0, 1 }) |inverted| {
            try equal(core.Status.ok, engine.configurePriceScale(@floatFromInt(mode), inverted));
            _ = engine.frame(1000, 600, &frame, &meta);
            const axis = engine.priceAxis(&meta);
            const price = bars[298][4];
            const y = axis.toY(price);
            const from = [2]f64{ 900, y + 10 };
            const to = [2]f64{ 880, y + 20 };
            try equal(@as(?drawings.Point, null), drawings.point(&engine, &meta, from[0], from[1]));
            const moved = drawings.shiftAnchor(&engine, &meta, bars[298][0], price, from, to).?;
            try equal(bars[297][0], moved[0]);
            try equal(@round(axis.atY(y + 10)), moved[1]);
            try equal(@as(?drawings.Point, null), drawings.shiftAnchor(&engine, &meta, bars[298][0], price, from, .{ 960, from[1] }));
            try equal(@as(?drawings.Point, null), drawings.shiftAnchor(&engine, &meta, bars[298][0], price, from, .{ core.nan, from[1] }));
            try equal(@as(?drawings.Point, null), drawings.shiftAnchor(&engine, &meta, bars[298][0], price, from, .{ 880, meta[4] + 1 }));
        }
    }
}

test "drawing anchors share candle transforms and survive prepend with locked pan" {
    seed();
    const row = frame[40];
    const inputs = [_]drawings.Input{.{ 1, row[1], row[5], bars[150][0], bars[150][4], 0 }};
    var output: [1]drawings.Geometry = undefined;
    drawings.project(&engine, &meta, &inputs, &output);
    try equal(@as(f64, 1), output[0][0]);
    try approx(row[9], output[0][1], 1e-10);
    try approx(row[13], output[0][2], 1e-10);
    const original = output[0];
    engine.pan(10);
    _ = engine.frame(1000, 600, &frame, &meta);
    drawings.project(&engine, &meta, &inputs, &output);
    try approx(original[1] - 100, output[0][1], 1e-10);
    try approx(original[2], output[0][2], 1e-10);
    const shifted = output[0];
    const older = [_]core.Row{.{ 9940, -500, -490, -510, -500, 1000 }};
    try equal(core.Status.ok, engine.apply(1, &older));
    _ = engine.frame(1000, 600, &frame, &meta);
    drawings.project(&engine, &meta, &inputs, &output);
    try equal(shifted, output[0]);
    engine.zoom(2, 0.5);
    _ = engine.frame(1000, 600, &frame, &meta);
    drawings.project(&engine, &meta, &inputs, &output);
    const point = drawings.point(&engine, &meta, output[0][1], output[0][2]).?;
    try equal(inputs[0][1], point[0]);
    try equal(inputs[0][2], point[1]);
}

test "drawing point rejects volume, future space, invalid dimensions and noninteger anchors" {
    seed();
    engine.follow();
    _ = engine.frame(1000, 600, &frame, &meta);
    try equal(@as(?drawings.Point, null), drawings.point(&engine, &meta, 950, 200));
    try equal(@as(?drawings.Point, null), drawings.point(&engine, &meta, 700, meta[5]));
    try equal(@as(?drawings.Point, null), drawings.point(&engine, &meta, -1, 200));
    try equal(@as(?drawings.Point, null), drawings.point(&engine, &meta, core.nan, 200));
    const inputs = [_]drawings.Input{
        .{ 0, bars[290][0] + 1, 1290, 0, 0, 0 },
        .{ 1, bars[290][0], 1290.5, bars[291][0], 1291, 0 },
        .{ 7, bars[290][0], 1290, 0, 0, 0 },
        .{ 2, bars[290][0], 1290, bars[291][0], core.nan, 0 },
    };
    var output: [inputs.len]drawings.Geometry = undefined;
    drawings.project(&engine, &meta, &inputs, &output);
    for (output) |row| try equal(drawings.Geometry{ 0, 0, 0, 0, 0 }, row);
    _ = engine.frame(0, 600, &frame, &meta);
    try equal(@as(?drawings.Point, null), drawings.point(&engine, &meta, 20, 20));
}

test "drawing translation follows actual time slots and rejects partial moves outside data" {
    seed();
    const translated = drawings.translate(&engine, bars[120][0], -20, -3, 7).?;
    try equal(drawings.Point{ bars[117][0], -13, 117 }, translated);
    try equal(@as(?drawings.Point, null), drawings.translate(&engine, bars[0][0], 1000, -1, 0));
    try equal(@as(?drawings.Point, null), drawings.translate(&engine, bars[299][0], 1000, 1, 0));
    try equal(@as(?drawings.Point, null), drawings.translate(&engine, bars[120][0], 1e12, 0, 1));
    try equal(@as(?drawings.Point, null), drawings.translate(&engine, bars[120][0], 1000, 0.5, 0));
    try equal(@as(?drawings.Point, null), drawings.translate(&engine, bars[120][0] + 1, 1000, 0, 0));
}

test "drawing hits distinguish handles, line segments and rectangle edges in CSS pixels" {
    seed();
    var input = [_]drawings.Input{.{ 1, 0, 0, 0, 0, 0 }};
    const output = [_]drawings.Geometry{.{ 1, 100, 100, 200, 200 }};
    try equal(drawings.Hit{ 0, 1 }, drawings.hit(&meta, &input, &output, 103, 102, 6).?);
    try equal(drawings.Hit{ 0, 2 }, drawings.hit(&meta, &input, &output, 200, 200, 6).?);
    try equal(drawings.Hit{ 0, 0 }, drawings.hit(&meta, &input, &output, 150, 153, 6).?);
    try equal(@as(?drawings.Hit, null), drawings.hit(&meta, &input, &output, 250, 250, 6));
    input[0][0] = 2;
    try equal(drawings.Hit{ 0, 0 }, drawings.hit(&meta, &input, &output, 150, 103, 6).?);
    try equal(@as(?drawings.Hit, null), drawings.hit(&meta, &input, &output, 150, 150, 6));
    input[0][0] = 0;
    try equal(drawings.Hit{ 0, 0 }, drawings.hit(&meta, &input, &output, 900, 104, 6).?);
    try equal(@as(?drawings.Hit, null), drawings.hit(&meta, &input, &output, 900, 107, 6));
    try equal(@as(?drawings.Hit, null), drawings.hit(&meta, &input, &output, 900, 100, -1));
    try equal(@as(?drawings.Hit, null), drawings.hit(&meta, &input, &output, 900, 100, 100));
    const stacked_input = [_]drawings.Input{ input[0], input[0] };
    const stacked_output = [_]drawings.Geometry{ output[0], output[0] };
    try equal(drawings.Hit{ 1, 0 }, drawings.hit(&meta, &stacked_input, &stacked_output, 900, 100, 6).?);
}

test "drawing projection is bounded for a full batch and preserves degenerate shapes" {
    seed();
    var input: [drawings.capacity]drawings.Input = undefined;
    var output: [drawings.capacity]drawings.Geometry = undefined;
    for (&input) |*row| row.* = .{ 2, bars[120][0], bars[120][4], bars[120][0], bars[120][4], 0 };
    drawings.project(&engine, &meta, &input, &output);
    for (output) |row| {
        try equal(@as(f64, 1), row[0]);
        try equal(row[1], row[3]);
        try equal(row[2], row[4]);
    }
    try equal(drawings.Hit{ drawings.capacity - 1, 1 }, drawings.hit(&meta, &input, &output, output[0][1], output[0][2], 6).?);
    engine.reset();
    _ = engine.frame(1000, 600, &frame, &meta);
    drawings.project(&engine, &meta, &input, &output);
    for (output) |row| try expect(row[0] == 0);
}

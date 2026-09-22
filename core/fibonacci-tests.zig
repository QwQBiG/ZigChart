const std = @import("std");
const fib = @import("fibonacci.zig");
const drawings = @import("drawings.zig");
const Axis = @import("price-scale.zig").Axis;
const approx = std.testing.expectApproxEqAbs;
const equal = std.testing.expectEqual;

fn config(options: f64) fib.Input {
    var input: fib.Input = @splat(std.math.nan(f64));
    input[0] = options;
    input[1..8].* = .{ 0, 0.236, 0.382, 0.5, 0.618, 0.786, 1 };
    return input;
}

test "retracements interpolate raw prices and optional log ratios before axis inversion" {
    const anchors: [5]f64 = .{ 1, 100, 200, 500, 100 };
    const linear = Axis.init(.{}, 0, 500, 20, 520, 100, true);
    var input = config(0);
    var result = fib.project(linear, 1000, 100, 400, anchors, &input);
    try equal(@as(f64, 400), result[0][2]);
    try equal(@as(f64, 100), result[6][2]);
    try approx(@as(f64, 214.6), result[4][2], 1e-9);
    try equal(linear.toY(result[4][2]), result[4][4]);
    input[0] = fib.reverse;
    result = fib.project(linear, 1000, 100, 400, anchors, &input);
    try approx(@as(f64, 285.4), result[4][2], 1e-9);
    input[0] = fib.logarithmic;
    result = fib.project(linear, 1000, 100, 400, anchors, &input);
    try equal(@as(f64, 250), result[3][2]);
    for ([_]bool{ false, true }) |inverted| {
        const axis = Axis.init(.{ .mode = .logarithmic, .inverted = inverted }, 50, 800, 20, 520, 100, true);
        result = fib.project(axis, 1000, 100, 400, anchors, &input);
        try approx(@as(f64, 200), result[3][2], 1e-9);
        try approx(axis.toY(200), result[3][4], 1e-9);
    }
    input[0] = 0;
    input[1] = -1;
    input[2] = 2;
    result = fib.project(linear, 1000, 100, 400, anchors, &input);
    try equal(@as(f64, 700), result[0][2]);
    try equal(@as(f64, -200), result[1][2]);
    try equal(@as(f64, 1), result[0][0]); // Retain offscreen levels for clipped band fills.
    input[0] = 32;
    try equal(@as(?u8, null), fib.flags(&input));
    input[0] = 0;
    input[1] = std.math.inf(f64);
    try equal(@as(?u8, null), fib.flags(&input));
}

test "log retracements retain precision in narrow high-price ranges" {
    const a: f64 = 999_999_999_000;
    const b: f64 = 999_999_999_100;
    const axis = Axis.init(.{ .mode = .logarithmic }, a - 100, b + 100, 20, 520, a, true);
    var input = config(fib.logarithmic);
    const result = fib.project(axis, 1000, a, b, .{ 1, 100, axis.toY(a), 500, axis.toY(b) }, &input);
    try approx(@as(f64, 999_999_999_050), result[3][2], 0.00013);
    try approx(axis.toY(999_999_999_050), result[3][4], 0.001);
}

test "extended levels share pane clipping and anchor hit priority" {
    const axis = Axis.init(.{}, 0, 300, 20, 320, 100, true);
    const anchors: drawings.Geometry = .{ 1, 100, 220, 500, 120 };
    var config_input = config(fib.extend_left | fib.extend_right);
    const levels = fib.project(axis, 1000, 100, 200, anchors, &config_input);
    try equal(@as(f64, 0), levels[4][3]);
    try equal(@as(f64, 1000), levels[4][5]);
    const meta: [13]f64 = .{ 0, 300, 100, 20, 320, 320, 320, 7, 0, 100, 100, 1000, 320 };
    const input = [_]drawings.Input{.{ 7, 0, 100, 0, 200, 0 }};
    const batch = drawings.LevelBatch{ .input = &.{config_input}, .output = &.{levels} };
    try equal(drawings.Hit{ 0, 0 }, drawings.hitWithLevels(&meta, &input, &.{anchors}, batch, 900, levels[4][4], 2).?);
    try equal(@as(?drawings.Hit, null), drawings.hitWithLevels(&meta, &input, &.{anchors}, batch, 900, 10, 6));
    try equal(drawings.Hit{ 0, 1 }, drawings.hitWithLevels(&meta, &input, &.{anchors}, batch, 100, 220, 2).?);
    config_input[0] = 0;
    const bounded = fib.project(axis, 1000, 100, 200, anchors, &config_input);
    try equal(@as(f64, 100), bounded[4][3]);
    try equal(@as(f64, 500), bounded[4][5]);
}

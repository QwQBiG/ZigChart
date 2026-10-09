const std = @import("std");
const scale = @import("price-scale.zig");
const lines = @import("price-lines.zig");
const expect = std.testing.expect;
const equal = std.testing.expectEqual;
const approx = std.testing.expectApproxEqAbs;

fn expectHidden(row: lines.Output) !void {
    try expect(std.math.isNan(row[1]));
    try expect(std.math.isNan(row[2]));
}

fn expectLabels(output: []const lines.Output, top: f64, bottom: f64, expected: usize) !void {
    var count: usize = 0;
    for (output, 0..) |row, i| {
        if (!std.math.isFinite(row[2])) continue;
        count += 1;
        try expect(row[2] >= top + 11 and row[2] <= bottom - 11);
        for (output[0..i]) |previous| {
            if (std.math.isFinite(previous[2])) try expect(@abs(row[2] - previous[2]) >= 22 - 1e-9);
        }
    }
    try equal(expected, count);
}

test "price lines use the shared regular and inverted axis and retain raw prices" {
    const input = [_]lines.Input{ .{ 100, 1 }, .{ 150, 1 }, .{ 200, 1 } };
    var output: [input.len]lines.Output = undefined;
    for ([_]bool{ false, true }) |inverted| {
        const axis = scale.Axis.init(.{ .inverted = inverted }, 100, 200, 10, 230, 100, true);
        lines.project(axis, &input, &output);
        for (output, input) |result, row| {
            try equal(row[0], result[0]);
            try approx(axis.toY(row[0]), result[1], 1e-9);
        }
        try approx(@as(f64, if (inverted) 10 else 230), output[0][1], 1e-9);
        try approx(@as(f64, 120), output[1][1], 1e-9);
        try approx(@as(f64, if (inverted) 230 else 10), output[2][1], 1e-9);
        try expectLabels(&output, 10, 230, 3);
    }
}

test "price lines honor logarithmic projection and reject nonpositive log prices" {
    const input = [_]lines.Input{ .{ 1, 1 }, .{ 10, 1 }, .{ 100, 1 }, .{ 0, 1 }, .{ -1, 1 } };
    var output: [input.len]lines.Output = undefined;
    for ([_]bool{ false, true }) |inverted| {
        const axis = scale.Axis.init(.{ .mode = .logarithmic, .inverted = inverted }, 1, 100, 20, 220, 10, true);
        lines.project(axis, &input, &output);
        for (output[0..3], input[0..3]) |result, row| try approx(axis.toY(row[0]), result[1], 1e-9);
        try approx(@as(f64, 120), output[1][1], 1e-9);
        try expectHidden(output[3]);
        try expectHidden(output[4]);
        try expectLabels(&output, 20, 220, 3);
    }
}

test "price lines validate finite integer bounds and clip prices outside the pane" {
    const input = [_]lines.Input{
        .{ 150.5, 1 },    .{ std.math.nan(f64), 1 }, .{ std.math.inf(f64), 1 }, .{ -std.math.inf(f64), 1 },
        .{ 1e12 + 1, 1 }, .{ -1e12 - 1, 1 },         .{ 99, 1 },                .{ 201, 1 },
        .{ 100, 1 },      .{ 200, 1 },
    };
    var output: [input.len]lines.Output = undefined;
    lines.project(scale.Axis.init(.{}, 100, 200, 0, 200, 100, true), &input, &output);
    for (output[0..8]) |row| try expectHidden(row);
    try equal(@as(f64, 200), output[8][1]);
    try equal(@as(f64, 0), output[9][1]);
    const boundary = [_]lines.Input{ .{ -1e12, 1 }, .{ 1e12, 1 } };
    var boundary_output: [boundary.len]lines.Output = undefined;
    lines.project(scale.Axis.init(.{}, -1e12, 1e12, 0, 200, 1, false), &boundary, &boundary_output);
    try equal(@as(f64, 200), boundary_output[0][1]);
    try equal(@as(f64, 0), boundary_output[1][1]);
    try expectLabels(&boundary_output, 0, 200, 2);
}

test "price lines separate sixteen nearby labels without moving their horizontal lines" {
    var input: [lines.capacity]lines.Input = undefined;
    var output: [lines.capacity]lines.Output = undefined;
    for (&input, 0..) |*row, i| row.* = .{ @floatFromInt(1000 + i), 1 };
    for ([_]bool{ false, true }) |inverted| {
        const axis = scale.Axis.init(.{ .inverted = inverted }, 0, 2000, 0, 400, 1000, false);
        lines.project(axis, &input, &output);
        for (output, input) |result, row| try approx(axis.toY(row[0]), result[1], 1e-9);
        try expectLabels(&output, 0, 400, lines.capacity);
    }
}

test "short price panes limit labels while retaining all valid lines" {
    var input: [lines.capacity]lines.Input = undefined;
    var output: [lines.capacity]lines.Output = undefined;
    for (&input, 0..) |*row, i| row.* = .{ @floatFromInt(1000 + i), 1 };
    for ([_]f64{ 0.5, 21, 22, 43, 44, 70 }) |height| {
        const axis = scale.Axis.init(.{}, 0, 2000, 10, 10 + height, 1000, false);
        lines.project(axis, &input, &output);
        for (output, input) |result, row| try approx(axis.toY(row[0]), result[1], 1e-9);
        try expectLabels(&output, 10, 10 + height, @intFromFloat(@floor(height / 22)));
    }
}

test "only explicit price label flags reserve space and invalid axes clear prior output" {
    const input = [_]lines.Input{ .{ 150, 0 }, .{ 151, 2 }, .{ 152, std.math.nan(f64) }, .{ 153, 1 } };
    var output: [input.len]lines.Output = undefined;
    const axis = scale.Axis.init(.{}, 100, 200, 0, 200, 100, true);
    lines.project(axis, &input, &output);
    for (output[0..3]) |row| {
        try expect(std.math.isFinite(row[1]));
        try expect(std.math.isNan(row[2]));
    }
    try expectLabels(&output, 0, 200, 1);
    var invalid = [_]scale.Axis{ axis, axis, axis, axis, axis };
    invalid[0].valid = false;
    invalid[1].top = std.math.nan(f64);
    invalid[2].bottom = std.math.inf(f64);
    invalid[3].maximum = std.math.inf(f64);
    invalid[4].top = -std.math.floatMax(f64);
    invalid[4].bottom = std.math.floatMax(f64);
    for (invalid) |invalid_axis| {
        lines.project(invalid_axis, &input, &output);
        for (output, input) |result, row| {
            try equal(row[0], result[0]);
            try expectHidden(result);
        }
    }
    var empty: [0]lines.Output = .{};
    lines.project(axis, &.{}, &empty);
}

test "large finite pane height clamps label capacity before integer conversion" {
    const axis = scale.Axis.init(.{}, 100, 200, 0, 1e300, 100, true);
    const input = [_]lines.Input{.{ 150, 1 }};
    var output: [1]lines.Output = undefined;
    lines.project(axis, &input, &output);
    try expect(std.math.isFinite(output[0][1]));
    try expect(std.math.isFinite(output[0][2]));
}

test "log fallback retains negative raw prices and relative axes use the same projection" {
    const input = [_]lines.Input{ .{ -50, 1 }, .{ 0, 1 }, .{ 50, 1 } };
    var output: [input.len]lines.Output = undefined;
    for ([_]scale.Mode{ .logarithmic, .percentage, .indexed }) |mode| {
        const axis = scale.Axis.init(.{ .mode = mode }, -100, 100, 0, 200, -50, false);
        if (mode == .logarithmic) try equal(scale.Mode.normal, axis.effective);
        lines.project(axis, &input, &output);
        for (output, input) |result, row| {
            try equal(row[0], result[0]);
            try approx(axis.toY(row[0]), result[1], 1e-9);
        }
        try expectLabels(&output, 0, 200, 3);
    }
}

test "raw clipping rejects a range-outside integer even when its pixel distance is tiny" {
    const axis = scale.Axis.init(.{}, -1e12, 1e12 - 100, 0, 200, 100, false);
    const input = [_]lines.Input{ .{ 1e12 - 100, 1 }, .{ 1e12 - 99, 1 } };
    var output: [input.len]lines.Output = undefined;
    lines.project(axis, &input, &output);
    try equal(@as(f64, 0), output[0][1]);
    try expectHidden(output[1]);
}

test "reserved quote labels suppress conflicts without changing reference lines" {
    const original = [_]lines.Output{
        .{ 100, 10, 100 }, .{ 101, 20, 121.5 }, .{ 102, 30, 122 },
        .{ 103, 40, 78 }, .{ 104, 50, 75 }, .{ 105, 60, std.math.nan(f64) },
    };
    var output = original;
    lines.reserveLabel(&output, std.math.nan(f64));
    for (output, original) |result, row| {
        if (std.math.isNan(row[2])) try expect(std.math.isNan(result[2])) else try equal(row[2], result[2]);
    }
    lines.reserveLabel(&output, 100);
    for (output, original) |result, row| {
        try equal(row[0], result[0]);
        try equal(row[1], result[1]);
    }
    try expect(std.math.isNan(output[0][2]));
    try expect(std.math.isNan(output[1][2]));
    try equal(@as(f64, 122), output[2][2]);
    try equal(@as(f64, 78), output[3][2]);
    try equal(@as(f64, 75), output[4][2]);
    try expect(std.math.isNan(output[5][2]));
}

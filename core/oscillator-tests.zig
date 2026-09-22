const std = @import("std");
const core = @import("engine.zig");
const layout = @import("layout.zig");
const studies = @import("oscillators.zig");
const equal = std.testing.expectEqual;
const expect = std.testing.expect;
const near = std.testing.expectApproxEqAbs;
var engine: core.Engine = .{};
var values: studies.Store(1200) = .{};
var bars: [1200]core.Row = undefined;

fn bar(index: usize, close: f64) core.Row {
    return .{ @floatFromInt(index), close, close + 2, close - 2, close, 100 };
}

test "RSI Wilder seeds changes and current revisions never accumulate twice" {
    values.reset();
    const input = [_]core.Row{ bar(0, 10), bar(1, 12), bar(2, 11), bar(3, 14) };
    @memcpy(bars[0..input.len], &input);
    try expect(values.configure(.{ 2, 2, 3, 2, 1 }, bars[0..4]));
    try expect(std.math.isNan(values.values(1)[0]));
    try near(@as(f64, 100.0 * 2.0 / 3.0), values.values(2)[0], 1e-10);
    try near(@as(f64, 100.0 * 8.0 / 9.0), values.values(3)[0], 1e-10);
    for (0..4) |_| {
        bars[3] = bar(3, 10);
        values.update(bars[0..4], 3);
        try near(@as(f64, 40), values.values(3)[0], 1e-10);
        bars[3] = bar(3, 14);
        values.update(bars[0..4], 3);
        try near(@as(f64, 100.0 * 8.0 / 9.0), values.values(3)[0], 1e-10);
    }
    for ([_]f64{ -1, 0, 1 }) |direction| {
        for (0..4) |i| bars[i] = bar(i, 10 + @as(f64, @floatFromInt(i)) * direction);
        values.update(bars[0..4], 0);
        try equal(if (direction == 0) @as(f64, 50) else if (direction > 0) @as(f64, 100) else @as(f64, 0), values.values(3)[0]);
    }
}

test "MACD uses SMA-seeded EMAs and first valid signal samples without doubled histogram" {
    values.reset();
    const input = [_]core.Row{ bar(0, 10), bar(1, 12), bar(2, 11), bar(3, 14), bar(4, 13) };
    try expect(values.configure(.{ 2, 2, 3, 2, 2 }, &input));
    try expect(std.math.isNan(values.values(1)[1]));
    try equal(@as(f64, 0), values.values(2)[1]);
    try expect(std.math.isNan(values.values(2)[2]));
    try near(@as(f64, 0.5), values.values(3)[1], 1e-10);
    try near(@as(f64, 0.25), values.values(3)[2], 1e-10);
    try near(@as(f64, 0.25), values.values(3)[3], 1e-10);
    try near(@as(f64, 0), values.values(4)[3], 1e-10);
    const config = values.config;
    for ([_][5]f64{ .{ 0, 2, 3, 2, 2 }, .{ 2, 3, 3, 2, 2 }, .{ 2, 2, 3, 501, 2 }, .{ 2, 2, 3, 2, 4 } }) |invalid| {
        try expect(!values.configure(invalid, &input));
        try equal(config, values.config);
    }
    try expect(values.configure(.{ 2, 2, 3, 2, 0 }, &input));
    const retained = values.macd[3];
    values.update(&.{bar(0, 100)}, 0);
    try equal(retained, values.macd[3]);
    for (values.values(3)) |value| try expect(std.math.isNan(value));
}

test "pane stack fits small surfaces and legacy two-pane boundaries remain stable" {
    const legacy = layout.stack(500, layout.default_weights, 3);
    try near(@as(f64, 370), legacy.panes[0].bottom, 1e-9);
    try near(@as(f64, 362.5), legacy.panes[0].content_bottom, 1e-9);
    try near(@as(f64, 377.5), legacy.panes[1].content_top, 1e-9);
    for ([_]f64{ 32, 128, 256, 720 }) |height| {
        const panes = layout.stack(height, .{ 0.001, 100, 1, 0.0001 }, 15);
        try equal(@as(usize, 4), panes.count);
        try near(height, panes.panes[3].bottom, 1e-8);
        for (panes.panes[0..4], 0..) |pane, i| {
            try expect(pane.bottom - pane.top >= @min(64, height / 4) - 1e-8);
            try expect(pane.top <= pane.content_top and pane.content_top < pane.content_bottom and pane.content_bottom <= pane.bottom);
            if (i > 0) try near(panes.panes[i - 1].bottom, pane.top, 1e-8);
        }
    }
}

test "pane resizing changes only adjacent active sizes and retains inactive weights" {
    engine.reset();
    try equal(core.Status.ok, engine.configureOscillators(14, 12, 26, 9, 3));
    try equal(core.Status.ok, engine.setPaneWeights(.{ 0.001, 0.26, 1, 2 }));
    const before = layout.stack(700, engine.pane_weights, engine.activePanes());
    const weights = engine.pane_weights;
    try equal(core.Status.ok, engine.resizePane(0, 100, 700));
    const after = layout.stack(700, engine.pane_weights, engine.activePanes());
    try near(before.panes[0].bottom + 100, after.panes[0].bottom, 1e-8);
    try near(before.panes[2].top, after.panes[2].top, 1e-8);
    try equal(weights[1], engine.pane_weights[1]);
    try equal(weights[3], engine.pane_weights[3]);
    try equal(core.Status.invalid_data, engine.resizePane(1, 10, 700));
    try equal(core.Status.ok, engine.resizePane(0, -1e6, 700));
    const bounded = layout.stack(700, engine.pane_weights, engine.activePanes());
    try near(@as(f64, 64), bounded.panes[0].bottom, 1e-8);
}

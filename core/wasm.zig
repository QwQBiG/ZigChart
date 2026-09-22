const core = @import("engine.zig");
const drawings = @import("drawings.zig");
const fibonacci = drawings.fibonacci;
const layout = @import("layout.zig");
const measurement = @import("measurement.zig");
const std = @import("std");

// Each module instance owns fixed storage; calls never allocate or grow memory.
var engine: core.Engine = undefined;
var initialized = false;
var fib_input: [drawings.capacity]fibonacci.Input = undefined;
var fib_output: [drawings.capacity]fibonacci.Output = undefined;
var input: [core.capacity]core.Row = undefined;
var rows: [core.max_visible]core.FrameRow = undefined;
var meta: [13]f64 = undefined;
var price_axis: [4]f64 = undefined;
var price_ticks: [core.price_scale.maximum_ticks]core.price_scale.Tick = undefined;
var price_tick_length: usize = 0;
var pane_info: [4][7]f64 = undefined;
var pane_length: usize = 0;
var pane_order: [4]f64 = undefined;
var oscillator_rows: [core.max_visible]core.OscillatorFrameRow = undefined;
var overlay_input: [core.averages.slots]core.averages.Config = undefined;
var overlay_rows: [core.max_visible][core.averages.slots * 2]f64 = undefined;
var bollinger_rows: [core.max_visible]core.BollingerFrameRow = undefined;
var pane_ticks: [layout.maximum_ticks]layout.Tick = undefined;
var pane_tick_length: usize = 0;
// Read-only coordinate calls reuse the latest frame's axes. Every write invalidates them.
var cache_valid = false;
var cached_width: f64 = 0;
var cached_height: f64 = 0;
var cached_axis: core.price_scale.Axis = undefined;
var cached_panes: layout.Stack = undefined;
var inspected: [9]f64 = undefined;
var drawing_input: [drawings.capacity]drawings.Input = undefined;
var drawing_output: [drawings.capacity]drawings.Geometry = undefined;
var drawing_strokes: [drawings.capacity]drawings.Geometry = undefined;
var drawing_text_bounds: [drawings.capacity]drawings.TextBounds = @splat(@splat(0));
var drawing_point_output: drawings.Point = undefined;
var drawing_hit_output: drawings.Hit = undefined;
var measurement_output: measurement.Output = undefined;

fn state() *core.Engine {
    // Initializing only metadata at runtime avoids embedding the storage in the binary.
    if (!initialized) {
        engine.reset();
        initialized = true;
    }
    return &engine;
}

fn mutation() *core.Engine {
    cache_valid = false;
    return state();
}

fn cacheMatches(width: f64, height: f64) bool {
    return cache_valid and width == cached_width and height == cached_height;
}

export fn abi_version() u32 {
    return 1;
}
export fn capacity() u32 {
    return core.capacity;
}
export fn input_ptr() usize {
    return @intFromPtr(&input);
}
export fn apply(mode: u32, count: u32) i32 {
    if (mode > 3) return @intFromEnum(core.Status.bad_mode);
    if (count > core.capacity) return @intFromEnum(core.Status.capacity);
    return @intFromEnum(mutation().apply(mode, input[0..count]));
}
export fn bar_count() u32 {
    return @intCast(state().len);
}
export fn set_view(start: f64, span: f64) void {
    mutation().setView(start, span);
}
export fn fit_time_range(from: f64, to: f64) i32 {
    return mutation().fitTimeRange(from, to);
}
export fn resize_plot(width: f64) void {
    mutation().resizePlot(width);
}
export fn set_pane_split(ratio: f64) void {
    mutation().setPaneSplit(ratio);
}
export fn configure_indicators(ma_period: f64, ema_period: f64, mask: f64) i32 {
    return @intFromEnum(mutation().configureIndicators(ma_period, ema_period, mask));
}
export fn configure_oscillators(rsi: f64, fast: f64, slow: f64, signal: f64, mask: f64) i32 {
    return @intFromEnum(mutation().configureOscillators(rsi, fast, slow, signal, mask));
}
export fn overlay_input_ptr() usize {
    return @intFromPtr(&overlay_input);
}
export fn configure_overlays() i32 {
    return @intFromEnum(mutation().configureOverlays(&overlay_input));
}
export fn overlay_mask() u32 {
    return state().overlays.mask();
}
export fn overlay_frame_ptr() usize {
    return @intFromPtr(&overlay_rows);
}
export fn configure_bollinger(period: u32, multiplier: f64, enabled: u32) i32 {
    return @intFromEnum(mutation().configureBollinger(period, multiplier, enabled));
}
export fn bollinger_enabled() u32 {
    return @intFromBool(state().bands.config.enabled);
}
export fn bollinger_frame_ptr() usize {
    return @intFromPtr(&bollinger_rows);
}
export fn set_pane_weights(price: f64, volume: f64, rsi: f64, macd: f64) i32 {
    return @intFromEnum(mutation().setPaneWeights(.{ price, volume, rsi, macd }));
}
export fn resize_pane(upper: f64, delta: f64, height: f64) i32 {
    return @intFromEnum(mutation().resizePane(upper, delta, height));
}
export fn pane_weights_ptr() usize {
    return @intFromPtr(&state().pane_weights);
}
export fn set_pane_order(a: f64, b: f64, c: f64, d: f64) i32 {
    return @intFromEnum(mutation().setPaneOrder(.{ a, b, c, d }));
}
export fn pane_order_ptr() usize {
    for (state().pane_order, 0..) |id, i| pane_order[i] = @floatFromInt(id);
    return @intFromPtr(&pane_order);
}
export fn move_pane(id: f64, direction: f64) i32 {
    return @intFromEnum(mutation().movePane(id, direction));
}
export fn maximize_pane(id: f64) i32 {
    return @intFromEnum(mutation().maximizePane(id));
}
export fn maximized_pane() i32 {
    return state().maximized_pane;
}
export fn pane_value_to_y(id: f64, value: f64, width: f64, height: f64) f64 {
    if (id == 0) return price_to_y(value, width, height);
    if (!std.math.isFinite(value)) return core.nan;
    if (cacheMatches(width, height)) {
        for (cached_panes.panes[0..cached_panes.count]) |pane| {
            if (id == @as(f64, @floatFromInt(pane.id))) return pane.toY(value);
        }
        return core.nan;
    }
    return state().paneValue(id, value, width, height, false);
}
export fn pane_value_at_y(id: f64, y: f64, width: f64, height: f64) f64 {
    if (id == 0) return price_at_y(y, width, height);
    if (!std.math.isFinite(y)) return core.nan;
    if (cacheMatches(width, height)) {
        for (cached_panes.panes[0..cached_panes.count]) |pane| {
            if (id == @as(f64, @floatFromInt(pane.id))) return pane.atY(y);
        }
        return core.nan;
    }
    return state().paneValue(id, y, width, height, true);
}
export fn pan(delta_bars: f64) void {
    mutation().pan(delta_bars);
}
export fn zoom(factor: f64, anchor_fraction: f64) void {
    mutation().zoom(factor, anchor_fraction);
}
export fn transform_view(factor: f64, from: f64, to: f64) void {
    mutation().transformView(factor, from, to);
}
export fn scale_price(factor: f64, anchor_fraction: f64) void {
    mutation().scalePrice(factor, anchor_fraction);
}
export fn configure_price_scale(mode: f64, inverted: f64) i32 {
    return @intFromEnum(mutation().configurePriceScale(mode, inverted));
}
export fn price_to_y(price: f64, width: f64, height: f64) f64 {
    if (cacheMatches(width, height)) return cached_axis.toY(price);
    return state().priceToY(price, width, height);
}
export fn price_at_y(y: f64, width: f64, height: f64) f64 {
    if (cacheMatches(width, height)) return cached_axis.atY(y);
    return state().priceAtY(y, width, height);
}
export fn reset_scale() void {
    mutation().resetScale();
}
export fn scale_is_auto() u32 {
    return @intFromBool(state().locked_range == null);
}
export fn follow() void {
    mutation().follow();
}
export fn frame(width: f64, height: f64) u32 {
    const count = state().frame(width, height, &rows, &meta);
    const axis = engine.priceAxis(&meta);
    price_axis = axis.metadata();
    price_tick_length = if (count > 0) axis.ticks(&price_ticks) else 0;
    const panes = engine.paneInfo(&meta);
    pane_length = panes.count;
    for (panes.panes[0..panes.count], 0..) |pane, i| pane_info[i] = pane.row();
    pane_tick_length = layout.ticks(&panes, &pane_ticks);
    engine.oscillatorFrame(rows[0..count], &panes, oscillator_rows[0..count]);
    engine.bollingerFrame(rows[0..count], axis, bollinger_rows[0..count]);
    if (engine.overlays.mask() != 0) {
        for (rows[0..count], overlay_rows[0..count]) |row, *output| {
            for (engine.overlays.config, 0..) |config, slot| {
                const value = if (config[0] == 0) core.nan else engine.overlays.values[slot][@intFromFloat(row[0])];
                output[slot * 2] = value;
                output[slot * 2 + 1] = axis.toY(value);
            }
        }
    }
    cached_width = width;
    cached_height = height;
    cached_axis = axis;
    cached_panes = panes;
    cache_valid = meta[11] > 0 and meta[12] > 0;
    return @intCast(count);
}
export fn pane_info_ptr() usize {
    return @intFromPtr(&pane_info);
}
export fn pane_count() usize {
    return pane_length;
}
export fn oscillator_frame_ptr() usize {
    return @intFromPtr(&oscillator_rows);
}
export fn pane_ticks_ptr() usize {
    return @intFromPtr(&pane_ticks);
}
export fn pane_tick_count() usize {
    return pane_tick_length;
}
export fn frame_ptr() usize {
    return @intFromPtr(&rows);
}
export fn meta_ptr() usize {
    return @intFromPtr(&meta);
}
export fn price_axis_ptr() usize {
    return @intFromPtr(&price_axis);
}
export fn price_ticks_ptr() usize {
    return @intFromPtr(&price_ticks);
}
export fn price_tick_count() usize {
    return price_tick_length;
}
export fn hit(x: f64, width: f64) i32 {
    return state().hit(x, width);
}
export fn inspect(index: u32) usize {
    if (index >= state().len) return 0;
    const bar = engine.bars[index];
    inspected = .{ @floatFromInt(index), bar[0], bar[1], bar[2], bar[3], bar[4], bar[5], engine.ma[index], engine.ema[index] };
    return @intFromPtr(&inspected);
}

export fn drawing_capacity() u32 {
    return drawings.capacity;
}
export fn drawing_input_ptr() usize {
    return @intFromPtr(&drawing_input);
}
export fn drawing_output_ptr() usize {
    return @intFromPtr(&drawing_output);
}
export fn drawing_strokes_ptr() usize {
    return @intFromPtr(&drawing_strokes);
}
export fn drawing_text_bounds_ptr() usize {
    return @intFromPtr(&drawing_text_bounds);
}
export fn drawing_fib_input_ptr() usize {
    return @intFromPtr(&fib_input);
}
export fn drawing_fib_output_ptr() usize {
    return @intFromPtr(&fib_output);
}
export fn drawing_project(count: u32, width: f64, height: f64) i32 {
    if (count > drawings.capacity) return -1;
    _ = state().frameMetadata(width, height, &meta);
    drawings.project(&engine, &meta, drawing_input[0..count], drawing_output[0..count]);
    const axis = engine.priceAxis(&meta);
    for (drawing_input[0..count], drawing_output[0..count], drawing_strokes[0..count], 0..) |shape, *projected, *line, i| {
        if (shape[0] == 7) {
            const options = fibonacci.flags(&fib_input[i]);
            if (options == null) projected.* = @splat(0);
            fib_output[i] = fibonacci.project(axis, width, shape[2], shape[4], projected.*, &fib_input[i]);
            line.* = if (options != null and (options.? & fibonacci.trend) != 0)
                drawings.stroke(&meta, 1, projected.*) orelse @splat(0)
            else
                @splat(0);
        } else line.* = drawings.stroke(&meta, shape[0], projected.*) orelse @splat(0);
    }
    return @intCast(count);
}
export fn drawing_point(x: f64, y: f64, width: f64, height: f64) usize {
    _ = state().frameMetadata(width, height, &meta);
    drawing_point_output = drawings.point(&engine, &meta, x, y) orelse return 0;
    return @intFromPtr(&drawing_point_output);
}
export fn measure(time_a: f64, price_a: f64, time_b: f64, price_b: f64, width: f64, height: f64) usize {
    _ = state().frameMetadata(width, height, &meta);
    measurement_output = measurement.measure(&engine, &meta, .{ time_a, price_a }, .{ time_b, price_b }) orelse return 0;
    return @intFromPtr(&measurement_output);
}
export fn drawing_translate(time: f64, price: f64, slots: f64, delta: f64) usize {
    drawing_point_output = drawings.translate(state(), time, price, slots, delta) orelse return 0;
    return @intFromPtr(&drawing_point_output);
}
export fn drawing_shift(time: f64, price: f64, from_x: f64, from_y: f64, to_x: f64, to_y: f64, width: f64, height: f64) usize {
    _ = state().frameMetadata(width, height, &meta);
    drawing_point_output = drawings.shiftAnchor(&engine, &meta, time, price, .{ from_x, from_y }, .{ to_x, to_y }) orelse return 0;
    return @intFromPtr(&drawing_point_output);
}
export fn drawing_hit(count: u32, width: f64, height: f64, x: f64, y: f64, tolerance: f64) usize {
    if (drawing_project(count, width, height) < 0) return 0;
    drawing_hit_output = drawings.hitWithBounds(&meta, drawing_input[0..count], drawing_output[0..count], .{ .input = fib_input[0..count], .output = fib_output[0..count] }, drawing_text_bounds[0..count], x, y, tolerance) orelse return 0;
    return @intFromPtr(&drawing_hit_output);
}

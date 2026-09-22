const std = @import("std");
const layout = @import("layout.zig");
pub const price_scale = @import("price-scale.zig");
const oscillators = @import("oscillators.zig");
pub const averages = @import("averages.zig");
pub const bollinger = @import("bollinger.zig");

pub const capacity = 100_000;
pub const period = 20;
pub const maximum_indicator_period = 500;
pub const max_visible = 2002;
pub const default_latest_position = 0.8;
pub const minimum_latest_position = 0.5;
pub const nan = std.math.nan(f64);
pub const Row = [6]f64;
pub const FrameRow = [17]f64;
pub const OscillatorFrameRow = [8]f64;
pub const BollingerFrameRow = [6]f64;
pub const Status = enum(i32) { ok = 0, invalid_data = 1, capacity = 2, ordering = 3, bad_mode = 4, missing_bar = 5 };

pub const Engine = struct {
    bars: [capacity]Row = undefined,
    ma: [capacity]f64 = undefined,
    ema: [capacity]f64 = undefined,
    overlays: averages.Store(capacity) = .{},
    bands: bollinger.Store(capacity) = .{},
    oscillators: oscillators.Store(capacity) = .{},
    len: usize = 0,
    start: f64 = 0,
    span: f64 = 120,
    locked_range: ?[3]f64 = null,
    locked_macd_range: ?[2]f64 = null,
    plot_width: f64 = 0,
    pane_weights: [4]f64 = layout.default_weights,
    pane_order: [4]usize = layout.default_order,
    maximized_pane: i32 = -1,
    ma_period: usize = period,
    ema_period: usize = period,
    indicator_mask: u8 = 0,
    price_config: price_scale.Config = .{},

    pub fn reset(self: *Engine) void {
        self.len = 0;
        self.start = 0;
        self.span = 120;
        self.locked_range = null;
        self.locked_macd_range = null;
        self.oscillators.reset();
        self.overlays.config = @splat(.{ 0, 20 });
        self.bands.config = .{};
        self.plot_width = 0;
        self.pane_weights = layout.default_weights;
        self.pane_order = layout.default_order;
        self.maximized_pane = -1;
        self.ma_period = period;
        self.ema_period = period;
        self.indicator_mask = 0;
        self.price_config = .{};
    }

    pub fn apply(self: *Engine, mode: u32, input: []const Row) Status {
        if (mode > 3) return .bad_mode;
        if (input.len > capacity) return .capacity;
        for (input, 0..) |row, i| {
            if (!validRow(row)) return .invalid_data;
            if (i > 0 and row[0] <= input[i - 1][0]) return .ordering;
        }
        if (mode == 3) return self.correct(input);
        var overwrite: usize = 0;
        if (self.len > 0 and input.len > 0) {
            if (mode == 1 and input[input.len - 1][0] >= self.bars[0][0]) return .ordering;
            if (mode == 2) {
                if (input[0][0] < self.bars[self.len - 1][0]) return .ordering;
                overwrite = @intFromBool(input[0][0] == self.bars[self.len - 1][0]);
            }
        }
        const new_len = if (mode == 0) input.len else self.len + input.len - overwrite;
        if (new_len > capacity) return .capacity;
        const following = self.start + self.span >= @as(f64, @floatFromInt(self.len)) - 0.000001;
        const previous_len = self.len;
        switch (mode) {
            0 => {
                @memcpy(self.bars[0..input.len], input);
                self.len = new_len;
                self.recompute(0);
                self.follow();
            },
            1 => {
                if (input.len == 0) return .ok;
                std.mem.copyBackwards(Row, self.bars[input.len..new_len], self.bars[0..self.len]);
                @memcpy(self.bars[0..input.len], input);
                self.len = new_len;
                self.recompute(0);
                self.clampView(self.start + @as(f64, @floatFromInt(input.len)), self.span);
                if (previous_len == 0) self.follow();
            },
            2 => {
                if (input.len == 0) return .ok;
                const from = self.len - overwrite;
                @memcpy(self.bars[from..new_len], input);
                self.len = new_len;
                self.recompute(from);
                if (previous_len == 0) {
                    self.follow();
                } else if (following) {
                    // Advance by appended bars, preserving the user's right-side space.
                    self.clampView(self.start + @as(f64, @floatFromInt(new_len - previous_len)), self.span);
                }
            },
            else => unreachable,
        }
        return .ok;
    }

    fn barIndex(self: *const Engine, time: f64) ?usize {
        var low: usize = 0;
        var high = self.len;
        while (low < high) {
            const middle = low + (high - low) / 2;
            if (self.bars[middle][0] < time) low = middle + 1 else high = middle;
        }
        return if (low < self.len and self.bars[low][0] == time) low else null;
    }

    // Correct only loaded timestamps. Validate every target before changing any data.
    fn correct(self: *Engine, input: []const Row) Status {
        var first_changed = self.len;
        for (input) |row| {
            const index = self.barIndex(row[0]) orelse return .missing_bar;
            if (!std.mem.eql(f64, &self.bars[index], &row)) first_changed = @min(first_changed, index);
        }
        if (first_changed == self.len) return .ok;
        for (input) |row| self.bars[self.barIndex(row[0]).?] = row;
        self.recompute(first_changed);
        return .ok;
    }

    fn recompute(self: *Engine, from: usize) void {
        self.recomputeIndicators(from, true, true);
        self.overlays.recompute(self.bars[0..self.len], from);
        self.bands.recompute(self.bars[0..self.len], from);
        self.oscillators.update(self.bars[0..self.len], from);
    }

    fn recomputeIndicators(self: *Engine, from: usize, update_ma: bool, update_ema: bool) void {
        if (update_ma) averages.update(self.bars[0..self.len], &self.ma, from, self.ma_period, false);
        if (update_ema) averages.update(self.bars[0..self.len], &self.ema, from, self.ema_period, true);
    }

    pub fn configureOverlays(self: *Engine, configs: *const [averages.slots]averages.Config) Status {
        const changed = self.overlays.configure(configs, self.bars[0..self.len]) orelse return .invalid_data;
        if (changed) self.resetScale();
        return .ok;
    }

    pub fn configureBollinger(self: *Engine, band_period: u32, multiplier: f64, enabled: u32) Status {
        const changed = self.bands.configure(band_period, multiplier, enabled, self.bars[0..self.len]) orelse return .invalid_data;
        if (changed) self.resetScale();
        return .ok;
    }

    pub fn configureIndicators(self: *Engine, ma_period: f64, ema_period: f64, mask: f64) Status {
        if (!integerInRange(ma_period, 1, maximum_indicator_period) or
            !integerInRange(ema_period, 1, maximum_indicator_period) or !integerInRange(mask, 0, 7)) return .invalid_data;
        const ma: usize = @intFromFloat(ma_period);
        const ema: usize = @intFromFloat(ema_period);
        const next_mask: u8 = @intFromFloat(mask);
        const update_ma = ma != self.ma_period;
        const update_ema = ema != self.ema_period;
        if (!update_ma and !update_ema and next_mask == self.indicator_mask) return .ok;
        const previous_panes = self.activePanes();
        self.ma_period = ma;
        self.ema_period = ema;
        self.indicator_mask = next_mask;
        self.reconcileMaximized(previous_panes);
        if (update_ma or update_ema) self.recomputeIndicators(0, update_ma, update_ema);
        self.resetScale();
        return .ok;
    }

    pub fn configureOscillators(self: *Engine, rsi: f64, fast: f64, slow: f64, signal: f64, mask: f64) Status {
        const previous = self.oscillators.config;
        const previous_panes = self.activePanes();
        if (!self.oscillators.configure(.{ rsi, fast, slow, signal, mask }, self.bars[0..self.len])) return .invalid_data;
        self.reconcileMaximized(previous_panes);
        if (!std.meta.eql(previous, self.oscillators.config)) self.resetScale();
        return .ok;
    }

    pub fn setView(self: *Engine, start: f64, span: f64) void {
        if (!std.math.isFinite(start) or !std.math.isFinite(span)) return;
        self.clampView(start, span);
        self.resetScale();
    }

    /// Fit loaded bars in [from, to); 1 reports density clipping, -1 leaves the view unchanged.
    pub fn fitTimeRange(self: *Engine, from: f64, to: f64) i32 {
        if (!std.math.isFinite(from) or !std.math.isFinite(to) or from >= to or self.len == 0) return -1;
        const first = self.timeLowerBound(from);
        const end = self.timeLowerBound(to);
        if (first == end) return -1;
        const wanted = @as(f64, @floatFromInt(end - first)) / default_latest_position;
        const span = std.math.clamp(wanted, layout.minimum_span, layout.maximumSpan(self.plot_width));
        self.setView(@as(f64, @floatFromInt(end)) - 0.5 - span * default_latest_position, span);
        return @intFromBool(wanted > span);
    }

    fn timeLowerBound(self: *const Engine, time: f64) usize {
        var low: usize = 0;
        var high = self.len;
        while (low < high) {
            const middle = low + (high - low) / 2;
            if (self.bars[middle][0] < time) low = middle + 1 else high = middle;
        }
        return low;
    }

    fn clampView(self: *Engine, start: f64, span: f64) void {
        self.span = std.math.clamp(span, layout.minimum_span, layout.maximumSpan(self.plot_width));
        self.start = self.boundedStart(start, self.span);
    }

    pub fn resizePlot(self: *Engine, width: f64) void {
        if (!std.math.isFinite(width) or width <= 0) return;
        self.plot_width = width;
        const next_span = @min(self.span, layout.maximumSpan(width));
        if (next_span == self.span) return;
        const latest = @as(f64, @floatFromInt(self.len)) - 0.5;
        const position = if (self.len > 0 and latest >= self.start and latest <= self.start + self.span)
            (latest - self.start) / self.span
        else
            0.5;
        self.clampView(self.start + (self.span - next_span) * position, next_span);
    }

    pub fn setPaneSplit(self: *Engine, ratio: f64) void {
        if (!std.math.isFinite(ratio)) return;
        const split = std.math.clamp(ratio, layout.minimum_pane_split, layout.maximum_pane_split);
        self.pane_weights[0] = split;
        self.pane_weights[1] = 1 - split;
    }

    pub fn setPaneWeights(self: *Engine, weights: [4]f64) Status {
        for (weights) |weight| if (!std.math.isFinite(weight) or weight <= 0) return .invalid_data;
        self.pane_weights = weights;
        return .ok;
    }

    pub fn activePanes(self: *const Engine) u8 {
        return 1 | (if ((self.indicator_mask & 4) != 0) @as(u8, 2) else 0) | (self.oscillators.config.mask << 2);
    }

    fn reconcileMaximized(self: *Engine, previous_panes: u8) void {
        if (self.maximized_pane < 0) return;
        const active = self.activePanes();
        const added = (active & ~previous_panes) != 0;
        const removed_focus = (active & (@as(u8, 1) << @intCast(self.maximized_pane))) == 0;
        // Newly added panes must be visible, regardless of which pane was maximized.
        if (added or removed_focus) self.maximized_pane = -1;
    }

    pub fn setPaneOrder(self: *Engine, values: [4]f64) Status {
        var order: [4]usize = undefined;
        var seen: u8 = 0;
        for (values, 0..) |value, index| {
            if (!integerInRange(value, 0, 3)) return .invalid_data;
            const id: usize = @intFromFloat(value);
            const bit = @as(u8, 1) << @intCast(id);
            if ((seen & bit) != 0) return .invalid_data;
            seen |= bit;
            order[index] = id;
        }
        self.pane_order = order;
        return .ok;
    }

    pub fn movePane(self: *Engine, id: f64, direction: f64) Status {
        if (!integerInRange(id, 0, 3) or (direction != -1 and direction != 1)) return .invalid_data;
        const active = self.activePanes();
        if ((active & (@as(u8, 1) << @intFromFloat(id))) == 0) return .invalid_data;
        for (self.pane_order, 0..) |pane, index| {
            if (pane != @as(usize, @intFromFloat(id))) continue;
            var next: i32 = @intCast(index);
            while (true) {
                next += @intFromFloat(direction);
                if (next < 0 or next >= 4) return .ok;
                const target: usize = @intCast(next);
                if ((active & (@as(u8, 1) << @intCast(self.pane_order[target]))) == 0) continue;
                std.mem.swap(usize, &self.pane_order[index], &self.pane_order[target]);
                return .ok;
            }
        }
        return .invalid_data;
    }

    pub fn maximizePane(self: *Engine, id: f64) Status {
        if (!integerInRange(id, -1, 3)) return .invalid_data;
        if (id >= 0 and (self.activePanes() & (@as(u8, 1) << @intFromFloat(id))) == 0) return .invalid_data;
        self.maximized_pane = @intFromFloat(id);
        return .ok;
    }

    fn paneStack(self: *const Engine, height: f64) layout.Stack {
        const visible = if (self.maximized_pane < 0) self.activePanes() else @as(u8, 1) << @intCast(self.maximized_pane);
        return layout.orderedStack(height, self.pane_weights, visible, self.pane_order);
    }

    pub fn resizePane(self: *Engine, upper: f64, delta: f64, height: f64) Status {
        if (!integerInRange(upper, 0, 3) or !std.math.isFinite(delta) or !std.math.isFinite(height) or height <= 0) return .invalid_data;
        const panes = self.paneStack(height);
        for (panes.panes[0..panes.count], 0..) |pane, i| {
            if (pane.id != @as(usize, @intFromFloat(upper))) continue;
            if (i + 1 == panes.count) return .invalid_data;
            const next = panes.panes[i + 1];
            const total = next.bottom - pane.top;
            const size = std.math.clamp(pane.bottom - pane.top + delta, panes.minimum, total - panes.minimum);
            if (size == pane.bottom - pane.top or panes.scale <= 0) return .ok;
            const a = size / panes.scale * panes.weight_max;
            const b = (total - size) / panes.scale * panes.weight_max;
            if (!std.math.isFinite(a) or !std.math.isFinite(b) or a <= 0 or b <= 0) return .invalid_data;
            self.pane_weights[pane.id] = a;
            self.pane_weights[next.id] = b;
            return .ok;
        }
        return .invalid_data;
    }

    fn boundedStart(self: *const Engine, start: f64, span: f64) f64 {
        // The newest candle's center may move as far left as the plot midpoint.
        const max_start = @max(0, @as(f64, @floatFromInt(self.len)) - 0.5 - span * minimum_latest_position);
        return std.math.clamp(start, 0, max_start);
    }

    pub fn follow(self: *Engine) void {
        self.setView(@as(f64, @floatFromInt(self.len)) - 0.5 - self.span * default_latest_position, self.span);
    }

    pub fn pan(self: *Engine, delta: f64) void {
        if (!std.math.isFinite(delta) or self.len == 0) return;
        const next_start = self.boundedStart(self.start + delta, self.span);
        if (next_start == self.start) return;
        // Capture before moving, even when the host has not requested a frame yet.
        if (self.locked_range == null) self.locked_range = self.visibleRange();
        if ((self.oscillators.config.mask & 2) != 0 and self.locked_macd_range == null) self.locked_macd_range = self.visibleMacdRange();
        self.start = next_start;
    }

    pub fn scalePrice(self: *Engine, factor: f64, anchor_fraction: f64) void {
        if (self.len == 0 or !std.math.isFinite(factor) or factor <= 0 or
            !std.math.isFinite(anchor_fraction)) return;
        if (factor == 1) return;
        const range = self.locked_range orelse self.visibleRange();
        const axis = self.axisForRange(range, 0, 1);
        const next = axis.scaledRange(factor, std.math.clamp(anchor_fraction, 0, 1));
        if (next[0] == range[0] and next[1] == range[1]) return;
        // Price-axis input must not alter time coordinates or the volume scale.
        self.locked_range = .{ next[0], next[1], range[2] };
    }

    pub fn resetScale(self: *Engine) void {
        self.locked_range = null;
        self.locked_macd_range = null;
    }

    pub fn configurePriceScale(self: *Engine, mode: f64, inverted: f64) Status {
        if (!integerInRange(mode, 0, 3) or !integerInRange(inverted, 0, 1)) return .invalid_data;
        self.price_config = .{ .mode = @enumFromInt(@as(u8, @intFromFloat(mode))), .inverted = inverted == 1 };
        return .ok;
    }

    fn visibleBase(self: *const Engine) f64 {
        const first: usize = @intFromFloat(@max(0, @ceil(self.start - 0.5)));
        if (first >= self.len or @as(f64, @floatFromInt(first)) + 0.5 > self.start + self.span) return nan;
        return self.bars[first][4];
    }

    fn positiveVisibleData(self: *const Engine) bool {
        const first: usize = @intFromFloat(@floor(self.start));
        const last: usize = @min(self.len, @as(usize, @intFromFloat(@ceil(self.start + self.span))));
        for (first..last) |i| {
            if (self.bars[i][3] <= 0) return false;
            if ((self.indicator_mask & 1) != 0 and std.math.isFinite(self.ma[i]) and self.ma[i] <= 0) return false;
            if ((self.indicator_mask & 2) != 0 and std.math.isFinite(self.ema[i]) and self.ema[i] <= 0) return false;
            if (self.bands.config.enabled) {
                for (self.bands.values[i]) |value| {
                    if (std.math.isFinite(value) and value <= 0) return false;
                }
            }
            for (self.overlays.config, 0..) |config, slot| {
                if (config[0] == 0) continue;
                const value = self.overlays.values[slot][i];
                if (std.math.isFinite(value) and value <= 0) return false;
            }
        }
        return true;
    }

    fn axisForRange(self: *const Engine, range: [3]f64, top: f64, bottom: f64) price_scale.Axis {
        const positive = self.price_config.mode != .logarithmic or self.positiveVisibleData();
        return price_scale.Axis.init(self.price_config, range[0], range[1], top, bottom, self.visibleBase(), positive);
    }

    pub fn priceAxis(self: *const Engine, meta: *const [13]f64) price_scale.Axis {
        return self.axisForRange(.{ meta[0], meta[1], meta[2] }, meta[3], meta[4]);
    }

    pub fn priceToY(self: *const Engine, price: f64, width: f64, height: f64) f64 {
        var meta: [13]f64 = undefined;
        if (!self.frameMetadata(width, height, &meta)) return nan;
        return self.priceAxis(&meta).toY(price);
    }

    pub fn priceAtY(self: *const Engine, y: f64, width: f64, height: f64) f64 {
        var meta: [13]f64 = undefined;
        if (!self.frameMetadata(width, height, &meta)) return nan;
        return self.priceAxis(&meta).atY(y);
    }

    pub fn zoom(self: *Engine, factor: f64, anchor_fraction: f64) void {
        if (!std.math.isFinite(factor) or factor <= 0 or !std.math.isFinite(anchor_fraction)) return;
        const anchor = std.math.clamp(anchor_fraction, 0, 1);
        const next_span = std.math.clamp(self.span / factor, layout.minimum_span, layout.maximumSpan(self.plot_width));
        if (next_span == self.span) return;
        self.setView(self.start + anchor * (self.span - next_span), next_span);
    }

    /// Move a screen anchor and scale in one operation on the shared time viewport.
    pub fn transformView(self: *Engine, factor: f64, from: f64, to: f64) void {
        if (self.len == 0 or !std.math.isFinite(factor) or factor <= 0 or
            !std.math.isFinite(from) or !std.math.isFinite(to)) return;
        const a = std.math.clamp(from, 0, 1);
        const b = std.math.clamp(to, 0, 1);
        const next_span = std.math.clamp(self.span / factor, layout.minimum_span, layout.maximumSpan(self.plot_width));
        if (next_span == self.span) {
            self.pan((a - b) * self.span);
        } else {
            self.setView(self.start + a * self.span - b * next_span, next_span);
        }
    }

    pub fn hit(self: *const Engine, x: f64, width: f64) i32 {
        if (self.len == 0 or !std.math.isFinite(x) or !std.math.isFinite(width) or width <= 0 or x < 0 or x >= width) return -1;
        const index = @floor(self.start + (x / width) * self.span);
        if (index < 0 or index >= @as(f64, @floatFromInt(self.len))) return -1;
        return @intFromFloat(index);
    }

    fn visibleRange(self: *const Engine) [3]f64 {
        const first: usize = @intFromFloat(@floor(self.start));
        const last: usize = @min(self.len, @as(usize, @intFromFloat(@ceil(self.start + self.span))));
        var price_min: f64 = std.math.inf(f64);
        var price_max: f64 = -std.math.inf(f64);
        var volume_max: f64 = 1;
        for (first..last) |i| {
            price_min = @min(price_min, self.bars[i][3]);
            price_max = @max(price_max, self.bars[i][2]);
            volume_max = @max(volume_max, self.bars[i][5]);
            if ((self.indicator_mask & 1) != 0 and std.math.isFinite(self.ma[i])) {
                price_min = @min(price_min, self.ma[i]);
                price_max = @max(price_max, self.ma[i]);
            }
            if ((self.indicator_mask & 2) != 0 and std.math.isFinite(self.ema[i])) {
                price_min = @min(price_min, self.ema[i]);
                price_max = @max(price_max, self.ema[i]);
            }
            if (self.bands.config.enabled) {
                for (self.bands.values[i]) |value| {
                    if (!std.math.isFinite(value)) continue;
                    price_min = @min(price_min, value);
                    price_max = @max(price_max, value);
                }
            }
            for (self.overlays.config, 0..) |config, slot| {
                if (config[0] == 0) continue;
                const value = self.overlays.values[slot][i];
                if (!std.math.isFinite(value)) continue;
                price_min = @min(price_min, value);
                price_max = @max(price_max, value);
            }
        }
        if (first == last) {
            price_min = 0;
            price_max = 1;
        }
        if (self.price_config.mode == .logarithmic and price_min > 0) {
            const padding = @max(std.math.log1p(1 / price_min), std.math.log1p((price_max - price_min) / price_min) * 0.08);
            return .{ @max(1e-9, price_min * @exp(-padding)), @min(4e12, price_max * @exp(padding)), volume_max };
        }
        const padding = @max(1, (price_max - price_min) * 0.08);
        price_min -= padding;
        price_max += padding;
        return .{ price_min, price_max, volume_max };
    }

    pub fn frameMetadata(self: *const Engine, width: f64, height: f64, meta: *[13]f64) bool {
        meta.* = @splat(0);
        if (!std.math.isFinite(width) or !std.math.isFinite(height) or width <= 0 or height <= 0) return false;
        const range = self.locked_range orelse self.visibleRange();
        const panes = self.paneStack(height);
        const price = panes.find(0);
        const volume = panes.find(1);
        meta.* = .{ range[0], range[1], range[2], if (price) |pane| pane.content_top else 0, if (price) |pane| pane.content_bottom else 0, if (volume) |pane| pane.content_top else height, if (volume) |pane| pane.content_bottom else height, width / self.span * 0.72, self.start, self.span, @floatFromInt(self.len), width, height };
        return true;
    }

    fn visibleMacdRange(self: *const Engine) [2]f64 {
        var minimum: f64 = 0;
        var maximum: f64 = 0;
        const first: usize = @intFromFloat(@floor(self.start));
        const last: usize = @min(self.len, @as(usize, @intFromFloat(@ceil(self.start + self.span))));
        if ((self.oscillators.config.mask & 2) != 0) {
            for (first..last) |i| {
                const values = self.oscillators.values(i);
                for (values[1..4]) |value| if (std.math.isFinite(value)) {
                    minimum = @min(minimum, value);
                    maximum = @max(maximum, value);
                };
            }
        }
        const padding = @max(1, (maximum - minimum) * 0.08);
        return .{ minimum - padding, maximum + padding };
    }

    pub fn paneInfo(self: *const Engine, meta: *const [13]f64) layout.Stack {
        var panes = self.paneStack(meta[12]);
        const macd = if ((self.oscillators.config.mask & 2) != 0) self.locked_macd_range orelse self.visibleMacdRange() else [2]f64{ -1, 1 };
        for (panes.panes[0..panes.count]) |*pane| {
            const range = switch (pane.id) {
                0 => [2]f64{ meta[0], meta[1] },
                1 => [2]f64{ 0, meta[2] },
                2 => [2]f64{ 0, 100 },
                else => macd,
            };
            pane.minimum = range[0];
            pane.maximum = range[1];
        }
        return panes;
    }

    pub fn oscillatorFrame(self: *const Engine, rows: []const FrameRow, panes: *const layout.Stack, output: []OscillatorFrameRow) void {
        const rsi = panes.find(2);
        const macd = panes.find(3);
        for (rows, output) |row, *result| {
            const values = self.oscillators.values(@intFromFloat(row[0]));
            result.* = .{ values[0], values[1], values[2], values[3], if (rsi) |pane| pane.toY(values[0]) else nan, if (macd) |pane| pane.toY(values[1]) else nan, if (macd) |pane| pane.toY(values[2]) else nan, if (macd) |pane| pane.toY(values[3]) else nan };
        }
    }

    pub fn bollingerFrame(self: *const Engine, rows: []const FrameRow, axis: price_scale.Axis, output: []BollingerFrameRow) void {
        for (rows, output) |row, *result| {
            const values = if (self.bands.config.enabled) self.bands.values[@intFromFloat(row[0])] else @as(bollinger.Values, @splat(nan));
            result.* = .{ values[0], values[1], values[2], axis.toY(values[0]), axis.toY(values[1]), axis.toY(values[2]) };
        }
    }

    pub fn paneValue(self: *const Engine, id: f64, value: f64, width: f64, height: f64, inverse: bool) f64 {
        if (!integerInRange(id, 0, 3) or !std.math.isFinite(value)) return nan;
        if (id == 0) return if (inverse) self.priceAtY(value, width, height) else self.priceToY(value, width, height);
        var meta: [13]f64 = undefined;
        if (!self.frameMetadata(width, height, &meta)) return nan;
        const panes = self.paneInfo(&meta);
        const pane = panes.find(@intFromFloat(id)) orelse return nan;
        return if (inverse) pane.atY(value) else pane.toY(value);
    }

    pub fn frame(self: *const Engine, width: f64, height: f64, rows: *[max_visible]FrameRow, meta: *[13]f64) usize {
        if (!self.frameMetadata(width, height, meta)) return 0;
        const first: usize = @intFromFloat(@floor(self.start));
        const last: usize = @min(self.len, @as(usize, @intFromFloat(@ceil(self.start + self.span))));
        const volume_max = meta[2];
        const volume_top = meta[5];
        const volume_bottom = meta[6];
        const axis = self.priceAxis(meta);
        for (first..last, 0..) |i, row_index| {
            const bar = self.bars[i];
            rows[row_index] = .{ @floatFromInt(i), bar[0], bar[1], bar[2], bar[3], bar[4], bar[5], self.ma[i], self.ema[i], (@as(f64, @floatFromInt(i)) + 0.5 - self.start) / self.span * width, axis.toY(bar[1]), axis.toY(bar[2]), axis.toY(bar[3]), axis.toY(bar[4]), volume_bottom - bar[5] / volume_max * (volume_bottom - volume_top), axis.toY(self.ma[i]), axis.toY(self.ema[i]) };
        }
        return last - first;
    }
};

fn integerInRange(value: f64, minimum: f64, maximum: f64) bool {
    return std.math.isFinite(value) and value >= minimum and value <= maximum and @floor(value) == value;
}

fn validRow(row: Row) bool {
    if (!integerInRange(row[0], 0, 8.64e15) or !integerInRange(row[5], 0, 1e12)) return false;
    for (row[1..5]) |price| if (!integerInRange(price, -1e12, 1e12)) return false;
    return row[3] <= row[1] and row[3] <= row[4] and row[2] >= row[1] and row[2] >= row[4];
}

test {
    _ = @import("tests.zig");
    _ = @import("performance-tests.zig");
}

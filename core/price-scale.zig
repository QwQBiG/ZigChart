const std = @import("std");

pub const Mode = enum(u8) { normal = 0, logarithmic = 1, percentage = 2, indexed = 3 };
pub const Config = struct { mode: Mode = .normal, inverted: bool = false };
pub const maximum_ticks = 16;
pub const Tick = [3]f64; // raw price, CSS y, display value
const nan = std.math.nan(f64);

pub const Axis = struct {
    requested: Mode,
    effective: Mode,
    inverted: bool,
    base: f64,
    minimum: f64,
    maximum: f64,
    top: f64,
    bottom: f64,
    log_span: f64,
    pixel_origin: f64,
    pixel_scale: f64,
    valid: bool,

    pub fn init(config: Config, minimum: f64, maximum: f64, top: f64, bottom: f64, base: f64, positive_data: bool) Axis {
        var effective = config.mode;
        if (effective == .logarithmic and (!positive_data or minimum <= 0 or maximum <= 0)) effective = .normal;
        if ((effective == .percentage or effective == .indexed) and (!std.math.isFinite(base) or base == 0)) effective = .normal;
        const log_span = if (effective == .logarithmic) logRatio(maximum, minimum) else 0;
        const span = if (effective == .logarithmic) log_span else maximum - minimum;
        return .{ .requested = config.mode, .effective = effective, .inverted = config.inverted, .log_span = log_span, .pixel_origin = if (config.inverted) top else bottom, .pixel_scale = (if (config.inverted) bottom - top else top - bottom) / span, .valid = bottom > top and maximum > minimum, .base = base, .minimum = minimum, .maximum = maximum, .top = top, .bottom = bottom };
    }

    pub fn display(self: Axis, price: f64) f64 {
        return switch (self.effective) {
            .percentage => (price - self.base) / @abs(self.base) * 100,
            .indexed => 100 + (price - self.base) / @abs(self.base) * 100,
            else => price,
        };
    }

    fn fromDisplay(self: Axis, value: f64) f64 {
        return switch (self.effective) {
            .percentage => self.base + value / 100 * @abs(self.base),
            .indexed => self.base + (value - 100) / 100 * @abs(self.base),
            else => value,
        };
    }

    pub inline fn toY(self: Axis, price: f64) f64 {
        if (!self.valid or !std.math.isFinite(price)) return nan;
        if (self.effective == .logarithmic and price <= 0) return nan;
        // Percentage/indexed are affine maps; raw fractions avoid subtracting nearly equal percentages.
        const offset = if (self.effective == .logarithmic)
            logRatio(price, self.minimum)
        else
            price - self.minimum;
        return self.pixel_origin + offset * self.pixel_scale;
    }

    pub fn atY(self: Axis, y: f64) f64 {
        if (!std.math.isFinite(y) or self.bottom <= self.top or self.maximum <= self.minimum) return nan;
        const fraction = if (self.inverted) (y - self.top) / (self.bottom - self.top) else (self.bottom - y) / (self.bottom - self.top);
        if (self.effective == .logarithmic) {
            const exponent = fraction * self.log_span;
            return if (exponent < -0.5) self.minimum * @exp(exponent) else self.minimum + self.minimum * std.math.expm1(exponent);
        }
        return self.minimum + fraction * (self.maximum - self.minimum);
    }

    pub fn metadata(self: Axis) [4]f64 {
        return .{ @floatFromInt(@intFromEnum(self.requested)), @floatFromInt(@intFromEnum(self.effective)), @floatFromInt(@intFromBool(self.inverted)), self.base };
    }

    pub fn scaledRange(self: Axis, factor: f64, anchor_fraction: f64) [2]f64 {
        const from_bottom = if (self.inverted) anchor_fraction else 1 - anchor_fraction;
        if (self.effective != .logarithmic) {
            const span = self.maximum - self.minimum;
            const next_span = std.math.clamp(span / factor, 2, 4e12);
            const price = self.minimum + from_bottom * span;
            const minimum = std.math.clamp(price - from_bottom * next_span, -4e12, 4e12 - next_span);
            return .{ minimum, minimum + next_span };
        }
        const lower_limit = @log(@as(f64, 1e-9));
        const upper_limit = @log(@as(f64, 4e12));
        const minimum = @log(self.minimum);
        const span = @log(self.maximum) - minimum;
        const next_span = std.math.clamp(span / factor, 1e-12, upper_limit - lower_limit);
        const anchor = minimum + from_bottom * span;
        const low = std.math.clamp(anchor - from_bottom * next_span, lower_limit, upper_limit - next_span);
        var raw_low = @max(1e-9, @exp(low));
        var raw_high = @min(4e12, @exp(low + next_span));
        // At the raw precision boundary, the two-unit minimum takes precedence over the anchor.
        if (raw_high - raw_low < 2) {
            raw_low = std.math.clamp(@exp(anchor) - from_bottom * 2, 1e-9, 4e12 - 2);
            raw_high = raw_low + 2;
        }
        return .{ raw_low, raw_high };
    }

    pub fn ticks(self: Axis, output: *[maximum_ticks]Tick) usize {
        if (self.bottom <= self.top or self.maximum <= self.minimum) return 0;
        const height = self.bottom - self.top;
        const gap = @max(48, height / 15);
        var count: usize = 0;
        if (self.effective == .logarithmic and self.maximum / self.minimum >= 10) {
            const first: i32 = @intFromFloat(@floor(@log10(self.minimum)));
            const last: i32 = @intFromFloat(@ceil(@log10(self.maximum)));
            var exponent = first;
            while (exponent <= last and count < maximum_ticks) : (exponent += 1) {
                const decade = std.math.pow(f64, 10, @floatFromInt(exponent));
                for ([_]f64{ 1, 2, 2.5, 5 }) |multiple| {
                    const price = decade * multiple;
                    if (price < 1 or price < self.minimum or price > self.maximum) continue;
                    const y = self.toY(price);
                    if (count > 0 and @abs(y - output[count - 1][1]) < gap) continue;
                    output[count] = .{ price, y, price };
                    count += 1;
                    if (count == maximum_ticks) break;
                }
            }
            return count;
        }
        const low = self.display(self.minimum);
        const high = self.display(self.maximum);
        const target = std.math.clamp(@floor(height / 64), 2, 15);
        const rough_step = niceStep((high - low) / target);
        const relative = self.effective == .percentage or self.effective == .indexed;
        const step = if (relative) rough_step else @max(1, rough_step);
        if (!std.math.isFinite(step) or step <= 0) return 0;
        const start = @ceil(low / step);
        var i: usize = 0;
        while (i < maximum_ticks) : (i += 1) {
            const value = (start + @as(f64, @floatFromInt(i))) * step;
            if (value > high) break;
            const price = self.fromDisplay(value);
            if (count > 0 and price <= output[count - 1][0]) continue;
            const y = self.toY(price);
            if (!std.math.isFinite(y) or y < self.top - 1e-7 or y > self.bottom + 1e-7) continue;
            if (count > 0 and @abs(y - output[count - 1][1]) < gap) continue;
            output[count] = .{ price, y, if (value == 0) 0 else value };
            count += 1;
        }
        return count;
    }
};

pub fn niceStep(rough: f64) f64 {
    const magnitude = std.math.pow(f64, 10, @floor(@log10(rough)));
    const unit = rough / magnitude;
    for ([_]f64{ 1, 2, 2.5, 5, 10 }) |candidate| if (unit <= candidate) return candidate * magnitude;
    return 10 * magnitude;
}

fn logRatio(value: f64, base: f64) f64 {
    // Preserve unit-scale differences near large prices without losing far-away positive values.
    return if (value < base * 0.5) @log(value / base) else std.math.log1p((value - base) / base);
}

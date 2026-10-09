const std = @import("std");
const nan = std.math.nan(f64);

pub const slots = 6;
pub const Config = [2]f64; // Kind: 0 disabled, 1 MA, 2 EMA; period.
pub const ConfigV2 = [3]f64; // Kind, period, source ID.
pub const Source = enum(u8) { close = 0, open = 1, high = 2, low = 3, hl2 = 4, hlc3 = 5, ohlc4 = 6, hlcc4 = 7 };

/// Derived prices retain fractional raw units; input OHLC values stay unchanged.
pub fn sourceValue(row: [6]f64, source: Source) f64 {
    return sourceNumerator(row, source) / sourceDivisor(source);
}

fn sourceDivisor(source: Source) f64 {
    return switch (source) {
        .hl2 => 2,
        .hlc3 => 3,
        .ohlc4, .hlcc4 => 4,
        else => 1,
    };
}

fn sourceNumerator(row: [6]f64, source: Source) f64 {
    return switch (source) {
        .close => row[4],
        .open => row[1],
        .high => row[2],
        .low => row[3],
        .hl2 => row[2] + row[3],
        .hlc3 => row[2] + row[3] + row[4],
        .ohlc4 => row[1] + row[2] + row[3] + row[4],
        .hlcc4 => row[2] + row[3] + 2 * row[4],
    };
}

/// Revisions resume from the preceding state; a full-period mean seeds both kinds.
pub fn update(bars: []const [6]f64, output: []f64, from: usize, period: usize, exponential: bool) void {
    updateSource(bars, output, from, period, exponential, .close);
}

pub fn updateSource(bars: []const [6]f64, output: []f64, from: usize, period: usize, exponential: bool, source: Source) void {
    // At most 500 weighted prices stay below 2^53. Divide once to avoid drift
    // from repeatedly adding rounded thirds to a large rolling window.
    var sum: f64 = 0;
    if (!exponential) {
        for (bars[from - @min(from, period) .. from]) |row| sum += sourceNumerator(row, source);
    } else if (from < period) {
        for (bars[0..from]) |row| sum += sourceNumerator(row, source);
    }
    const divisor: f64 = @floatFromInt(period);
    const source_divisor = sourceDivisor(source);
    for (from..bars.len) |i| {
        const numerator = sourceNumerator(bars[i], source);
        if (!exponential or i < period) sum += numerator;
        if (!exponential and i >= period) sum -= sourceNumerator(bars[i - period], source);
        output[i] = if (i + 1 < period) nan else if (!exponential or i + 1 == period) sum / (divisor * source_divisor) else output[i - 1] + (2 / (divisor + 1)) * (numerator / source_divisor - output[i - 1]);
    }
}

/// Bounded additional overlays; legacy MA/EMA outputs keep their original ABI.
pub fn Store(comptime capacity: usize) type {
    return struct {
        config: [slots]Config = @splat(.{ 0, 20 }),
        sources: [slots]Source = @splat(.close),
        values: [slots][capacity]f64 = undefined,
        const Self = @This();

        pub fn configure(self: *Self, configs: *const [slots]Config, bars: []const [6]f64) ?bool {
            var next: [slots]ConfigV2 = undefined;
            for (configs, &next) |config, *row| row.* = .{ config[0], config[1], 0 };
            return self.configureV2(&next, bars);
        }

        pub fn configureV2(self: *Self, configs: *const [slots]ConfigV2, bars: []const [6]f64) ?bool {
            for (configs) |config| {
                for (config) |value| if (!std.math.isFinite(value) or @floor(value) != value) return null;
                if (config[0] < 0 or config[0] > 2 or config[1] < 1 or config[1] > 500 or config[2] < 0 or config[2] > 7) return null;
            }
            var changed = false;
            for (configs, 0..) |config, slot| {
                const source: Source = @enumFromInt(@as(u8, @intFromFloat(config[2])));
                if (std.mem.eql(f64, config[0..2], &self.config[slot]) and source == self.sources[slot]) continue;
                self.config[slot] = config[0..2].*;
                self.sources[slot] = source;
                changed = true;
                if (config[0] != 0) updateSource(bars, &self.values[slot], 0, @intFromFloat(config[1]), config[0] == 2, source);
            }
            return changed;
        }

        pub fn recompute(self: *Self, bars: []const [6]f64, from: usize) void {
            for (self.config, 0..) |config, slot| {
                if (config[0] != 0) updateSource(bars, &self.values[slot], from, @intFromFloat(config[1]), config[0] == 2, self.sources[slot]);
            }
        }

        pub fn mask(self: *const Self) u8 {
            var result: u8 = 0;
            for (self.config, 0..) |config, slot| {
                if (config[0] != 0) result |= @as(u8, 1) << @intCast(slot);
            }
            return result;
        }
    };
}

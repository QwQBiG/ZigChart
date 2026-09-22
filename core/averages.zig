const std = @import("std");
const nan = std.math.nan(f64);

pub const slots = 6;
pub const Config = [2]f64; // Kind: 0 disabled, 1 MA, 2 EMA; period.

/// Revisions resume from the preceding state; a full-period mean seeds both kinds.
pub fn update(bars: []const [6]f64, output: []f64, from: usize, period: usize, exponential: bool) void {
    var sum: f64 = 0;
    if (!exponential) {
        for (bars[from - @min(from, period) .. from]) |row| sum += row[4];
    } else if (from < period) {
        for (bars[0..from]) |row| sum += row[4];
    }
    const divisor: f64 = @floatFromInt(period);
    for (from..bars.len) |i| {
        if (!exponential or i < period) sum += bars[i][4];
        if (!exponential and i >= period) sum -= bars[i - period][4];
        output[i] = if (i + 1 < period) nan else if (!exponential or i + 1 == period) sum / divisor else output[i - 1] + (2 / (divisor + 1)) * (bars[i][4] - output[i - 1]);
    }
}

/// Bounded additional overlays; legacy MA/EMA outputs keep their original ABI.
pub fn Store(comptime capacity: usize) type {
    return struct {
        config: [slots]Config = @splat(.{ 0, 20 }),
        values: [slots][capacity]f64 = undefined,
        const Self = @This();

        pub fn configure(self: *Self, configs: *const [slots]Config, bars: []const [6]f64) ?bool {
            for (configs) |config| {
                for (config) |value| if (!std.math.isFinite(value) or @floor(value) != value) return null;
                if (config[0] < 0 or config[0] > 2 or config[1] < 1 or config[1] > 500) return null;
            }
            var changed = false;
            for (configs, 0..) |config, slot| {
                if (std.mem.eql(f64, &config, &self.config[slot])) continue;
                self.config[slot] = config;
                changed = true;
                if (config[0] != 0) update(bars, &self.values[slot], 0, @intFromFloat(config[1]), config[0] == 2);
            }
            return changed;
        }

        pub fn recompute(self: *Self, bars: []const [6]f64, from: usize) void {
            for (self.config, 0..) |config, slot| {
                if (config[0] != 0) update(bars, &self.values[slot], from, @intFromFloat(config[1]), config[0] == 2);
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

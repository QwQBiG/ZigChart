const std = @import("std");
const nan = std.math.nan(f64);

pub const Config = struct { period: usize = 20, enabled: bool = false };
pub const Values = [3]f64; // Middle, upper, lower.

// Monotonic queues keep each bar in a rolling high/low window at most once.
const Window = struct {
    indices: [500]usize = undefined,
    head: usize = 0,
    length: usize = 0,

    fn add(self: *Window, bars: []const [6]f64, index: usize, period: usize, column: usize) void {
        const window_start = index + 1 - @min(index + 1, period);
        while (self.length > 0 and self.indices[self.head] < window_start) {
            self.head = (self.head + 1) % self.indices.len;
            self.length -= 1;
        }
        const current = bars[index][column];
        while (self.length > 0) {
            const last = self.indices[(self.head + self.length - 1) % self.indices.len];
            const obsolete = if (column == 2) bars[last][column] <= current else bars[last][column] >= current;
            if (!obsolete) break;
            self.length -= 1;
        }
        self.indices[(self.head + self.length) % self.indices.len] = index;
        self.length += 1;
    }

    fn first(self: *const Window) usize {
        return self.indices[self.head];
    }
};

pub fn Store(comptime capacity: usize) type {
    return struct {
        config: Config = .{},
        values: [capacity]Values = undefined,
        const Self = @This();

        pub fn configure(self: *Self, period: u32, enabled: u32, bars: []const [6]f64) ?bool {
            if (period < 1 or period > 500 or enabled > 1) return null;
            const config: Config = .{ .period = period, .enabled = enabled == 1 };
            if (std.meta.eql(self.config, config)) return false;
            self.config = config;
            self.recompute(bars, 0);
            return true;
        }

        pub fn recompute(self: *Self, bars: []const [6]f64, from: usize) void {
            if (!self.config.enabled or from >= bars.len) return;
            const period = self.config.period;
            const begin = from - @min(from, period - 1);
            var highs: Window = .{};
            var lows: Window = .{};
            for (begin..bars.len) |index| {
                highs.add(bars, index, period, 2);
                lows.add(bars, index, period, 3);
                if (index < from) continue;
                if (index + 1 < period) {
                    self.values[index] = @splat(nan);
                    continue;
                }
                const upper = bars[highs.first()][2];
                const lower = bars[lows.first()][3];
                self.values[index] = .{ (upper + lower) / 2, upper, lower };
            }
        }
    };
}

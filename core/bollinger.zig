const std = @import("std");
const nan = std.math.nan(f64);

pub const Config = struct { period: usize = 20, multiplier: f64 = 2, enabled: bool = false };
pub const Values = [3]f64; // Basis, upper, lower.

// A bounded moments tree replaces one window member without subtracting variance.
// Means are offsets from an actual integer close, preserving narrow high-price spreads.
const Moments = struct {
    count: usize = 0,
    origin: f64 = 0,
    mean: f64 = 0,
    m2: f64 = 0,

    fn merge(a: Moments, b: Moments) Moments {
        if (a.count == 0) return b;
        if (b.count == 0) return a;
        const count = a.count + b.count;
        const right: f64 = @floatFromInt(b.count);
        const left: f64 = @floatFromInt(a.count);
        const total: f64 = @floatFromInt(count);
        const delta = (b.origin - a.origin) + (b.mean - a.mean);
        return .{ .count = count, .origin = a.origin, .mean = a.mean + delta * (right / total), .m2 = a.m2 + b.m2 + delta * delta * (left * right / total) };
    }
};

pub fn Store(comptime capacity: usize) type {
    return struct {
        config: Config = .{},
        values: [capacity]Values = undefined,
        const Self = @This();

        pub fn configure(self: *Self, period: u32, multiplier: f64, enabled: u32, bars: []const [6]f64) ?bool {
            if (period < 1 or period > 500 or !std.math.isFinite(multiplier) or multiplier < 0.1 or multiplier > 10 or enabled > 1) return null;
            const config: Config = .{ .period = period, .multiplier = multiplier, .enabled = enabled == 1 };
            if (std.meta.eql(self.config, config)) return false;
            self.config = config;
            self.recompute(bars, 0);
            return true;
        }

        pub fn recompute(self: *Self, bars: []const [6]f64, from: usize) void {
            if (!self.config.enabled or from >= bars.len) return;
            const period = self.config.period;
            var base: usize = 1;
            while (base < period) base *= 2;
            var tree: [1024]Moments = undefined;
            @memset(tree[0 .. base * 2], .{});
            const begin = from - @min(from, period - 1);
            for (begin..from) |i| tree[base + i % period] = .{ .count = 1, .origin = bars[i][4] };
            var node = base;
            while (node > 1) {
                node -= 1;
                tree[node] = Moments.merge(tree[node * 2], tree[node * 2 + 1]);
            }
            for (from..bars.len) |i| {
                node = base + i % period;
                tree[node] = .{ .count = 1, .origin = bars[i][4] };
                while (node > 1) {
                    node /= 2;
                    tree[node] = Moments.merge(tree[node * 2], tree[node * 2 + 1]);
                }
                if (i + 1 < period) {
                    self.values[i] = @splat(nan);
                    continue;
                }
                const moments = tree[1];
                const basis = moments.origin + moments.mean;
                const deviation = self.config.multiplier * @sqrt(moments.m2 / @as(f64, @floatFromInt(period)));
                self.values[i] = .{ basis, basis + deviation, basis - deviation };
            }
        }
    };
}

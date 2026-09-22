const std = @import("std");
const nan = std.math.nan(f64);
pub const Values = [4]f64; // RSI, MACD, signal, histogram
pub const Config = struct {
    rsi: usize = 14,
    fast: usize = 12,
    slow: usize = 26,
    signal: usize = 9,
    mask: u8 = 0,
};

pub fn Store(comptime capacity: usize) type {
    return struct {
        const Self = @This();
        config: Config = .{},
        gains: [capacity]f64 = undefined,
        losses: [capacity]f64 = undefined,
        rsi: [capacity]f64 = undefined,
        fast: [capacity]f64 = undefined,
        slow: [capacity]f64 = undefined,
        macd: [capacity]f64 = undefined,
        signal: [capacity]f64 = undefined,

        pub fn reset(self: *Self) void {
            self.config = .{};
        }

        pub fn configure(self: *Self, input: [5]f64, bars: []const [6]f64) bool {
            for (input[0..4]) |period| if (!integer(period, 1, 500)) return false;
            if (input[1] >= input[2] or !integer(input[4], 0, 3)) return false;
            const next: Config = .{ .rsi = @intFromFloat(input[0]), .fast = @intFromFloat(input[1]), .slow = @intFromFloat(input[2]), .signal = @intFromFloat(input[3]), .mask = @intFromFloat(input[4]) };
            const old = self.config;
            self.config = next;
            if ((next.mask & 1) != 0 and ((old.mask & 1) == 0 or old.rsi != next.rsi)) self.updateRsi(bars, 0);
            if ((next.mask & 2) != 0 and ((old.mask & 2) == 0 or old.fast != next.fast or old.slow != next.slow or old.signal != next.signal)) self.updateMacd(bars, 0);
            return true;
        }

        pub fn update(self: *Self, bars: []const [6]f64, from: usize) void {
            if ((self.config.mask & 1) != 0) self.updateRsi(bars, from);
            if ((self.config.mask & 2) != 0) self.updateMacd(bars, from);
        }

        fn updateRsi(self: *Self, bars: []const [6]f64, from: usize) void {
            const period = self.config.rsi;
            const divisor: f64 = @floatFromInt(period);
            for (from..bars.len) |i| {
                self.rsi[i] = nan;
                if (i < period) continue;
                if (i == period) {
                    var gain: f64 = 0;
                    var loss: f64 = 0;
                    for (1..period + 1) |j| {
                        const change = bars[j][4] - bars[j - 1][4];
                        gain += @max(0, change);
                        loss += @max(0, -change);
                    }
                    self.gains[i] = gain / divisor;
                    self.losses[i] = loss / divisor;
                } else {
                    const change = bars[i][4] - bars[i - 1][4];
                    self.gains[i] = (self.gains[i - 1] * (divisor - 1) + @max(0, change)) / divisor;
                    self.losses[i] = (self.losses[i - 1] * (divisor - 1) + @max(0, -change)) / divisor;
                }
                const gain = self.gains[i];
                const loss = self.losses[i];
                self.rsi[i] = if (gain == 0 and loss == 0) 50 else if (loss == 0) 100 else 100 - 100 / (1 + gain / loss);
            }
        }

        fn updateMacd(self: *Self, bars: []const [6]f64, from: usize) void {
            const config = self.config;
            const first = config.slow - 1;
            const seed = first + config.signal - 1;
            const divisor: f64 = @floatFromInt(config.signal);
            for (from..bars.len) |i| {
                self.fast[i] = emaAt(bars, i, config.fast, if (i > 0) self.fast[i - 1] else nan);
                self.slow[i] = emaAt(bars, i, config.slow, if (i > 0) self.slow[i - 1] else nan);
                self.macd[i] = self.fast[i] - self.slow[i];
                self.signal[i] = nan;
                if (i < seed) continue;
                if (i == seed) {
                    var sum: f64 = 0;
                    for (self.macd[first .. seed + 1]) |value| sum += value;
                    self.signal[i] = sum / divisor;
                } else {
                    self.signal[i] = self.signal[i - 1] + 2 / (divisor + 1) * (self.macd[i] - self.signal[i - 1]);
                }
            }
        }

        pub fn values(self: *const Self, index: usize) Values {
            const rsi = if ((self.config.mask & 1) != 0) self.rsi[index] else nan;
            const macd = if ((self.config.mask & 2) != 0) self.macd[index] else nan;
            const signal = if ((self.config.mask & 2) != 0) self.signal[index] else nan;
            return .{ rsi, macd, signal, macd - signal };
        }
    };
}

fn emaAt(bars: []const [6]f64, index: usize, period: usize, previous: f64) f64 {
    if (index + 1 < period) return nan;
    const divisor: f64 = @floatFromInt(period);
    if (index + 1 == period) {
        var sum: f64 = 0;
        for (bars[0..period]) |bar| sum += bar[4];
        return sum / divisor;
    }
    return previous + 2 / (divisor + 1) * (bars[index][4] - previous);
}

fn integer(value: f64, minimum: f64, maximum: f64) bool {
    return std.math.isFinite(value) and value >= minimum and value <= maximum and @floor(value) == value;
}

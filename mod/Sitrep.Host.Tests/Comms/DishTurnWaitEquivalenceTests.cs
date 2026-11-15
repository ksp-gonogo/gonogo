using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;
using Xunit.Abstractions;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// What a player can observe of the delivery network, with a message that
    /// waits on a dish turn waking itself for the turn's link-up time and
    /// without. Each script is run both ways and every dish turn, restore,
    /// command run, journey report and telemetry landing is compared, with
    /// its game time and in order.
    /// </summary>
    public class DishTurnWaitEquivalenceTests
    {
        private const int Scripts = 300;

        private readonly ITestOutputHelper _output;

        public DishTurnWaitEquivalenceTests(ITestOutputHelper output) => _output = output;

        private void RequireTheSame(bool retargets, bool warp)
        {
            var events = 0;
            for (var seed = 1; seed <= Scripts; seed++)
            {
                var script = DeliveryScript.From(seed, retargets, warp);
                var waking = script.Run(wakesOnDishTurnWaits: true);
                var notWaking = script.Run(wakesOnDishTurnWaits: false);
                events += notWaking.Count;
                Assert.True(waking.Count > 1, "script " + seed + " observed nothing to compare");
                Assert.True(
                    waking.SequenceEqual(notWaking),
                    "script " + seed + " differs:\n" + string.Join("\n", waking.Except(notWaking).Take(8).Select(l => "  with the wake: " + l))
                    + "\n" + string.Join("\n", notWaking.Except(waking).Take(8).Select(l => "  without it:    " + l)));
            }
            _output.WriteLine(Scripts + " scripts identical, " + events + " observed events");
        }

        [Fact]
        public void WithNoDishToTurnNothingObservedChangesAtOneTickASecondOrUnderWarp() => RequireTheSame(retargets: false, warp: true);

        [Fact]
        public void WithDishesToTurnNothingObservedChangesAtOneTickASecond() => RequireTheSame(retargets: true, warp: false);

        private static Dictionary<string, double> Ran(List<string> log) => log
            .Select(l => Regex.Match(l, @"^command (\d+) ran at ([\d.]+)$"))
            .Where(m => m.Success)
            .ToDictionary(m => m.Groups[1].Value, m => double.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture));

        private static int SamplesLanded(List<string> log) => log
            .Select(l => Regex.Match(l, @"^telemetry telemetry of (\d+) samples landed at "))
            .Where(m => m.Success)
            .Sum(m => int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture));

        /// <summary>
        /// The one place the wake shows: a plan with dishes to turn, flown under
        /// warp. A wake fires at an instant inside the stretch a tick skipped
        /// and reads the links as the tick at the end of that stretch found
        /// them, so with it a message leaves at a game time before its link was
        /// seen, and the dish is turned again every few minutes of the skipped
        /// stretch. Without it a message leaves on the tick that sees its link
        /// and the dish is turned once a tick. This holds the size of that
        /// difference: most commands run at the same game time either way, one
        /// that moves does so by no more than the longest stretch a tick
        /// skipped and one round of a dish turn, and fewer dishes are turned.
        /// </summary>
        [Fact]
        public void WithDishesToTurnUnderWarpTheWakeMovesAMessageByNoMoreThanASkippedStretchAndOneDishTurn()
        {
            int differing = 0, same = 0, later = 0, earlier = 0, onlyWaking = 0, onlyNotWaking = 0;
            int turnsWaking = 0, turnsNotWaking = 0, samplesWaking = 0, samplesNotWaking = 0;
            double worst = 0.0;
            // A dish is away for up to its cap and then rests: the default limits of a turn.
            const double oneDishTurn = 2.0 + 120.0 + 60.0;
            for (var seed = 1; seed <= Scripts; seed++)
            {
                var script = DeliveryScript.From(seed, retargets: true, warp: true);
                var waking = script.Run(wakesOnDishTurnWaits: true);
                var notWaking = script.Run(wakesOnDishTurnWaits: false);
                differing += waking.SequenceEqual(notWaking) ? 0 : 1;
                var longestSkip = script.Ticks.Zip(script.Ticks.Skip(1), (a, b) => b - a).Max();
                var ranWaking = Ran(waking);
                var ranNotWaking = Ran(notWaking);
                onlyWaking += ranWaking.Keys.Except(ranNotWaking.Keys).Count();
                onlyNotWaking += ranNotWaking.Keys.Except(ranWaking.Keys).Count();
                foreach (var id in ranWaking.Keys.Intersect(ranNotWaking.Keys))
                {
                    var moved = ranNotWaking[id] - ranWaking[id];
                    same += Math.Abs(moved) < 1e-9 ? 1 : 0;
                    later += moved >= 1e-9 ? 1 : 0;
                    earlier += moved <= -1e-9 ? 1 : 0;
                    worst = Math.Max(worst, Math.Abs(moved));
                    Assert.True(
                        Math.Abs(moved) <= longestSkip + oneDishTurn,
                        "script " + seed + ": command " + id + " moved " + moved + " s, more than the longest stretch a tick skipped, " + longestSkip + " s, and one dish turn");
                }
                turnsWaking += waking.Count(l => l.StartsWith("turn ", StringComparison.Ordinal));
                turnsNotWaking += notWaking.Count(l => l.StartsWith("turn ", StringComparison.Ordinal));
                samplesWaking += SamplesLanded(waking);
                samplesNotWaking += SamplesLanded(notWaking);
            }

            _output.WriteLine(
                differing + " of " + Scripts + " scripts differ. Commands: " + same + " ran at the same game time, " + later + " later and " + earlier
                + " earlier without the wake (most moved " + worst + " s), " + onlyWaking + " ran only with it, " + onlyNotWaking + " only without it."
                + " Dish turns: " + turnsWaking + " with, " + turnsNotWaking + " without. Telemetry samples landed: " + samplesWaking + " with, " + samplesNotWaking + " without.");
            var ran = same + later + earlier + onlyWaking + onlyNotWaking;
            Assert.True(same >= ran * 0.9, "only " + same + " of " + ran + " commands ran at the same game time");
            Assert.True(turnsNotWaking <= turnsWaking, "more dishes were turned without the wake");
            Assert.True(samplesNotWaking >= samplesWaking * 0.98, "telemetry was lost without the wake: " + samplesNotWaking + " of " + samplesWaking);
        }
    }
}

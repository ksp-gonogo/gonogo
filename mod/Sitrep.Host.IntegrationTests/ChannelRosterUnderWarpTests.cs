using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;
using Xunit;
using Xunit.Abstractions;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// How often <c>system.channels</c> goes out when UT runs fast: a physics
    /// tick at a fixed real rate, each advancing UT by <c>warpRate / tickHz</c>,
    /// and an engine tick wherever <see cref="SampleCadence.ShouldSample"/> at
    /// the one-UT-second <see cref="SampleCadence.IntervalUt"/> lets one
    /// through. That is every physics tick from 1000x up. The addon's gate
    /// widens its interval with the rate and would thin those to one a real
    /// second, so it is left out: what is measured is the emitter's own bound,
    /// on the worst case of a roster offered on every tick.
    ///
    /// <para>Real time is the test's own clock, stepped one physics tick at a
    /// time, so a forty-second window is forty seconds to every wall-clock gate
    /// in the engine without the test taking forty seconds. Thirty-four hertz
    /// is the physics rate measured on the rig at 100,000x, where the same
    /// window at 1x read 0.19 emissions a real second.</para>
    /// </summary>
    public class ChannelRosterUnderWarpTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;

        private const double TickHz = 34;
        private const double WindowRealSec = 40;
        private const double WarmUpRealSec = 5;

        private readonly ITestOutputHelper _output;

        public ChannelRosterUnderWarpTests(ITestOutputHelper output)
        {
            _output = output;
        }

        /// <summary>
        /// The ceiling is one keyframe per <see cref="ChannelEmitter.KeyframeFloorRealSec"/>
        /// plus one change per roster rebuild, whatever the warp rate, and at 1x
        /// the rate is the one the rig measured. What is being bounded from
        /// 1000x up is a roster offered to the emitter 34 times a real second.
        /// </summary>
        [Theory]
        [InlineData(1.0)]
        [InlineData(1_000.0)]
        [InlineData(10_000.0)]
        [InlineData(100_000.0)]
        public async Task TheRosterGoesOutAtMostOncePerRealSecondAtAnyWarpRate(double warpRate)
        {
            var (emitted, considered) = await MeasureAsync(warpRate);
            var perRealSec = emitted / WindowRealSec;
            _output.WriteLine(
                $"warp {warpRate}x: considered {considered} ({considered / WindowRealSec:0.00}/s), " +
                $"emitted {emitted} ({perRealSec:0.00}/s) over {WindowRealSec} real s");

            var ceiling = 1 / ChannelEmitter.KeyframeFloorRealSec + 1 / ChannelEngine.ChannelCounterIntervalSec;
            Assert.True(
                perRealSec <= ceiling,
                $"system.channels emitted {perRealSec:0.00}/real s at {warpRate}x, over the {ceiling:0.00}/s ceiling");

            if (warpRate == 1.0)
            {
                // One change per rebuild and a 30 UT keyframe: 0.2 a second, and
                // the rig read 0.19.
                Assert.InRange(perRealSec, 0.15, 0.25);
            }
            else
            {
                // The engine really was offered the roster on every physics tick,
                // so the bound above is the emitter's doing and not a quiet input.
                Assert.True(considered >= TickHz * WindowRealSec * 0.95, $"only {considered} considerations at {warpRate}x");
            }
        }

        private static async Task<(long Emitted, long Considered)> MeasureAsync(double warpRate)
        {
            var nowReal = 0.0;
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.SetRealClockForTests(() => System.Threading.Volatile.Read(ref nowReal));
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ChannelEngine.ChannelsTopic, Timeout);

                var utPerTick = warpRate / TickHz;
                var ut = 0.0;
                double? lastSampledUt = null;
                var snapshot = new KspSnapshot { Values = new Dictionary<string, object?>() };
                EmissionCounters atStart = default;
                var totalTicks = (int)Math.Round((WarmUpRealSec + WindowRealSec) * TickHz);
                var warmUpTicks = (int)Math.Round(WarmUpRealSec * TickHz);

                for (var tick = 0; tick < totalTicks; tick++)
                {
                    if (tick == warmUpTicks)
                    {
                        atStart = engine.ChannelCounters(ChannelEngine.ChannelsTopic);
                    }
                    System.Threading.Volatile.Write(ref nowReal, tick / TickHz);
                    ut = tick * utPerTick;
                    if (!SampleCadence.ShouldSample(ut, lastSampledUt, SampleCadence.IntervalUt))
                    {
                        continue;
                    }
                    lastSampledUt = ut;
                    engine.TickAndWait(ut, snapshot, Timeout);
                }

                var atEnd = engine.ChannelCounters(ChannelEngine.ChannelsTopic);
                return (atEnd.Emitted - atStart.Emitted, atEnd.Considered - atStart.Considered);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}

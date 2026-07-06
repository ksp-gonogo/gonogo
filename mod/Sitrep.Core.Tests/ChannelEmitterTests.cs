using Xunit;
using Sitrep.Core;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// C#-only tests for <see cref="ChannelEmitter"/> / <see cref="EmissionPolicy"/>
    /// (streaming-slice-1 Track A) -- no TS reference, no golden fixture,
    /// same rationale as <see cref="CourierTimelineResetTests"/>: this is
    /// new logic invented on the C# side, not a port.
    /// </summary>
    public class ChannelEmitterTests
    {
        private static EmissionPolicy Policy(
            double keyframeIntervalUt,
            EmissionQuantum quantum,
            double minSampleIntervalUt = 0,
            double maxRateIntervalUt = 0)
        {
            return new EmissionPolicy(keyframeIntervalUt, quantum, minSampleIntervalUt, maxRateIntervalUt);
        }

        [Fact]
        public void StaticValueEmitsExactlyOneKeyframeAndNoChangeEmissions()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 100, quantum: EmissionQuantum.Absolute(1)));

            var first = emitter.Decide("v.altitude", 1000.0, 0);
            Assert.True(first.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, first.Reason);

            // Value never changes, and we stay well inside the keyframe
            // interval -- every subsequent call must skip.
            for (double ut = 10; ut <= 90; ut += 10)
            {
                var decision = emitter.Decide("v.altitude", 1000.0, ut);
                Assert.False(decision.ShouldEmit);
            }

            var counters = emitter.CountersFor("v.altitude");
            Assert.Equal(1, counters.Emitted);
            Assert.Equal(10, counters.Considered); // ut=0,10,...,90
        }

        [Fact]
        public void SubQuantumChangeIsSuppressed()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(5)));

            emitter.Decide("v.altitude", 1000.0, 0); // keyframe

            var decision = emitter.Decide("v.altitude", 1003.0, 1); // |Δ|=3 < quantum=5
            Assert.False(decision.ShouldEmit);
        }

        [Fact]
        public void CrossingQuantumEmitsAsChange()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(5)));

            emitter.Decide("v.altitude", 1000.0, 0); // keyframe

            var decision = emitter.Decide("v.altitude", 1010.0, 1); // |Δ|=10 > quantum=5
            Assert.True(decision.ShouldEmit);
            Assert.Equal(EmissionReason.Change, decision.Reason);
            Assert.Equal(1010.0, decision.Value);
        }

        [Fact]
        public void KeyframeFiresOnKeyframeIntervalEvenWithoutChange()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 50, quantum: EmissionQuantum.Absolute(5)));

            emitter.Decide("v.altitude", 1000.0, 0); // keyframe #1

            // Same value, but exactly one keyframe interval later -- must
            // still emit, unconditionally, as a Keyframe (not a Change).
            var decision = emitter.Decide("v.altitude", 1000.0, 50);
            Assert.True(decision.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, decision.Reason);

            Assert.Equal(2, emitter.CountersFor("v.altitude").Emitted);
        }

        [Fact]
        public void NotifySubscribedForcesAnImmediateOutOfCadenceKeyframe()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(5)));

            emitter.Decide("v.altitude", 1000.0, 0); // keyframe #1, arms cadence out to ut=1000

            // Nowhere near due for another keyframe or a change -- without
            // NotifySubscribed this would skip.
            emitter.NotifySubscribed("v.altitude");
            var decision = emitter.Decide("v.altitude", 1000.0, 5);

            Assert.True(decision.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, decision.Reason);
        }

        [Fact]
        public void ResetForcesKeyframeOnEveryKnownChannelRegardlessOfCadence()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(5)));

            emitter.Decide("v.altitude", 1000.0, 20);
            emitter.Decide("v.velocity", 50.0, 20);

            // Both channels are nowhere near due for another keyframe.
            emitter.Reset(3); // e.g. a quickload back to UT 3

            var altitude = emitter.Decide("v.altitude", 1000.0, 3);
            var velocity = emitter.Decide("v.velocity", 50.0, 3);

            Assert.True(altitude.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, altitude.Reason);
            Assert.True(velocity.ShouldEmit);
            Assert.Equal(EmissionReason.Keyframe, velocity.Reason);
        }

        [Fact]
        public void UnsubscribedChannelNeverReachesDecideAndEmitsNothing()
        {
            // Demonstrates the documented outer/inner gate composition:
            // SubscriptionRegistry.IsSubscribed guards every call site that
            // would otherwise reach ChannelEmitter.Decide.
            var registry = new SubscriptionRegistry();
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 10, quantum: EmissionQuantum.Absolute(1)));

            var emittedCount = 0;
            for (double ut = 0; ut <= 100; ut += 5)
            {
                if (!registry.IsSubscribed("v.altitude"))
                {
                    continue;
                }
                var decision = emitter.Decide("v.altitude", ut, ut);
                if (decision.ShouldEmit)
                {
                    emittedCount += 1;
                }
            }

            Assert.False(registry.IsSubscribed("v.altitude"));
            Assert.Equal(0, emittedCount);
            // Never even considered -- Decide was never called.
            Assert.Equal(0, emitter.CountersFor("v.altitude").Considered);
        }

        [Fact]
        public void MaxRateClampIsHonoredUnderRapidChange()
        {
            var emitter = new ChannelEmitter(Policy(
                keyframeIntervalUt: 1000, // never due within this test's window
                quantum: EmissionQuantum.Absolute(0.01), // trivially cleared by every step
                minSampleIntervalUt: 0,
                maxRateIntervalUt: 1.0));

            emitter.Decide("v.rapid", 0.0, 0); // keyframe @ ut=0

            var emittedUts = new System.Collections.Generic.List<double>();
            for (double ut = 0.1; ut <= 5.0; ut += 0.1)
            {
                var decision = emitter.Decide("v.rapid", ut * 100, ut); // huge delta every call
                if (decision.ShouldEmit)
                {
                    emittedUts.Add(decision.Ut);
                }
            }

            // ~50 considered calls at 0.1 UT apart, but the clamp caps
            // change emissions to roughly one per 1.0 UT.
            Assert.True(emittedUts.Count <= 6, $"expected clamp to bound emissions, got {emittedUts.Count}");

            for (var i = 1; i < emittedUts.Count; i++)
            {
                Assert.True(
                    emittedUts[i] - emittedUts[i - 1] >= 1.0 - 1e-9,
                    $"emissions at {emittedUts[i - 1]} and {emittedUts[i]} are closer than the 1.0 UT clamp");
            }
        }

        [Fact]
        public void PercentOfRangeQuantumAndAbsoluteQuantumBothWork()
        {
            var percentEmitter = new ChannelEmitter(Policy(
                keyframeIntervalUt: 1000,
                quantum: EmissionQuantum.PercentOfRange(0.05, rangeMin: 0, rangeMax: 100))); // 5% of 100 = 5

            percentEmitter.Decide("v.percent", 50.0, 0); // keyframe
            Assert.False(percentEmitter.Decide("v.percent", 54.0, 1).ShouldEmit); // Δ=4 < 5
            Assert.True(percentEmitter.Decide("v.percent", 56.0, 2).ShouldEmit); // Δ=6 > 5 (from last EMITTED value 50)

            var absoluteEmitter = new ChannelEmitter(Policy(
                keyframeIntervalUt: 1000,
                quantum: EmissionQuantum.Absolute(5)));

            absoluteEmitter.Decide("v.absolute", 50.0, 0); // keyframe
            Assert.False(absoluteEmitter.Decide("v.absolute", 54.0, 1).ShouldEmit); // Δ=4 < 5
            Assert.True(absoluteEmitter.Decide("v.absolute", 56.0, 2).ShouldEmit); // Δ=6 > 5
        }

        [Fact]
        public void DiscreteStructuredValueEmitsOnNotEqualIgnoringQuantum()
        {
            var emitter = new ChannelEmitter(Policy(keyframeIntervalUt: 1000, quantum: EmissionQuantum.Absolute(9999)));

            emitter.Decide("f.sas", "Off", 0); // keyframe

            Assert.False(emitter.Decide("f.sas", "Off", 1).ShouldEmit); // unchanged
            var decision = emitter.Decide("f.sas", "StabilityAssist", 2); // changed (discrete, not-equal)
            Assert.True(decision.ShouldEmit);
            Assert.Equal(EmissionReason.Change, decision.Reason);
        }

        [Fact]
        public void PurelyUtDrivenRepeatedCallsAtTheSameUtNeverReEmit()
        {
            var emitter = new ChannelEmitter(Policy(
                keyframeIntervalUt: 1000,
                quantum: EmissionQuantum.Absolute(0.0001),
                minSampleIntervalUt: 1.0));

            var first = emitter.Decide("v.altitude", 1000.0, 5);
            Assert.True(first.ShouldEmit);

            // UT never advances past 5 again, no matter how many times or
            // how drastically the value changes between calls -- this must
            // never emit again. If this were wall-clock driven instead of
            // UT-driven, a rapid burst of calls at the same ut would still
            // trip the deadband/keyframe logic; it must not.
            for (var i = 0; i < 25; i++)
            {
                var decision = emitter.Decide("v.altitude", 1000.0 + i * 1000, 5);
                Assert.False(decision.ShouldEmit);
            }

            var counters = emitter.CountersFor("v.altitude");
            Assert.Equal(1, counters.Emitted);
            Assert.Equal(26, counters.Considered);
        }
    }
}

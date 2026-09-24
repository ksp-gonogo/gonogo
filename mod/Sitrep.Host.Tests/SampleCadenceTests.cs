using System.Collections.Generic;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Track-C quickload fix: proves <see cref="SampleCadence.ShouldSample"/>
    /// forces an immediate resample on a BACKWARD UT jump (F9 quickload)
    /// instead of the old forward-only <c>ut - lastSampledUt &lt; interval</c>
    /// gate, which goes strongly negative on a rewind and never trips -
    /// stalling <c>GonogoAddon.FixedUpdate</c> (and with it the recorder AND
    /// the live stream) across exactly the event most worth capturing.
    /// </summary>
    public class SampleCadenceTests
    {
        private const double IntervalUt = 1.0;

        [Fact]
        public void FirstCallWithNoPriorSampleAlwaysSamples()
        {
            Assert.True(SampleCadence.ShouldSample(ut: 0.0, lastSampledUt: null, IntervalUt));
        }

        [Fact]
        public void ForwardCadenceGatesUntilIntervalElapsed()
        {
            // Rising sequence 0, 1, 2, ... - each step is exactly one
            // interval, so every tick should sample and the anchor should
            // advance to the new ut each time.
            double? last = 0.0;
            for (double ut = 1.0; ut <= 5.0; ut += 1.0)
            {
                Assert.True(SampleCadence.ShouldSample(ut, last, IntervalUt));
                last = ut;
            }
        }

        [Fact]
        public void ForwardCadenceSuppressesSubIntervalTicks()
        {
            // Sub-interval ticks between samples must NOT trip the gate -
            // the fix must not turn this into "sample every tick".
            double? last = 10.0;

            Assert.False(SampleCadence.ShouldSample(ut: 10.2, last, IntervalUt));
            Assert.False(SampleCadence.ShouldSample(ut: 10.9, last, IntervalUt));
            Assert.True(SampleCadence.ShouldSample(ut: 11.0, last, IntervalUt));
        }

        [Fact]
        public void BackwardUtJumpForcesImmediateResampleInsteadOfStalling()
        {
            // Sequence rises 0, 1, 2, ..., 100 (sampling each step so the
            // anchor tracks the rising peak), then JUMPS BACKWARD to 50 (an
            // F9 quickload onto an earlier save). The old forward-only
            // `ut - last < interval` gate computes 50 - 100 = -50, which is
            // always < interval, so it would suppress this tick and every
            // one after it until ut climbs back past 100. The fix must
            // instead sample AT the rewind.
            double? last = null;
            for (double ut = 0.0; ut <= 100.0; ut += 1.0)
            {
                Assert.True(SampleCadence.ShouldSample(ut, last, IntervalUt));
                last = ut;
            }

            Assert.Equal(100.0, last);

            // The quickload: UT rewinds from 100 down to 50.
            Assert.True(SampleCadence.ShouldSample(ut: 50.0, last, IntervalUt));
        }

        [Fact]
        public void AfterARewindForwardCadenceResumesFromTheNewLowerAnchor()
        {
            // Once the rewind tick (50) becomes the new anchor, forward
            // cadence must resume gating relative to IT, not the old peak.
            double? last = 50.0;

            Assert.False(SampleCadence.ShouldSample(ut: 50.5, last, IntervalUt));
            Assert.True(SampleCadence.ShouldSample(ut: 51.0, last, IntervalUt));
        }

        [Theory]
        [InlineData(0.02, 1.0)] // 1x
        [InlineData(1.0, 1.0)] // 50x: one tick is exactly the interval
        [InlineData(2.0, 2.0)] // 100x: every tick is sampled
        [InlineData(2000.0, 2000.0)] // 100,000x
        public void QuantumIsTheIntervalUntilOneTickOutrunsIt(double tickUt, double expected)
        {
            Assert.Equal(expected, SampleCadence.ObservationQuantumUt(IntervalUt, tickUt));
        }

        [Fact]
        public void QuantumMatchesWhatTheGateActuallyLets()
        {
            // The gate is asked once per tick, so the gap it produces is the
            // quantum claimed, measured rather than restated.
            const double tickUt = 2000.0;
            double? last = null;
            var sampled = new List<double>();
            for (var ut = 0.0; ut <= 10_000.0; ut += tickUt)
            {
                if (!SampleCadence.ShouldSample(ut, last, IntervalUt)) continue;
                if (last.HasValue) sampled.Add(ut - last.Value);
                last = ut;
            }
            Assert.All(sampled, gap => Assert.Equal(SampleCadence.ObservationQuantumUt(IntervalUt, tickUt), gap));
        }
    }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using Sitrep.Propagation.Visibility;
using Xunit;
using Xunit.Abstractions;

namespace Sitrep.Host.Tests
{
    public class ZzTempSweepRepeatProbeTests
    {
        private readonly ITestOutputHelper _out;

        public ZzTempSweepRepeatProbeTests(ITestOutputHelper output) => _out = output;

        private sealed class CountingGeometry : IVisibilityGeometry
        {
            private readonly IVisibilityGeometry _inner;
            public int MarginCalls;

            public CountingGeometry(IVisibilityGeometry inner) => _inner = inner;

            public double MarginAt(double ut)
            {
                MarginCalls++;
                return _inner.MarginAt(ut);
            }

            public double SeparationAt(double ut) => _inner.SeparationAt(ut);
        }

        [Fact]
        public void CountsPolicyCallsAndSweepSamplesAcrossASilenceRun()
        {
            const double kerbinMu = 3.5316e12;
            var orbit = new OrbitElements(
                sma: 700_000.0,
                ecc: 0.0,
                inc: 0.0,
                lan: 0.0,
                argPe: 0.0,
                meanAnomalyAtEpoch: 0.0,
                epoch: 0.0,
                mu: kerbinMu);

            var station = RotatingGroundStation.FromLatitudeLongitude(
                latitudeDeg: 0.0,
                longitudeDegAtReferenceUt: 0.0,
                referenceUt: 0.0,
                rotationPeriodSeconds: 21_549.425,
                bodyRadiusMeters: 600_000.0,
                altitudeMeters: 0.0);

            // A 1 m occluding radius: the path is clear for the whole window,
            // which is exactly the documented NoOccultation case.
            var real = new OrbitToRemoteStationGeometry(
                orbit,
                new List<OrbitToRemoteStationGeometry.ChainLink>(),
                station,
                stationBodyOccludingRadiusMeters: 1.0);

            var geometry = new CountingGeometry(real);
            var policyCalls = 0;

            var policy = new PredictedReacquisitionSilenceDeadlinePolicy(
                (sample, ut) => { policyCalls++; return geometry; });

            var tracker = new SilenceTracker(policy.Evaluate);
            var sample = new SilenceSample("v1", connected: false, orbit: orbit, landedOrSplashed: false, referenceBodyIndex: 1);

            var sw = Stopwatch.StartNew();
            var ticks = 0;
            // 1 UT-second capture cadence, as GonogoAddon uses at 1x warp.
            for (double ut = 0.0; ut < 400.0; ut += 1.0)
            {
                tracker.Tick(new List<SilenceSample> { sample }, ut);
                ticks++;
            }
            sw.Stop();

            var state = tracker.TryGetState("v1");
            _out.WriteLine($"ticks={ticks} policyCalls={policyCalls} marginCalls={geometry.MarginCalls} " +
                           $"perTickMargins={geometry.MarginCalls / (double)ticks:F0} " +
                           $"elapsedMs={sw.Elapsed.TotalMilliseconds:F1} " +
                           $"msPerTick={sw.Elapsed.TotalMilliseconds / ticks:F3} " +
                           $"state={state!.State} basis={state.DeadlineBasis} deadlineUt={state.DeadlineUt}");
        }
    }
}

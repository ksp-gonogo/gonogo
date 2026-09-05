using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Propagation.Tests.Visibility
{
    /// <summary>
    /// VESSEL TO VESSEL AT HALF AN HOUR OF LIGHT-TIME, where the occlusion
    /// geometry meets the delay model. Both halves are already covered on their
    /// own: the chord test, the sweep, both edges and the clearance sign live in
    /// this directory, and silence prediction is tested against emergence and
    /// deadlines elsewhere. What nothing tested is what happens when the trip
    /// time is long enough that the path's state at SEND and its state at
    /// ARRIVAL are different facts.
    ///
    /// <para>The answer is that neither of them decides anything. What decides is
    /// whether the rock was standing on the route at the instant the wavefront
    /// reached the rock, which is a third question the sweep does not ask and the
    /// delay ledger could not express until <see cref="INetwork.DropPath"/>
    /// existed. Over 30 minutes of light-time a sample can be sent into a clear
    /// path and lost, or sent into a path that closes behind it and arrive.</para>
    ///
    /// <para>The occlusion is run through the real
    /// <see cref="VisibilitySweep"/> over real <see cref="ChordOcclusion"/>
    /// geometry rather than asserted, so the window handed to the ledger is the
    /// one the shipped predictor would have produced.</para>
    /// </summary>
    public class OcclusionMeetsTheDelayLedgerTests
    {
        private const double MetresPerLightSecond = 299792458.0;

        /// <summary>Half an hour of light-time between the two craft.</summary>
        private const double TripSeconds = 1800.0;

        private const double SeparationMetres = MetresPerLightSecond * TripSeconds;

        private const double OccluderRadiusMetres = 600_000.0;

        private const string Node = "vessel:sender";
        private const string Vantage = "vessel:receiver";
        private const string Topic = "vessel.altitude";

        /// <summary>
        /// The two craft hold station on the x axis and a body drifts across the
        /// line between them, passing the chord at
        /// <paramref name="alongChordFraction"/> of the way from sender to
        /// receiver.
        ///
        /// <para><see cref="ChordOcclusion.Clearance"/> rather than
        /// <see cref="ChordOcclusion.HorizonMargin"/>, which is the exception
        /// rather than the rule and is worth saying why: the flat region that
        /// makes clearance unusable as a search variable comes from an endpoint
        /// standing ON the occluder, the ground-station case. These endpoints are
        /// half a light-hour off a 600 km body, so the clearance falls smoothly
        /// through zero, and metres of clearance is also the quantity this test
        /// wants to talk about.</para>
        /// </summary>
        private sealed class DriftingOccluder : IVisibilityGeometry
        {
            private readonly Vector3d _sender = new Vector3d(0.0, 0.0, 0.0);
            private readonly Vector3d _receiver = new Vector3d(SeparationMetres, 0.0, 0.0);
            private readonly double _alongChordMetres;

            public DriftingOccluder(double alongChordFraction)
            {
                _alongChordMetres = SeparationMetres * alongChordFraction;
            }

            /// <summary>How far out from the SENDER the body crosses the route, in light-seconds.</summary>
            public double LightSecondsOut => _alongChordMetres / MetresPerLightSecond;

            /// <summary>
            /// Crosses the chord from one side to the other at 1 km/s, starting
            /// 1800 km off it, so the route closes at UT 1200 and opens again at
            /// UT 2400 whatever fraction along the body sits at.
            /// </summary>
            private Vector3d CentreAt(double ut) =>
                new Vector3d(_alongChordMetres, 1_800_000.0 - 1_000.0 * ut, 0.0);

            public double MarginAt(double ut) =>
                ChordOcclusion.Clearance(_sender, _receiver, CentreAt(ut), OccluderRadiusMetres);

            public double SeparationAt(double ut) => SeparationMetres;
        }

        private sealed class Wire
        {
            public readonly List<(double At, double ValidAt)> Frames = new List<(double, double)>();
        }

        /// <summary>
        /// Sweep the route, hand the occultation to the ledger as a drop, send
        /// one sample at <paramref name="sentAtUt"/>, and report what arrived.
        /// </summary>
        private static (VisibilitySweepResult Sweep, Wire Wire) Run(
            double alongChordFraction,
            double sentAtUt)
        {
            var geometry = new DriftingOccluder(alongChordFraction);
            var sweep = VisibilitySweep.Run(geometry, startUt: 0.0, endUt: 3600.0, stepSeconds: 60.0);

            // The route is clear at the start and closes exactly once inside the
            // window, then opens again. Pinned before anything is built on it: a
            // sweep that found something else would make every assertion below
            // about a different scenario.
            Assert.True(sweep.ClearAtStart);
            Assert.Equal(2, sweep.Changes.Count);
            Assert.False(sweep.Changes[0].BecameClear);
            Assert.True(sweep.Changes[1].BecameClear);

            var clock = new ManualClock();
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(TripSeconds);
            var courier = new Courier(clock, network);

            var wire = new Wire();
            courier.SubscribeStream(Node, Topic, Vantage,
                d => wire.Frames.Add((d.Meta.DeliveredAt, d.Meta.ValidAt)));

            clock.AdvanceTo(sentAtUt);
            courier.Record(Node, Topic, 100.0, sentAtUt);

            clock.AdvanceTo(sweep.Changes[0].Ut);
            network.DropPath(
                Node,
                atUt: sweep.Changes[0].Ut,
                lightSecondsOut: geometry.LightSecondsOut,
                restoredAtUt: sweep.Changes[1].Ut);

            clock.AdvanceTo(5000.0);
            return (sweep, wire);
        }

        /// <summary>
        /// TWO CRAFT, ONE OCCULTATION, OPPOSITE OUTCOMES. Both samples leave into
        /// a demonstrably clear route and both are still in flight when it
        /// closes. The only difference is where along the route the body crosses:
        /// at a quarter of the way the wavefront is long past it, at three
        /// quarters it never gets there.
        ///
        /// <para>So "clear at send" does not mean it arrives, and "blocked on
        /// arrival" does not mean it did not. Both are asserted here against the
        /// sweep rather than left implied, because they are the two answers a
        /// reader would otherwise assume the geometry already gives.</para>
        /// </summary>
        [Fact]
        public void WhereTheBodyCrossesDecidesTheSample_NotTheStateAtSendOrArrival()
        {
            var near = Run(alongChordFraction: 0.25, sentAtUt: 0.0);
            var far = Run(alongChordFraction: 0.75, sentAtUt: 0.0);

            // Both left into a clear route, and by the time either was due the
            // route had been shut for a long while.
            Assert.True(near.Sweep.ClearAt(0.0));
            Assert.False(near.Sweep.ClearAt(TripSeconds));

            // Past the body at UT 450, so the closure at UT 1200 is behind it.
            Assert.Equal(new[] { 0.0 }, near.Wire.Frames.Select(f => f.ValidAt).ToArray());
            Assert.Equal(TripSeconds, near.Wire.Frames.Single().At);

            // Would not have reached the body until UT 1350, with the rock
            // standing there. Nothing retransmits a wavefront.
            Assert.Empty(far.Wire.Frames);
        }

        /// <summary>
        /// AND THE REVERSE. The same body, the same three-quarter crossing, but
        /// the sample leaves 100 seconds before the route closes: it reaches the
        /// crossing point at UT 2450, fifty seconds after the body has moved on,
        /// and lands.
        ///
        /// <para>The route was shut for two thirds of this sample's flight and it
        /// cost nothing, because the wavefront and the rock were never in the
        /// same place. An occultation is not a death, and a drop event that could
        /// only say GONE-forever would have thrown this sample away.</para>
        /// </summary>
        [Fact]
        public void AnOcclusionThatClearsBeforeTheWavefrontReachesItCostsNothing()
        {
            var run = Run(alongChordFraction: 0.75, sentAtUt: 1100.0);

            Assert.True(run.Sweep.ClearAt(1100.0));
            Assert.False(run.Sweep.ClearAt(2000.0));
            Assert.True(run.Sweep.ClearAt(1100.0 + TripSeconds));

            Assert.Equal(new[] { 1100.0 }, run.Wire.Frames.Select(f => f.ValidAt).ToArray());
            Assert.Equal(1100.0 + TripSeconds, run.Wire.Frames.Single().At);
        }
    }
}

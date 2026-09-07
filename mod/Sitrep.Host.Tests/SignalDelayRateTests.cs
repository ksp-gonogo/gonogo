using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The published rate of change of <c>comms.delay</c>, and the situations it
    /// refuses to report one for. A wrong rate is worse than no rate: a consumer
    /// integrates it, so every uncertainty here resolves to null and the value
    /// stays where it was.
    /// </summary>
    public class SignalDelayRateTests
    {
        /// <summary>A measured light-time, the regime almost every case below is in.</summary>
        private const CommsDelaySource SIGNAL = CommsDelaySource.SignalDelay;

        private static CommsPath Route(params string[] nodes)
        {
            var hops = new List<CommsHop>();
            var from = "vessel";
            foreach (var node in nodes)
            {
                hops.Add(new CommsHop { From = from, To = node, DistanceMeters = 1.0 });
                from = node;
            }
            return new CommsPath { Hops = hops };
        }

        [Fact]
        public void FirstObservationHasNothingToCompareAgainst()
        {
            var watch = new SignalDelayRate();

            Assert.Null(watch.Observe(Route("ksc"), 10.0, SIGNAL, 100.0));
        }

        [Fact]
        public void TwoObservationsOfOneRouteGiveTheSecantRate()
        {
            var watch = new SignalDelayRate();
            watch.Observe(Route("ksc"), 10.0, SIGNAL, 100.0);

            // Four seconds of delay gained over two seconds of UT.
            Assert.Equal(2.0, watch.Observe(Route("ksc"), 14.0, SIGNAL, 102.0)!.Value, 9);
        }

        [Fact]
        public void ApproachingIsNegative()
        {
            var watch = new SignalDelayRate();
            watch.Observe(Route("ksc"), 10.0, SIGNAL, 100.0);

            Assert.Equal(-1.0, watch.Observe(Route("ksc"), 8.0, SIGNAL, 102.0)!.Value, 9);
        }

        [Fact]
        public void AStationaryCraftReportsAMeasuredZeroRatherThanNull()
        {
            var watch = new SignalDelayRate();
            watch.Observe(Route("ksc"), 10.0, SIGNAL, 100.0);

            // The one case a null would be indistinguishable from and must not
            // collapse onto: a craft holding station really has a rate of zero.
            Assert.Equal(0.0, watch.Observe(Route("ksc"), 10.0, SIGNAL, 102.0)!.Value);
        }

        [Fact]
        public void ARerouteReportsNothing()
        {
            var watch = new SignalDelayRate();
            watch.Observe(Route("relay-a", "ksc"), 10.0, SIGNAL, 100.0);

            // The whole reason the producer publishes this rather than leaving
            // it to be differenced downstream: the total jumped because the
            // route changed, not because the craft moved.
            Assert.Null(watch.Observe(Route("relay-b", "ksc"), 40.0, SIGNAL, 102.0));
        }

        [Fact]
        public void ARouteOfADifferentLengthReportsNothing()
        {
            var watch = new SignalDelayRate();
            watch.Observe(Route("relay-a", "ksc"), 10.0, SIGNAL, 100.0);

            Assert.Null(watch.Observe(Route("ksc"), 4.0, SIGNAL, 102.0));
        }

        [Fact]
        public void ARerouteAndBackReportsAgainOnTheTickAfterIt()
        {
            var watch = new SignalDelayRate();
            watch.Observe(Route("relay-a", "ksc"), 10.0, SIGNAL, 100.0);
            Assert.Null(watch.Observe(Route("relay-b", "ksc"), 40.0, SIGNAL, 102.0));

            // The refused tick still RETAINS its observation, so the new route
            // starts measuring immediately rather than staying silent.
            Assert.Equal(1.0, watch.Observe(Route("relay-b", "ksc"), 42.0, SIGNAL, 104.0)!.Value, 9);
        }

        [Fact]
        public void ANonAdvancingClockReportsNothing()
        {
            var watch = new SignalDelayRate();
            watch.Observe(Route("ksc"), 10.0, SIGNAL, 100.0);

            Assert.Null(watch.Observe(Route("ksc"), 14.0, SIGNAL, 100.0));
        }

        [Fact]
        public void ARewoundClockReportsNothing()
        {
            var watch = new SignalDelayRate();
            watch.Observe(Route("ksc"), 10.0, SIGNAL, 100.0);

            // A quickload: the two observations belong to different histories.
            Assert.Null(watch.Observe(Route("ksc"), 14.0, SIGNAL, 90.0));
        }

        [Fact]
        public void NoMeasurableDelayReportsNothingAndDropsTheRetainedObservation()
        {
            var watch = new SignalDelayRate();
            watch.Observe(Route("ksc"), 10.0, SIGNAL, 100.0);

            Assert.Null(watch.Observe(Route("ksc"), null, SIGNAL, 102.0));
            // The blackout tick is not a hole to difference ACROSS: the next
            // measurable tick starts over rather than reporting the whole gap.
            Assert.Null(watch.Observe(Route("ksc"), 30.0, SIGNAL, 104.0));
        }

        [Fact]
        public void ForgetMakesTheNextObservationTheFirstAgain()
        {
            var watch = new SignalDelayRate();
            watch.Observe(Route("ksc"), 10.0, SIGNAL, 100.0);
            watch.Forget();

            Assert.Null(watch.Observe(Route("ksc"), 14.0, SIGNAL, 102.0));
        }

        [Fact]
        public void SwitchingTheDelayFeatureOnReportsNothing()
        {
            var watch = new SignalDelayRate();
            // Delay off: an APPLIED zero over a route that is really there.
            watch.Observe(Route("ksc"), 0.0, CommsDelaySource.None, 100.0);

            // The geometry did not move at all, the regime did, and a rate
            // differenced across it would say the craft appeared out of nowhere.
            Assert.Null(watch.Observe(Route("ksc"), 40.0, SIGNAL, 102.0));
        }

        [Fact]
        public void ASimulationEndingReportsNothing()
        {
            var watch = new SignalDelayRate();
            watch.Observe(Route("ksc"), 0.0, CommsDelaySource.Simulation, 100.0);

            Assert.Null(watch.Observe(Route("ksc"), 40.0, SIGNAL, 102.0));
        }

        [Fact]
        public void AnUnchangingRegimeStillReports()
        {
            var watch = new SignalDelayRate();
            watch.Observe(Route("ksc"), 0.0, CommsDelaySource.None, 100.0);

            // The guard is on the regime CHANGING, not on which regime it is: a
            // save with delay switched off has a real and measured rate of zero.
            Assert.Equal(0.0, watch.Observe(Route("ksc"), 0.0, CommsDelaySource.None, 102.0)!.Value);
        }

        [Fact]
        public void AnEmptyRouteAndAnAbsentOneCompareEqual()
        {
            var watch = new SignalDelayRate();
            watch.Observe(new CommsPath { Hops = new List<CommsHop>() }, 0.0, SIGNAL, 100.0);

            // Both spell "no hops", and reading them as a reroute would refuse a
            // rate for a link that never changed.
            Assert.Equal(0.0, watch.Observe(null, 0.0, SIGNAL, 102.0)!.Value);
        }
    }
}

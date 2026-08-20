using System.Collections.Generic;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The uplink's publish rule, driven with no game present.
    ///
    /// <para>This is what the partial-class split buys. <c>PrincipiaUplink</c> names
    /// no Harmony or KSP type, so the decision it makes about WHEN to publish is
    /// provable here against a scripted observer, and the decision matters: an
    /// observation is a claim about a past instant, so republishing it at each new
    /// tick would re-assert a stale reading as if it had just been taken.</para>
    /// </summary>
    public class FlightPlanPublishRuleTests
    {
        [Fact]
        public void PublishesNothingBeforeThePlannerHasEverBeenOpened()
        {
            var uplink = new PrincipiaUplink(PrincipiaGuardResult.Ok(null), new FakeObserver());

            Assert.Null(uplink.CaptureOnMain(null));
        }

        /// <summary>
        /// The empty-list case, at the level that decides it. A vessel whose planner
        /// has never been opened has no observation, so this channel says nothing at
        /// all rather than publishing a plan with no burns in it. Those are different
        /// claims, and the second one reads as "this vessel has no plan".
        /// </summary>
        [Fact]
        public void AnUnobservedPlanIsSilenceRatherThanAnEmptyPlan()
        {
            var observer = new FakeObserver();
            var uplink = new PrincipiaUplink(PrincipiaGuardResult.Ok(null), observer);

            Assert.Null(uplink.CaptureOnMain(null));

            observer.Latest = new FlightPlanObservation
            {
                VesselId = "g",
                ObservedAtUt = 100.0,
                PlanExists = true,
                Burns = new List<BurnObservation> { new BurnObservation { Index = 0 } },
            };

            var captured = Assert.IsType<FlightPlanObservation>(uplink.CaptureOnMain(null));
            Assert.Single(captured.Burns);
        }

        /// <summary>
        /// Each observation is published once. A second tick with nothing new
        /// captures nothing, because the sample already on the wire is still the
        /// most recent reading and re-stamping it would move a past observation
        /// forward in time.
        /// </summary>
        [Fact]
        public void PublishesOneObservationOnceAndNotAgainOnTheNextTick()
        {
            var observer = new FakeObserver
            {
                Latest = new FlightPlanObservation { ObservedAtUt = 100.0 },
            };
            var uplink = new PrincipiaUplink(PrincipiaGuardResult.Ok(null), observer);

            Assert.NotNull(uplink.CaptureOnMain(null));
            Assert.Null(uplink.CaptureOnMain(null));
            Assert.Null(uplink.CaptureOnMain(null));
        }

        [Fact]
        public void PublishesAgainWhenTheObservationIsNewer()
        {
            var observer = new FakeObserver
            {
                Latest = new FlightPlanObservation { ObservedAtUt = 100.0 },
            };
            var uplink = new PrincipiaUplink(PrincipiaGuardResult.Ok(null), observer);
            Assert.NotNull(uplink.CaptureOnMain(null));

            observer.Latest = new FlightPlanObservation { ObservedAtUt = 200.0 };

            var captured = Assert.IsType<FlightPlanObservation>(uplink.CaptureOnMain(null));
            Assert.Equal(200.0, captured.ObservedAtUt);
        }

        /// <summary>
        /// A reload can put the clock behind where it was, so an observation with an
        /// EARLIER instant than the last published one is not new and must not
        /// overwrite it on a lossy-latest channel. Guarding both directions rather
        /// than only the equal case, because a backwards jump is the one that would
        /// silently replace a good sample with an older one.
        /// </summary>
        [Fact]
        public void AnEarlierObservationDoesNotDisplaceALaterOne()
        {
            var observer = new FakeObserver
            {
                Latest = new FlightPlanObservation { ObservedAtUt = 500.0 },
            };
            var uplink = new PrincipiaUplink(PrincipiaGuardResult.Ok(null), observer);
            Assert.NotNull(uplink.CaptureOnMain(null));

            observer.Latest = new FlightPlanObservation { ObservedAtUt = 100.0 };

            Assert.Null(uplink.CaptureOnMain(null));
        }

        private sealed class FakeObserver : IFlightPlanObserver
        {
            public FlightPlanObservation? Latest { get; set; }

            public bool TryAttach() => true;
        }
    }
}

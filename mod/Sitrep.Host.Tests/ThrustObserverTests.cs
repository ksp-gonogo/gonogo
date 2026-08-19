using Sitrep.Host.Propulsion;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The latch that lets a client say "the engines ran and have stopped"
    /// without having seen the frame they stopped on. Every property asserted
    /// here is one a lossy transport would otherwise break.
    /// </summary>
    public class ThrustObserverTests
    {
        private const string Craft = "vessel:a";

        [Fact]
        public void SaysNothingBeforeAnyThrustIsSeen()
        {
            var observer = new ThrustObserver();
            observer.Observe(Craft, ut: 100, thrustKn: 0, measurable: true);

            Assert.Null(observer.ThrustStartedUt);
            Assert.Null(observer.LastThrustEndUt);
        }

        [Fact]
        public void LatchesTheInstantThrustBegan()
        {
            var observer = new ThrustObserver();
            observer.Observe(Craft, ut: 100, thrustKn: 0, measurable: true);
            observer.Observe(Craft, ut: 101, thrustKn: 50, measurable: true);

            Assert.Equal(101, observer.ThrustStartedUt);
            Assert.Null(observer.LastThrustEndUt);
        }

        /// <summary>
        /// The start instant is the start of the PERIOD, not of the last
        /// reading in it: a burn that has been running for a minute must not
        /// keep reporting that it started a second ago.
        /// </summary>
        [Fact]
        public void KeepsTheStartInstantWhileThrustContinues()
        {
            var observer = new ThrustObserver();
            observer.Observe(Craft, ut: 101, thrustKn: 50, measurable: true);
            observer.Observe(Craft, ut: 102, thrustKn: 60, measurable: true);
            observer.Observe(Craft, ut: 160, thrustKn: 55, measurable: true);

            Assert.Equal(101, observer.ThrustStartedUt);
        }

        /// <summary>
        /// The reason the whole class exists: after a burn ends, EVERY
        /// subsequent frame carries the same answer, so a consumer that
        /// subscribed late or lost the frames in between still learns that the
        /// engines ran and stopped.
        /// </summary>
        [Fact]
        public void EveryLaterReadingStillReportsTheCessation()
        {
            var observer = new ThrustObserver();
            observer.Observe(Craft, ut: 101, thrustKn: 50, measurable: true);
            observer.Observe(Craft, ut: 140, thrustKn: 0, measurable: true);
            observer.Observe(Craft, ut: 200, thrustKn: 0, measurable: true);
            observer.Observe(Craft, ut: 900, thrustKn: 0, measurable: true);

            Assert.Null(observer.ThrustStartedUt);
            Assert.Equal(140, observer.LastThrustEndUt);
        }

        [Fact]
        public void ASecondBurnReplacesTheStartAndKeepsTheEarlierEnd()
        {
            var observer = new ThrustObserver();
            observer.Observe(Craft, ut: 101, thrustKn: 50, measurable: true);
            observer.Observe(Craft, ut: 140, thrustKn: 0, measurable: true);
            observer.Observe(Craft, ut: 300, thrustKn: 20, measurable: true);

            Assert.Equal(300, observer.ThrustStartedUt);
            Assert.Equal(140, observer.LastThrustEndUt);
        }

        /// <summary>
        /// An on-rails craft has no parts to read, so it reports no thrust.
        /// Reading that as a cessation would announce a stopped burn every time
        /// the operator switched away from a burning craft.
        /// </summary>
        [Fact]
        public void AnUnmeasurableTickHoldsBothLatches()
        {
            var observer = new ThrustObserver();
            observer.Observe(Craft, ut: 101, thrustKn: 50, measurable: true);
            observer.Observe(Craft, ut: 120, thrustKn: 0, measurable: false);

            Assert.Equal(101, observer.ThrustStartedUt);
            Assert.Null(observer.LastThrustEndUt);
        }

        [Fact]
        public void ANonFiniteReadingHoldsBothLatches()
        {
            var observer = new ThrustObserver();
            observer.Observe(Craft, ut: 101, thrustKn: 50, measurable: true);
            observer.Observe(Craft, ut: 120, thrustKn: double.NaN, measurable: true);

            Assert.Equal(101, observer.ThrustStartedUt);
            Assert.Null(observer.LastThrustEndUt);
        }

        /// <summary>
        /// The previous craft's engines say nothing about this one's, so a
        /// switch must not leave the new craft holding a burn it never flew.
        /// </summary>
        [Fact]
        public void SwitchingCraftClearsBothLatches()
        {
            var observer = new ThrustObserver();
            observer.Observe(Craft, ut: 101, thrustKn: 50, measurable: true);
            observer.Observe(Craft, ut: 140, thrustKn: 0, measurable: true);
            observer.Observe("vessel:b", ut: 141, thrustKn: 0, measurable: true);

            Assert.Null(observer.ThrustStartedUt);
            Assert.Null(observer.LastThrustEndUt);
        }

        /// <summary>
        /// Engines settle to a residual rather than an exact zero, so a
        /// threshold below the epsilon is no thrust.
        /// </summary>
        [Fact]
        public void AResidualBelowTheEpsilonIsNotThrust()
        {
            var observer = new ThrustObserver();
            observer.Observe(Craft, ut: 101, thrustKn: 50, measurable: true);
            observer.Observe(Craft, ut: 140, thrustKn: ThrustObserver.ThrustEpsilonKn, measurable: true);

            Assert.Null(observer.ThrustStartedUt);
            Assert.Equal(140, observer.LastThrustEndUt);
        }

        /// <summary>
        /// A quickload moves UT backwards. A latched instant then sits in the
        /// craft's own future, which reads as a burn that ended before it
        /// happened and would let conformance announce a burn stopped short of
        /// a target it has not reached yet.
        ///
        /// <para>Merged from a second implementation of this class written
        /// independently against the same brief. It was the one case that one
        /// covered and this one did not.</para>
        /// </summary>
        [Fact]
        public void AnInstantLeftInTheFutureByARewindIsDropped()
        {
            var observer = new ThrustObserver();
            observer.Observe("v-1", 100, 60, measurable: true);
            observer.Observe("v-1", 145, 0, measurable: true);
            Assert.Equal(145, observer.LastThrustEndUt);

            observer.Observe("v-1", 120, 0, measurable: true);

            Assert.Null(observer.LastThrustEndUt);
        }

        /// <summary>
        /// Rewinding past a START instant re-establishes it at the tick actually
        /// being observed rather than leaving the old one in the future. The
        /// craft IS thrusting at the rewound tick, so "began at 80" is the true
        /// answer and "began at 100" is a claim about a moment that has not
        /// happened again yet.
        /// </summary>
        [Fact]
        public void ARewindPastAStartInstantReanchorsItToTheRewoundTick()
        {
            var observer = new ThrustObserver();
            observer.Observe("v-1", 100, 60, measurable: true);
            Assert.Equal(100, observer.ThrustStartedUt);

            observer.Observe("v-1", 80, 60, measurable: true);

            Assert.Equal(80, observer.ThrustStartedUt);
        }

    }
}

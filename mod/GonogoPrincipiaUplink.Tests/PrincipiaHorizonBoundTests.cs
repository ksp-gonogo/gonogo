using System;
using System.Collections.Generic;
using GonogoPrincipiaUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// How far this Uplink will vouch for a craft's published elements, driven
    /// against the geometry two real craft in a live save actually presented.
    ///
    /// <para><b>Every number below was measured on the rig on 2026-09-05</b>, from
    /// the running game's own <c>system.bodies</c> and <c>vessel.orbit</c> frames and
    /// the save's vessel list. The masses, radii and distances are transcribed, not
    /// invented, and the drift figures each case names came from integrating the
    /// mod's own force model against the two-body extrapolation on the Deck. A bound
    /// checked against arithmetic written beside it agrees with itself forever; these
    /// are checked against craft.</para>
    ///
    /// <para>The two Kerbin relays are the case that matters. They are the same
    /// design in the same save around the same body, and the higher one wants a
    /// horizon 1.75 times SHORTER while its cycle is 5.35 times LONGER. No fraction
    /// of a cycle can produce that pair, which is why the bound moved out of core.</para>
    /// </summary>
    public class PrincipiaHorizonBoundTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double MunMu = 6.513839752e10;
        private const double SunMu = 1.172332795e18;
        private const double MinmusMu = 1765800026.0;

        /// <summary>Distances from Kerbin at the sample instant, metres.</summary>
        private const double MunDistance = 12073467.225419;
        private const double SunDistance = 13599878974.072937;
        private const double MinmusDistance = 47622140.125335;

        // The 250 km relay: 850 km of radius, a 2620 s cycle.
        private const double LowRelayRadius = 850007.150699;
        private const double LowRelayCycle = 2620.119910;

        // The 2600 km relay: the same design, five times the cycle.
        private const double HighRelayRadius = 2598779.512663;
        private const double HighRelayCycle = 14012.573650;

        [Fact]
        public void TheTidalTermMatchesTheMoonTheRigMeasured()
        {
            // The Mun's differential pull across a 250 km Kerbin orbit, in metres per
            // second squared. It is 98.7% of everything acting on that craft.
            Assert.Equal(
                6.292071116e-05,
                PrincipiaHorizonBound.PerturbingAcceleration(LowRelayRadius, MunMu, MunDistance),
                12);
        }

        [Fact]
        public void ABodyWithNoUsableMassOrDistanceDropsOutOfTheSumInsteadOfPoisoningIt()
        {
            Assert.Equal(0.0, PrincipiaHorizonBound.PerturbingAcceleration(LowRelayRadius, MunMu, 0.0));
            Assert.Equal(0.0, PrincipiaHorizonBound.PerturbingAcceleration(LowRelayRadius, 0.0, MunDistance));
            Assert.Equal(
                0.0,
                PrincipiaHorizonBound.PerturbingAcceleration(
                    LowRelayRadius, MunMu, double.PositiveInfinity));
        }

        /// <summary>
        /// The bound for each relay, and the fact that neither is a fraction of its
        /// own cycle.
        ///
        /// <para>Measured on the rig at the WORST orbital phase of eight, the
        /// two-body extrapolation was 100 m off the integrated path after 628.8 s for
        /// the low relay and 700.6 s for the high one. Both bounds sit under those,
        /// which is the direction that withholds a trajectory rather than drawing one
        /// nothing flies.</para>
        /// </summary>
        [Fact]
        public void TwoRelaysInOneSaveGetHorizonsNoFractionOfACycleCouldProduce()
        {
            var low = PrincipiaHorizonBound.SpanSeconds(LowRelayPerturbation(), LowRelayCycle);
            var high = PrincipiaHorizonBound.SpanSeconds(HighRelayPerturbation(), HighRelayCycle);

            Assert.Equal(442.839, low!.Value, 2);
            Assert.Equal(253.263, high!.Value, 2);

            // The higher craft's cycle is longer and its horizon is shorter, so no
            // multiple of the cycle can order the two the way the physics does.
            Assert.True(high.Value < low.Value);
            Assert.True(HighRelayCycle > LowRelayCycle);

            // Under what the rig measured, both of them.
            Assert.True(low.Value < 628.8);
            Assert.True(high.Value < 700.6);
        }

        /// <summary>
        /// The bound the flat rule used to give the high relay, against what the rig
        /// says that craft can stand.
        ///
        /// <para>This is the defect stated as a number: a quarter of the high relay's
        /// cycle is 3503 seconds, and its elements are 100 m wrong after 700. The rule
        /// was not slightly out, it was out by five, and in the direction that draws a
        /// curve the craft does not fly.</para>
        /// </summary>
        [Fact]
        public void TheFlatQuarterCycleRuleWasFiveTimesTooLongForTheHighRelay()
        {
            var quarterCycle = 0.25 * HighRelayCycle;

            Assert.True(quarterCycle > 5.0 * 700.6);
            Assert.True(PrincipiaHorizonBound.SpanSeconds(HighRelayPerturbation(), HighRelayCycle)
                is { } bound && bound < 700.6);
        }

        [Fact]
        public void ACalmNeighbourhoodIsHeldAtTheCycleCeilingRatherThanRunningAway()
        {
            // A thousandth of what the Mun does to a Kerbin relay. The kinematic term
            // alone would vouch for hours; the ceiling is what stops it, because the
            // acceleration was measured where the craft is NOW and a cycle later the
            // geometry that produced it has turned over.
            var span = PrincipiaHorizonBound.SpanSeconds(1e-9, LowRelayCycle);

            Assert.Equal(LowRelayCycle * PrincipiaHorizonBound.CycleCeilingFraction, span!.Value, 6);
        }

        [Fact]
        public void NothingPullingAndNoCycleIsARefusalRatherThanAGuess()
        {
            Assert.Null(PrincipiaHorizonBound.SpanSeconds(0.0, null));
            Assert.Null(PrincipiaHorizonBound.SpanSeconds(double.NaN, null));
        }

        [Fact]
        public void ACraftWithNoCycleIsStillBoundedByWhatPullsOnIt()
        {
            // A hyperbolic craft has no repeat to take a ceiling from, but the force
            // model still says how fast its conic goes wrong.
            Assert.Equal(442.839, PrincipiaHorizonBound.SpanSeconds(LowRelayPerturbation(), null)!.Value, 2);
        }

        /// <summary>
        /// The provider computes the same bound from the pieces it can reach, rather
        /// than being handed the sum.
        ///
        /// <para>The stub solver below answers exactly what the rig's own
        /// <c>system.bodies</c> frame implies for these craft: the craft's radius from
        /// its primary, and each perturber's distance from the same primary.</para>
        /// </summary>
        [Fact]
        public void TheProviderRefusesTheWindowPastItsOwnBoundAndAllowsTheOneInside()
        {
            var provider = RelayProvider(LowRelayRadius, LowRelayCycle);
            var target = Craft(LowRelayCycle);
            var frame = PropagationFrame.CentredOn(Kerbin);

            Assert.True(provider.CanPropagate(target, frame, 100.0, 100.0 + 442.0));
            Assert.False(provider.CanPropagate(target, frame, 100.0, 100.0 + 444.0));
        }

        [Fact]
        public void TheProviderBoundsTheHigherRelayShorterDespiteItsLongerCycle()
        {
            var lowRelay = RelayProvider(LowRelayRadius, LowRelayCycle);
            var highRelay = RelayProvider(HighRelayRadius, HighRelayCycle);
            var frame = PropagationFrame.CentredOn(Kerbin);

            // 300 seconds is inside the low relay's bound of 443 and outside the high
            // relay's of 253, though the high relay's cycle is five times longer.
            Assert.True(lowRelay.CanPropagate(Craft(LowRelayCycle), frame, 0.0, 300.0));
            Assert.False(highRelay.CanPropagate(Craft(HighRelayCycle), frame, 0.0, 300.0));
        }

        [Fact]
        public void TheInstantItselfIsAnsweredHoweverPerturbedTheCraftIs()
        {
            // Every visibility and encounter caller asks a zero-length window, which
            // is asking where something IS. The osculating elements answer that
            // exactly, so a horizon has nothing to say about it.
            var provider = RelayProvider(HighRelayRadius, HighRelayCycle);

            Assert.True(provider.CanPropagate(
                Craft(HighRelayCycle), PropagationFrame.CentredOn(Kerbin), 500.0, 500.0));
        }

        [Fact]
        public void WithNoForceModelTheProviderVouchesForNoWindowAtAll()
        {
            // An install whose gravity model could not be read has no way to bound a
            // craft. Refusing is what turns that into an Unspecified horizon, which a
            // client reads as unpropagatable; substituting stock's masses would answer
            // with a bound that agrees with nothing.
            var provider = new PrincipiaPropagationProvider(
                new StubConics(LowRelayRadius, LowRelayCycle),
                () => null,
                _ => KerbinNeighbourhood);
            var frame = PropagationFrame.CentredOn(Kerbin);

            Assert.True(provider.CanPropagate(Craft(LowRelayCycle), frame, 0.0, 0.0));
            Assert.False(provider.CanPropagate(Craft(LowRelayCycle), frame, 0.0, 1.0));
        }

        [Fact]
        public void ABodyIsNeverBoundedBecauseTheHorizonIsAboutACraftsOwnElements()
        {
            // The acceleration walk that computes a bound asks this same question
            // about each perturber it wants to place, so bounding a body here would
            // refuse the walk the bound is made of.
            var provider = RelayProvider(HighRelayRadius, HighRelayCycle);

            Assert.True(provider.CanPropagate(
                PropagationTarget.Body(Mun), PropagationFrame.CentredOn(Kerbin), 0.0, 86_400.0));
        }

        [Fact]
        public void APerturberTheForceModelDoesNotNameShortensTheBoundInsteadOfStoppingIt()
        {
            // A term that cannot be matched is a term that cannot be summed, so the
            // bound comes out LONGER than the truth: the model is degraded and the
            // arc says so separately. What must not happen is the whole answer going
            // away, because a craft with one unknown neighbour is still bounded by the
            // ones we do know.
            var provider = new PrincipiaPropagationProvider(
                new StubConics(LowRelayRadius, LowRelayCycle),
                () => new GravityModel("partial", new[] { new GravityModelBody("Sun", SunMu) }),
                _ => KerbinNeighbourhood);
            var frame = PropagationFrame.CentredOn(Kerbin);

            // The Sun alone across this orbit is 7.92e-7 m/s^2, which bounds it at
            // 3970 s before the cycle ceiling cuts it to a quarter of 2620.
            Assert.True(provider.CanPropagate(Craft(LowRelayCycle), frame, 0.0, 655.0));
            Assert.False(provider.CanPropagate(Craft(LowRelayCycle), frame, 0.0, 656.0));
        }

        private const int Kerbin = 1;
        private const int Mun = 2;
        private const int Minmus = 3;
        private const int Sun = 0;

        /// <summary>
        /// Kerbin's neighbourhood as the rig walked it, minus the two planets whose
        /// terms are below 1e-10 and cannot move any assertion here.
        /// </summary>
        private static readonly IReadOnlyList<PrincipiaPerturber> KerbinNeighbourhood =
            new[]
            {
                new PrincipiaPerturber("Mun", Mun),
                new PrincipiaPerturber("Minmus", Minmus),
                new PrincipiaPerturber("Sun", Sun),
            };

        private static double Perturbation(double radius) =>
            PrincipiaHorizonBound.PerturbingAcceleration(radius, MunMu, MunDistance)
            + PrincipiaHorizonBound.PerturbingAcceleration(radius, MinmusMu, MinmusDistance)
            + PrincipiaHorizonBound.PerturbingAcceleration(radius, SunMu, SunDistance);

        private static double LowRelayPerturbation() => Perturbation(LowRelayRadius);

        private static double HighRelayPerturbation() => Perturbation(HighRelayRadius);

        private static PrincipiaPropagationProvider RelayProvider(double radius, double cycle) =>
            new PrincipiaPropagationProvider(
                new StubConics(radius, cycle),
                () => new GravityModel(
                    "rig-2026-09-05",
                    new[]
                    {
                        new GravityModelBody("Mun", MunMu),
                        new GravityModelBody("Minmus", MinmusMu),
                        new GravityModelBody("Sun", SunMu),
                    }),
                _ => KerbinNeighbourhood);

        /// <summary>
        /// A craft about Kerbin. Only the id, the parent and the presence of elements
        /// matter to the bound: the geometry comes from the solver, which is the whole
        /// point of asking one rather than reading the conic here.
        /// </summary>
        private static PropagationTarget Craft(double cycle) =>
            PropagationTarget.Vessel(
                "craft-" + cycle.ToString("R"),
                Kerbin,
                new OrbitElements(cycle * 100.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu));

        /// <summary>
        /// The displaced solver, answering the rig's own geometry: the craft at the
        /// radius it was at, each body at the distance from Kerbin it was at.
        /// </summary>
        private sealed class StubConics : IPropagationProvider
        {
            private readonly double _craftRadius;
            private readonly double _cycle;

            public StubConics(double craftRadius, double cycle)
            {
                _craftRadius = craftRadius;
                _cycle = cycle;
            }

            public string ProviderId => "stub-conics";

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut)
            {
                var radius = target.Kind == PropagationTargetKind.Vessel
                    ? _craftRadius
                    : target.BodyIndex == Mun ? MunDistance
                    : target.BodyIndex == Minmus ? MinmusDistance
                    : SunDistance;
                return new StateVector(new Vector3d(radius, 0, 0), new Vector3d(0, 0, 0));
            }

            public void SolveMany(
                PropagationTarget target,
                PropagationFrame frame,
                IReadOnlyList<double> uts,
                StateVector[] into)
            {
                for (var i = 0; i < uts.Count; i++) into[i] = Solve(target, frame, uts[i]);
            }

            public double? CharacteristicCycleSeconds(PropagationTarget target) =>
                target.Kind == PropagationTargetKind.Vessel ? _cycle : (double?)null;

            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) => null;

            public bool CanPropagate(
                PropagationTarget target, PropagationFrame frame, double fromUt, double toUt) => true;

            public ClosestApproach? SolveClosestApproach(
                PropagationTarget subject,
                PropagationTarget other,
                PropagationFrame frame,
                double fromUt,
                double toUt) => null;
        }
    }
}

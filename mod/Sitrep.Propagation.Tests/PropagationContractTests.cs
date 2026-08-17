using System;
using System.Collections.Generic;
using Xunit;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// The provider contract that is keyed on an IDENTITY plus a FRAME rather than
    /// on a set of elements. The distinction is the whole point: elements describe a
    /// conic, so a provider handed only elements can answer only in conics, however
    /// it is implemented. A target names WHAT to propagate and carries the conic
    /// merely as the payload the two-body vanilla happens to need.
    ///
    /// <para>The three members beyond <c>Solve</c> exist because the codebase was
    /// computing all three inline, outside any provider: an orbital period from
    /// sma/mu at five separate sites, a propagability predicate from ecc/sma/mu at
    /// two, and a batch of solves one at a time in the visibility sweep's inner
    /// loop.</para>
    /// </summary>
    public class PropagationContractTests
    {
        private const double Tolerance = 1e-9;

        private const int Kerbin = 1;
        private const int Mun = 2;

        private static OrbitElements LowOrbit() => new OrbitElements(
            sma: 700_000.0,
            ecc: 0.0,
            inc: 0.0,
            lan: 0.0,
            argPe: 0.0,
            meanAnomalyAtEpoch: 0.0,
            epoch: 0.0,
            mu: 3.5316e12);

        private static PropagationTarget Vessel(OrbitElements orbit, int parent = Kerbin) =>
            PropagationTarget.Vessel("vessel-guid", parent, orbit);

        [Fact]
        public void AConicIsAnsweredTheSameWhicheverBodyItIsSaidToOrbit()
        {
            // The frame index is a LABEL when it matches the target's parent, not a
            // transform: nothing about a two-body conic depends on which body the caller
            // says it goes round, only on the two agreeing. This used to be phrased as
            // "the target-keyed solve matches the element-keyed one", which stopped
            // meaning anything when the element-keyed door was closed.
            IPropagationProvider provider = new KeplerProvider();
            var orbit = LowOrbit();

            foreach (var ut in new[] { 0.0, 137.0, 900.0, 1958.0, 5000.0 })
            {
                var viaElements = provider.SolveConic(orbit, ut);
                var viaTarget = provider.Solve(Vessel(orbit), PropagationFrame.CentredOn(Kerbin), ut);

                Assert.Equal(viaElements.Position.X, viaTarget.Position.X, 6);
                Assert.Equal(viaElements.Position.Y, viaTarget.Position.Y, 6);
                Assert.Equal(viaElements.Position.Z, viaTarget.Position.Z, 6);
                Assert.Equal(viaElements.Velocity.X, viaTarget.Velocity.X, 6);
                Assert.Equal(viaElements.Velocity.Y, viaTarget.Velocity.Y, 6);
                Assert.Equal(viaElements.Velocity.Z, viaTarget.Velocity.Z, 6);
            }
        }

        [Fact]
        public void ProviderIdentifiesItself()
        {
            // Nothing outside the election may branch on WHICH provider is active,
            // so the provider says what it is rather than being asked.
            Assert.Equal("kepler", new KeplerProvider().ProviderId);
        }

        [Fact]
        public void CharacteristicCycleIsTheOrbitalPeriodForABoundOrbit()
        {
            var orbit = LowOrbit();
            var expected = 2.0 * Math.PI * Math.Sqrt(orbit.Sma * orbit.Sma * orbit.Sma / orbit.Mu);

            var cycle = new KeplerProvider().CharacteristicCycleSeconds(Vessel(orbit));

            Assert.NotNull(cycle);
            Assert.Equal(expected, cycle!.Value, 6);
        }

        [Theory]
        [InlineData(1.0)]
        [InlineData(1.4)]
        public void CharacteristicCycleDeclinesForAnUnboundOrbit(double ecc)
        {
            // A hyperbolic trajectory has no period, and the honest answer is to
            // decline rather than to return a number the caller will scale a
            // deadline by. Every caller of this already has a no-period branch,
            // because the inline sites it replaces all guarded on ecc >= 1.
            var orbit = LowOrbit();
            orbit.Ecc = ecc;

            Assert.Null(new KeplerProvider().CharacteristicCycleSeconds(Vessel(orbit)));
        }

        [Theory]
        [InlineData(0.0, 3.5316e12)]
        [InlineData(-1.0, 3.5316e12)]
        [InlineData(700_000.0, 0.0)]
        public void CharacteristicCycleDeclinesForDegenerateElements(double sma, double mu)
        {
            var orbit = LowOrbit();
            orbit.Sma = sma;
            orbit.Mu = mu;

            Assert.Null(new KeplerProvider().CharacteristicCycleSeconds(Vessel(orbit)));
        }

        [Fact]
        public void CharacteristicCycleDeclinesWhenTheTargetCarriesNoElements()
        {
            // A target with no osculating payload is exactly what a non-Keplerian
            // provider would be handed. The two-body vanilla has nothing to say
            // about it and must not invent an answer.
            var target = PropagationTarget.Vessel("vessel-guid", Kerbin, null);

            Assert.Null(new KeplerProvider().CharacteristicCycleSeconds(target));
        }

        [Fact]
        public void CanPropagateABoundOrbitOverAnyWindow()
        {
            // Kepler's horizon is unbounded: the analytic solution is as valid a
            // year out as a second out. A provider that integrates would answer
            // differently here, which is the entire reason the window is a
            // parameter rather than assumed.
            IPropagationProvider provider = new KeplerProvider();

            Assert.True(provider.CanPropagate(Vessel(LowOrbit()), 0.0, 86_400.0));
            Assert.True(provider.CanPropagate(Vessel(LowOrbit()), 0.0, 3.15e7));
        }

        [Theory]
        [InlineData(1.0)]
        [InlineData(2.5)]
        public void CannotPropagateAnUnboundOrbit(double ecc)
        {
            var orbit = LowOrbit();
            orbit.Ecc = ecc;

            Assert.False(new KeplerProvider().CanPropagate(Vessel(orbit), 0.0, 100.0));
        }

        [Theory]
        [InlineData(0.0, 3.5316e12)]
        [InlineData(700_000.0, 0.0)]
        public void CannotPropagateDegenerateElements(double sma, double mu)
        {
            // KSP gives the Sun ecc = 1 and sma = 0, so the root body reaches this
            // guard on every chain walk that climbs to the star.
            var orbit = LowOrbit();
            orbit.Sma = sma;
            orbit.Mu = mu;

            Assert.False(new KeplerProvider().CanPropagate(Vessel(orbit), 0.0, 100.0));
        }

        [Fact]
        public void CannotPropagateATargetCarryingNoElements()
        {
            var target = PropagationTarget.Vessel("vessel-guid", Kerbin, null);

            Assert.False(new KeplerProvider().CanPropagate(target, 0.0, 100.0));
        }

        [Fact]
        public void SolveManyMatchesTheSameSolvesTakenOneAtATime()
        {
            // The batch form exists for the visibility sweep, which takes ~1440
            // samples per silence event. For the analytic vanilla it is a loop and
            // the equality below is trivial; for an integrating provider it is the
            // difference between one pass and 1440, which is why the sweep must ask
            // this way rather than in a loop of its own.
            IPropagationProvider provider = new KeplerProvider();
            var target = Vessel(LowOrbit());
            var frame = PropagationFrame.CentredOn(Kerbin);
            var uts = new List<double>();
            for (var i = 0; i < 64; i++)
            {
                uts.Add(i * 30.5);
            }

            var batched = new StateVector[uts.Count];
            provider.SolveMany(target, frame, uts, batched);

            for (var i = 0; i < uts.Count; i++)
            {
                var one = provider.Solve(target, frame, uts[i]);
                Assert.Equal(one.Position.X, batched[i].Position.X, Tolerance);
                Assert.Equal(one.Position.Y, batched[i].Position.Y, Tolerance);
                Assert.Equal(one.Position.Z, batched[i].Position.Z, Tolerance);
                Assert.Equal(one.Velocity.X, batched[i].Velocity.X, Tolerance);
            }
        }

        [Fact]
        public void SolveManyRejectsAnUndersizedDestination()
        {
            // Silently filling part of a caller's buffer would leave stale samples
            // in the tail, which in a sweep reads as a plausible extra crossing.
            IPropagationProvider provider = new KeplerProvider();

            Assert.Throws<ArgumentException>(() => provider.SolveMany(
                Vessel(LowOrbit()),
                PropagationFrame.CentredOn(Kerbin),
                new[] { 0.0, 1.0, 2.0 },
                new StateVector[2]));
        }

        [Fact]
        public void ATargetCarriesTheBodyItOrbitsSoAFrameRequestCanBeChecked()
        {
            var target = Vessel(LowOrbit(), parent: Mun);

            Assert.Equal(Mun, target.ParentBodyIndex);
            Assert.Equal(PropagationTargetKind.Vessel, target.Kind);
            Assert.Equal("vessel-guid", target.Id);
        }

        [Fact]
        public void ABodyTargetNamesItsIndexAndNothingElse()
        {
            // No elements and no parent, unlike a vessel. Which body a body orbits
            // and on what conic is the provider's to know, and a caller that
            // supplied its own copy would be handing over a second opinion.
            var target = PropagationTarget.Body(Mun);

            Assert.Equal(PropagationTargetKind.Body, target.Kind);
            Assert.Equal(Mun, target.BodyIndex);
            Assert.Null(target.Osculating);
        }
    }
}

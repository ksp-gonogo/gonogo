using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Propagation;
using Sitrep.Propagation;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Propagating from a state a command centre supplied. The physics is the shared
    /// integrator's and is tested with it; what these check is that the seed reaches
    /// it unaltered, and above all that it is integrated from the instant it was
    /// TRUE.
    /// </summary>
    public class SeededNBodyProviderTests
    {
        private const int Kerbin = 1;
        private const double Mu = 3.5316e12;

        private sealed class StandInPropagation : IPropagationProvider
        {
            public string ProviderId => "stand-in";
            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut) =>
                new StateVector(new Vector3d(700_000, 0, 0), new Vector3d(0, 2246, 0));
            public void SolveMany(
                PropagationTarget target, PropagationFrame frame,
                IReadOnlyList<double> uts, StateVector[] into)
            {
                for (var i = 0; i < uts.Count && i < into.Length; i++)
                {
                    into[i] = Solve(target, frame, uts[i]);
                }
            }
            public double? CharacteristicCycleSeconds(PropagationTarget target) => 1800;
            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) => null;
            public bool CanPropagate(
                PropagationTarget target, PropagationFrame frame, double fromUt, double toUt) => true;
            public ClosestApproach? SolveClosestApproach(
                PropagationTarget a, PropagationTarget b, PropagationFrame frame,
                double fromUt, double toUt) => null;
        }

        /// <summary>One body is enough: the integrator refuses an empty force model,
        /// and what these tests are about is the seed instant rather than the
        /// perturbation set.</summary>
        private static GravityModel Model() =>
            new GravityModel(
                "test", new[] { new GravityModelBody("Kerbin", Mu, 600_000) });

        private static SeededNBodyProvider Provider(double? mu = Mu, bool withModel = true) =>
            new SeededNBodyProvider(
                _ => mu,
                _ => new PerturbingBody[0],
                () => new StandInPropagation(),
                _ => withModel ? Model() : null);

        private static DelayedObservation Seed(double observedAtUt, double viewUt) =>
            DelayedObservation.At(
                new StateVector(new Vector3d(700_000, 0, 0), new Vector3d(0, 2246, 0)),
                Kerbin,
                observedAtUt,
                viewUt);

        [Fact]
        public void IntegratesFromTheInstantTheStateWasTrueNotFromTheVantagesView()
        {
            // The load-bearing one. The craft was in this state at 100; the operator's
            // view is 900. Starting the integration at 900 would shift the whole
            // trajectory forward by however stale their news already was, and the arc
            // would look perfectly reasonable.
            var arc = Provider().SolveFrom(Seed(observedAtUt: 100, viewUt: 900), toUt: 2000, maxPoints: 16);

            Assert.True(arc.Solved);
            Assert.Equal(100, arc.Arc!.FromUt);
            Assert.Equal(100, arc.SeededAtUt);
        }

        [Fact]
        public void SaysNoUpFrontWhenThereIsNoForceModelRatherThanRefusingLater()
        {
            // Found by a test that expected a solve and got a refusal: CanSeedFrom
            // checked a strict subset of what SolveFrom checks, so it answered yes and
            // the solve then said no. A pre-check that can be wrong that way is worse
            // than not offering one.
            var provider = Provider(withModel: false);

            Assert.False(provider.CanSeedFrom(Seed(100, 900)));
            Assert.False(provider.SolveFrom(Seed(100, 900), 2000, 16).Solved);
        }

        [Fact]
        public void RefusesABodyItHasNoGravitationalParameterFor()
        {
            var provider = Provider(mu: null);

            Assert.False(provider.CanSeedFrom(Seed(100, 900)));
            Assert.False(provider.SolveFrom(Seed(100, 900), 2000, 16).Solved);
        }

        [Fact]
        public void RefusesAnObservationThatWasNeverEstablished()
        {
            // A refusal is not a state. Integrating from a default-constructed seed
            // would propagate a craft at the origin, at rest, and draw it.
            var nothing = DelayedObservation.Refused(
                DelayedStateRefusal.NothingArrived, "nothing has arrived");

            Assert.False(Provider().CanSeedFrom(nothing));
            Assert.False(Provider().SolveFrom(nothing, 2000, 16).Solved);
        }

        [Fact]
        public void RefusesAHorizonAtOrBeforeTheSeed()
        {
            Assert.False(Provider().SolveFrom(Seed(500, 900), toUt: 500, maxPoints: 16).Solved);
            Assert.False(Provider().SolveFrom(Seed(500, 900), toUt: 400, maxPoints: 16).Solved);
        }

        [Fact]
        public void TheArcRunsToTheHorizonThatWasAskedFor()
        {
            var arc = Provider().SolveFrom(Seed(100, 900), toUt: 1700, maxPoints: 16);

            Assert.True(arc.Solved);
            Assert.True(arc.Arc!.ToUt <= 1700);
            Assert.True(arc.Arc!.ToUt > 100);
        }
    }
}

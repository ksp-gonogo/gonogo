using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Planning from a vantage. The question under test is never "is the physics
    /// right"; it is "could this answer have been computed from something the
    /// operator was never told".
    /// </summary>
    public class VantagePlanningTests
    {
        private static StateAboutBody? AsState(object? value) =>
            value is double x
                ? new StateAboutBody(
                    new StateVector(new Vector3d(x, 0, 0), new Vector3d(0, x, 0)), 1)
                : (StateAboutBody?)null;

        /// <summary>Records what it was seeded with, which is the only thing these
        /// tests care about.</summary>
        private sealed class RecordingProvider : ISeededPropagationProvider
        {
            public readonly List<DelayedObservation> Seeds = new List<DelayedObservation>();
            public bool Refuse;

            public bool CanSeedFrom(DelayedObservation seed) => !Refuse;

            public SeededTrajectory SolveFrom(DelayedObservation seed, double toUt, int maxPoints)
            {
                Seeds.Add(seed);
                return SeededTrajectory.From(
                    new TrajectoryArc { FromUt = seed.ObservedAtUt, ToUt = toUt },
                    seed.ObservedAtUt);
            }
        }

        private static SeededTrajectory Solve(
            Archive archive, RecordingProvider provider, string vantage,
            double delay, double nowUt, double toUt) =>
            VantagePlanning.Solve(
                archive, provider, "vessel.orbit", vantage, delay, nowUt, toUt, 128, AsState);

        [Fact]
        public void SeedsTheProviderWithTheStateTheVantageWasTOLDAbout()
        {
            // The whole architecture in one assertion. The archive holds a newer
            // sample, and this vantage has not been told about it, so the seed is the
            // older one and it is stamped with when IT was true.
            var archive = new Archive();
            archive.Record("vessel.orbit", 1.0, 100);
            archive.Record("vessel.orbit", 2.0, 950);
            var provider = new RecordingProvider();

            Solve(archive, provider, "far", delay: 600, nowUt: 1000, toUt: 2000);

            Assert.Single(provider.Seeds);
            Assert.Equal(100, provider.Seeds[0].ObservedAtUt);
            Assert.Equal(1.0, provider.Seeds[0].State.Position.X);
        }

        [Fact]
        public void TwoVantagesPlanFromDifferentStatesAtTheSameInstant()
        {
            // Same archive, same tick, two command centres. What may be planned from
            // is a property of where you are.
            var archive = new Archive();
            archive.Record("vessel.orbit", 1.0, 100);
            archive.Record("vessel.orbit", 2.0, 950);
            var near = new RecordingProvider();
            var far = new RecordingProvider();

            Solve(archive, near, "near", delay: 10, nowUt: 1000, toUt: 2000);
            Solve(archive, far, "far", delay: 600, nowUt: 1000, toUt: 2000);

            Assert.Equal(950, near.Seeds[0].ObservedAtUt);
            Assert.Equal(100, far.Seeds[0].ObservedAtUt);
        }

        [Fact]
        public void RefusesRatherThanSeedingFromWhatTheGAMEKnows()
        {
            // The craft exists and the game knows where it is. This vantage does not.
            // The provider must not be called at all: a refusal it never sees cannot
            // be turned into an answer by a well-meaning fallback inside it.
            var archive = new Archive();
            archive.Record("vessel.orbit", 1.0, 900);
            var provider = new RecordingProvider();

            var result = Solve(archive, provider, "far", delay: 600, nowUt: 1000, toUt: 2000);

            Assert.False(result.Solved);
            Assert.Empty(provider.Seeds);
        }

        [Fact]
        public void AHorizonBeyondTheVantagesViewIsFineBecauseItIsAPrediction()
        {
            // Easy to over-restrict. The operator is asking where the craft WILL be,
            // and a prediction reaching past what they have been told is the entire
            // point. What would leak is the SEED, not the horizon.
            var archive = new Archive();
            archive.Record("vessel.orbit", 1.0, 100);
            var provider = new RecordingProvider();

            var result = Solve(archive, provider, "far", delay: 600, nowUt: 1000, toUt: 99_000);

            Assert.True(result.Solved);
            Assert.Equal(99_000, result.Arc!.ToUt);
        }

        [Fact]
        public void AHorizonAtOrBeforeTheSeedIsNotAPrediction()
        {
            var archive = new Archive();
            archive.Record("vessel.orbit", 1.0, 500);
            var provider = new RecordingProvider();

            var result = Solve(archive, provider, "ksc", delay: 0, nowUt: 1000, toUt: 400);

            Assert.False(result.Solved);
            Assert.Empty(provider.Seeds);
        }

        [Fact]
        public void NoElectedProviderIsARefusalRatherThanAThrow()
        {
            var archive = new Archive();
            archive.Record("vessel.orbit", 1.0, 100);

            var result = VantagePlanning.Solve(
                archive, null, "vessel.orbit", "ksc", 0, 1000, 2000, 128, AsState);

            Assert.False(result.Solved);
            Assert.NotNull(result.Refusal);
        }

        [Fact]
        public void AProviderThatCannotSeedIsAskedBeforeItIsMadeToSolve()
        {
            var archive = new Archive();
            archive.Record("vessel.orbit", 1.0, 100);
            var provider = new RecordingProvider { Refuse = true };

            var result = Solve(archive, provider, "ksc", delay: 0, nowUt: 1000, toUt: 2000);

            Assert.False(result.Solved);
            Assert.Empty(provider.Seeds);
        }

        [Fact]
        public void TheAnswerCarriesWhatItWasComputedFrom()
        {
            // An arc detached from its seed instant is a path with no claim about
            // which craft, or when. A divergence measured against it later would be
            // measuring against nothing in particular.
            var archive = new Archive();
            archive.Record("vessel.orbit", 1.0, 250);
            var provider = new RecordingProvider();

            var result = Solve(archive, provider, "ksc", delay: 0, nowUt: 1000, toUt: 2000);

            Assert.Equal(250, result.SeededAtUt);
        }
    }
}

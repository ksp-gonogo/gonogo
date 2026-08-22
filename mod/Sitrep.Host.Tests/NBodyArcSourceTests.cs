using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Propagation;
using Sitrep.Propagation;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The seam that turns a <c>vessel.orbit</c> reading into the arc riding on it:
    /// where a missing piece produces a refusal, and where it produces silence.
    ///
    /// <para>The distinction is the whole subject. A refusal puts a sentence and a
    /// remedy on the operator's screen, so refusing for something that is not a
    /// problem tells them to go and fix nothing. Silence draws the conic the horizon
    /// already authorised, which is the right answer for an install with no n-body
    /// physics in it at all.</para>
    /// </summary>
    public class NBodyArcSourceTests
    {
        private const double KerbinMu = 3.5316e12;
        private const int Kerbin = 0, Mun = 1;

        private static IReadOnlyList<SystemBody> System() => new[]
        {
            new SystemBody(-1, new OrbitElements(0.0, 1.0, 0, 0, 0, 0, 0, 0.0)),
            new SystemBody(Kerbin, new OrbitElements(12_000_000.0, 0.0, 0, 0, 0, 0.0, 0.0, KerbinMu)),
        };

        private static GravityModel Model() =>
            new GravityModel("test", new[]
            {
                new GravityModelBody("Kerbin", KerbinMu),
                new GravityModelBody("Mun", 6.5138398e10),
            });

        private static PropagationTarget Craft() =>
            PropagationTarget.Vessel(
                "vessel-guid",
                Kerbin,
                new OrbitElements(700_000.0, 0.0, 0, 0, 0, 0.0, 0.0, KerbinMu));

        private static NBodyArcSource Source(
            GravityModel? model = null,
            IPropagationProvider? propagation = null,
            IReadOnlyList<PerturbingBody>? perturbers = null) =>
            new NBodyArcSource(
                () => model,
                () => propagation,
                _ => perturbers ?? new[] { new PerturbingBody("Mun", Mun) });

        [Fact]
        public void AModelAndAProviderProduceAnArcInTheParentsFrame()
        {
            var answer = Source(Model(), new KeplerProvider(System()))
                .ArcFor(Craft(), 0.0, 1_000.0, 64);

            Assert.Equal(TrajectoryRefusal.Unspecified, answer.Refusal);
            Assert.NotNull(answer.Arc);
            Assert.Equal(TrajectoryFrameKind.BodyCentredInertial, answer.Arc!.Frame.Kind);
            Assert.Equal(Kerbin, answer.Arc.Frame.CentreBodyIndex);
            Assert.Equal(64, answer.Arc.Points.Count);
            Assert.Equal(0.0, answer.Arc.FromUt, 6);
            Assert.Equal(1_000.0, answer.Arc.ToUt, 6);
        }

        [Fact]
        public void NoForceModelIsARefusalTheOperatorIsToldAbout()
        {
            // An install problem with no remedy, so it has to say so rather than
            // going quiet and letting a conic stand in.
            var answer = Source(null, new KeplerProvider(System()))
                .ArcFor(Craft(), 0.0, 1_000.0, 64);

            Assert.Equal(TrajectoryRefusal.NoForceModel, answer.Refusal);
            Assert.Null(answer.Arc);
        }

        [Fact]
        public void NoElectedPropagationIsSILENCERatherThanARefusal()
        {
            // Nothing is wrong with the install here and there is nothing to fix.
            // Refusing would put a remedy on screen for a problem nobody has.
            var answer = Source(Model(), null).ArcFor(Craft(), 0.0, 1_000.0, 64);

            Assert.Equal(TrajectoryRefusal.Unspecified, answer.Refusal);
            Assert.Null(answer.Arc);
        }

        [Fact]
        public void ATargetWithNoConicIsSilenceToo()
        {
            // Same reasoning: no starting state is not a fault in the force model or
            // the budget, and borrowing either sentence would misdirect.
            var answer = Source(Model(), new KeplerProvider(System()))
                .ArcFor(PropagationTarget.Vessel("v", Kerbin, null), 0.0, 1_000.0, 64);

            Assert.Equal(TrajectoryRefusal.Unspecified, answer.Refusal);
            Assert.Null(answer.Arc);
        }

        [Fact]
        public void AWindowThatOutrunsTheStepBudgetRefusesWithItsOwnReason()
        {
            // Distinct from a horizon: this one the operator can shorten a window
            // for, and it may clear on its own.
            var answer = Source(Model(), new KeplerProvider(System()))
                .ArcFor(Craft(), 0.0, 1.0e9, 64);

            Assert.Equal(TrajectoryRefusal.BeyondBudget, answer.Refusal);
            Assert.Null(answer.Arc);
        }

        [Fact]
        public void APerturberOutsideTheModelDegradesRatherThanRefuses()
        {
            var answer = Source(
                    new GravityModel("test", new[] { new GravityModelBody("Kerbin", KerbinMu) }),
                    new KeplerProvider(System()))
                .ArcFor(Craft(), 0.0, 1_000.0, 64);

            Assert.NotNull(answer.Arc);
            Assert.Equal(TrajectoryDerivation.OwnNBodyDegraded, answer.Arc!.Derivation);
            Assert.Contains("Mun", answer.Arc.ForceModel!.MissingTerm);
        }

        [Fact]
        public void TheStepComesFromTheOrbitsOwnPeriodRatherThanAConstant()
        {
            // What keeps the cost roughly flat in revolutions. A synchronous orbit
            // must not be integrated at a low orbit's step.
            var provider = new KeplerProvider(System());
            var low = Source(Model(), provider).ArcFor(Craft(), 0.0, 1_000.0, 64);
            var high = Source(Model(), provider).ArcFor(
                PropagationTarget.Vessel(
                    "v", Kerbin, new OrbitElements(3_463_334.0, 0.0, 0, 0, 0, 0.0, 0.0, KerbinMu)),
                0.0, 1_000.0, 64);

            Assert.True(
                high.Arc!.ForceModel!.StepSeconds > low.Arc!.ForceModel!.StepSeconds * 5.0,
                "A synchronous orbit's step should be several times a low orbit's. Low was "
                + low.Arc.ForceModel.StepSeconds.ToString("F2") + " s and high was "
                + high.Arc.ForceModel.StepSeconds.ToString("F2") + " s.");
        }
    }
}

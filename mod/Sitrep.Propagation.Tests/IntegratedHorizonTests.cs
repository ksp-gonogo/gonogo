using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation;
using Xunit;

namespace Sitrep.Propagation.Tests
{
    /// <summary>
    /// Recovering a horizon from the predicate a provider already answers.
    ///
    /// <para>The whole point of the exercise is that the number comes from the
    /// provider. So every case here asserts against what a provider said, and one of
    /// them asserts that nothing is invented when it says nothing.</para>
    /// </summary>
    public class IntegratedHorizonTests
    {
        private static PropagationTarget Craft() =>
            PropagationTarget.Vessel(
                "a-craft", 1, new OrbitElements(700_000, 0.01, 0, 0, 0, 0, 0, 3.5316e12));

        [Fact]
        public void TheHorizonIsTheLastInstantTheProviderWillVouchFor()
        {
            var provider = new BoundedProvider(cycle: 4000.0, span: 617.5);

            var until = IntegratedHorizon.UntilUt(provider, Craft(), 1000.0);

            // Eighteen halvings of a window four 4000 second cycles wide resolve to
            // about six hundredths of a second, so the answer is the provider's
            // number and not a neighbourhood of it.
            Assert.Equal(1617.5, until!.Value, 1);
        }

        [Fact]
        public void TwoCraftUnderOneProviderGetTheHorizonsThatProviderGivesThem()
        {
            // The property core could not express before: the bound is per craft, not
            // per install, so nothing derived from the cycle alone can produce it.
            var provider = new PerCraftProvider();
            var calm = PropagationTarget.Vessel(
                "calm", 1, new OrbitElements(700_000, 0.01, 0, 0, 0, 0, 0, 3.5316e12));
            var stirred = PropagationTarget.Vessel(
                "stirred", 1, new OrbitElements(700_000, 0.04, 0, 0, 0, 0, 0, 3.5316e12));

            Assert.Equal(100.0, IntegratedHorizon.UntilUt(provider, calm, 0.0)!.Value, 1);
            Assert.Equal(400.0, IntegratedHorizon.UntilUt(provider, stirred, 0.0)!.Value, 1);
        }

        [Fact]
        public void AProviderThatVouchesForTheWholeSearchIsTakenAtItsWordExactlyThatFar()
        {
            // Not further. Somebody has to have measured the window a provider is
            // believed over, and four revolutions is what has been.
            var provider = new BoundedProvider(cycle: 4000.0, span: double.MaxValue);

            Assert.Equal(16000.0, IntegratedHorizon.UntilUt(provider, Craft(), 0.0)!.Value, 6);
        }

        /// <summary>
        /// The revert test for the cap that used to sit here: a provider willing to
        /// vouch for two revolutions gets two, where a one-cycle search would have
        /// handed it back its own cycle and called that the answer.
        /// </summary>
        [Fact]
        public void AProviderIsNotCutOffAtOneRevolutionOfItsOwn()
        {
            var provider = new BoundedProvider(cycle: 4000.0, span: 8123.0);

            var until = IntegratedHorizon.UntilUt(provider, Craft(), 0.0);

            Assert.Equal(8123.0, until!.Value, 1);
            Assert.True(until.Value > 4000.0);
        }

        [Fact]
        public void AProviderThatWillNotAnswerForTheSampleInstantGetsNoHorizon()
        {
            var provider = new BoundedProvider(cycle: 4000.0, span: -1.0);

            Assert.Null(IntegratedHorizon.UntilUt(provider, Craft(), 0.0));
        }

        [Fact]
        public void AProviderThatVouchesForTheInstantAndNothingBeyondItGetsNoHorizon()
        {
            // Zero is a refusal rather than a horizon: elements good for no time at
            // all are elements nothing may be extrapolated from, and publishing
            // `Until` at the sample instant would say the opposite.
            var provider = new BoundedProvider(cycle: 4000.0, span: 0.0);

            Assert.Null(IntegratedHorizon.UntilUt(provider, Craft(), 0.0));
        }

        [Fact]
        public void NoCharacteristicCycleMeansNoScaleToSearchOverAndSoNoHorizon()
        {
            // A hyperbolic craft. The provider may well have a bound and nothing here
            // is entitled to pick the interval to hunt for it in.
            var provider = new BoundedProvider(cycle: null, span: 600.0);

            Assert.Null(IntegratedHorizon.UntilUt(provider, Craft(), 0.0));
        }

        [Fact]
        public void ANonFiniteSampleInstantIsRefusedRatherThanSearchedAround()
        {
            var provider = new BoundedProvider(cycle: 4000.0, span: 600.0);

            Assert.Null(IntegratedHorizon.UntilUt(provider, Craft(), double.NaN));
            Assert.Null(IntegratedHorizon.UntilUt(provider, Craft(), double.PositiveInfinity));
        }

        [Fact]
        public void TheProviderIsAskedInTheCraftsOwnParentFrame()
        {
            // Which is the only frame its elements describe. Asking in any other one
            // would be asking a question about a walk of the body tree, and answering
            // it with a horizon.
            var provider = new BoundedProvider(cycle: 4000.0, span: 600.0);

            IntegratedHorizon.UntilUt(provider, Craft(), 0.0);

            Assert.All(provider.FramesAsked, centre => Assert.Equal(1, centre));
        }

        [Fact]
        public void ANullProviderIsAFaultRatherThanAQuietAbsence()
        {
            Assert.Throws<ArgumentNullException>(
                () => IntegratedHorizon.UntilUt(null!, Craft(), 0.0));
        }

        /// <summary>A provider that vouches for one fixed window, whatever the craft.</summary>
        private sealed class BoundedProvider : StubProvider
        {
            private readonly double? _cycle;
            private readonly double _span;

            public BoundedProvider(double? cycle, double span)
            {
                _cycle = cycle;
                _span = span;
            }

            public override double? CharacteristicCycleSeconds(PropagationTarget target) => _cycle;

            protected override double SpanFor(PropagationTarget target) => _span;
        }

        /// <summary>
        /// A provider whose bound is a property of the CRAFT, which is what one that
        /// models forces has. The eccentricity stands in for a perturbation here;
        /// what matters is that the cycle is identical and the answers are not.
        /// </summary>
        private sealed class PerCraftProvider : StubProvider
        {
            public override double? CharacteristicCycleSeconds(PropagationTarget target) => 4000.0;

            protected override double SpanFor(PropagationTarget target) =>
                10_000.0 * (target.Osculating?.Ecc ?? 0.0);
        }

        private abstract class StubProvider : IPropagationProvider
        {
            public List<int> FramesAsked { get; } = new List<int>();

            public string ProviderId => "stub";

            public abstract double? CharacteristicCycleSeconds(PropagationTarget target);

            protected abstract double SpanFor(PropagationTarget target);

            public bool CanPropagate(
                PropagationTarget target, PropagationFrame frame, double fromUt, double toUt)
            {
                FramesAsked.Add(frame.CentreBodyIndex);
                return toUt - fromUt <= SpanFor(target);
            }

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut) =>
                new StateVector(new Vector3d(0, 0, 0), new Vector3d(0, 0, 0));

            public void SolveMany(
                PropagationTarget target,
                PropagationFrame frame,
                IReadOnlyList<double> uts,
                StateVector[] into)
            {
            }

            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) => null;

            public ClosestApproach? SolveClosestApproach(
                PropagationTarget subject,
                PropagationTarget other,
                PropagationFrame frame,
                double fromUt,
                double toUt) => null;
        }
    }
}

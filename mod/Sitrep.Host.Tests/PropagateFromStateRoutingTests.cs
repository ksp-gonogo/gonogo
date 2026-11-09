using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Propagation;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Who answers a path from a given state. An elected provider answers through
    /// IPropagationFromState when it has it; one built before that interface still loads
    /// and keeps every other answer, and the engine never passes its two-body guess off
    /// as that provider's accurate answer.
    /// </summary>
    public class PropagateFromStateRoutingTests
    {
        private const double Mu = 3.5316e12;

        private static readonly PropagationSeed Seed = new PropagationSeed(
            new StateVector(new Vector3d(700_000.0, 0.0, 0.0), new Vector3d(0.0, 2246.0, 0.0)), 1, 100.0, Mu);

        /// <summary>A provider from before IPropagationFromState: nothing but the provider interface. Whether it integrates is the election's to say.</summary>
        private sealed class OlderIntegratingProvider : IPropagationProvider
        {
            public string ProviderId => "older-n-body";

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut) =>
                new StateVector(new Vector3d(0, 0, 0), new Vector3d(0, 0, 0));

            public void SolveMany(
                PropagationTarget target, PropagationFrame frame, IReadOnlyList<double> uts, StateVector[] into)
            {
            }

            public double? CharacteristicCycleSeconds(PropagationTarget target) => null;

            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) => null;

            public ClosestApproach? SolveClosestApproach(
                PropagationTarget subject, PropagationTarget other, PropagationFrame frame, double fromUt, double toUt) =>
                null;

            public bool CanPropagate(PropagationTarget target, PropagationFrame frame, double fromUt, double toUt) => false;
        }

        /// <summary>A provider that answers from a given state, recording the setting it was asked with.</summary>
        private sealed class AnsweringProvider : KeplerProvider, IPropagationFromState
        {
            public List<PropagationCertification> Asked { get; } = new List<PropagationCertification>();

            PropagatedPath IPropagationFromState.PropagateFromState(
                PropagationSeed seed, double toUt, int maxPoints, PropagationCertification certification)
            {
                Asked.Add(certification);
                return new PropagatedPath { Solved = true, Kind = TrajectoryKind.Integrated, ReachedUt = toUt };
            }
        }

        [Fact]
        public void OnlyUnboundedAcceptsTheAnalyticAnswer()
        {
            Assert.True(ChannelEngine.AcceptsAnalytic(PropagationCertification.Unbounded));
            Assert.False(ChannelEngine.AcceptsAnalytic(PropagationCertification.Unspecified));
            Assert.False(ChannelEngine.AcceptsAnalytic(PropagationCertification.CertifiedOnly));
            Assert.False(ChannelEngine.AcceptsAnalytic((PropagationCertification)7));
        }

        [Fact]
        public void AProviderThatAnswersFromAStateIsAskedForTheAccurateAnswerUnlessUnboundedIsNamed()
        {
            var provider = new AnsweringProvider();

            var path = ChannelEngine.FromState(provider, false, Seed, 200.0, 4, PropagationCertification.Unspecified);
            ChannelEngine.FromState(provider, false, Seed, 200.0, 4, PropagationCertification.Unbounded);

            Assert.Equal(TrajectoryKind.Integrated, path.Kind);
            Assert.Equal(
                new[] { PropagationCertification.CertifiedOnly, PropagationCertification.Unbounded },
                provider.Asked);
        }

        [Fact]
        public void WithTheTwoBodySolverElectedEitherAskIsAnsweredByIt()
        {
            var accurate = ChannelEngine.FromState(new KeplerProvider(), false, Seed, 200.0, 4, PropagationCertification.Unspecified);

            Assert.True(accurate.Solved, accurate.Refusal);
            Assert.Equal(TrajectoryKind.Analytic, accurate.Kind);
        }

        [Fact]
        public void AClosedFormProviderWithoutTheInterfaceGetsTheTwoBodyAnswerEitherWay()
        {
            var accurate = ChannelEngine.FromState(new OlderIntegratingProvider(), false, Seed, 200.0, 4, PropagationCertification.Unspecified);

            Assert.True(accurate.Solved, accurate.Refusal);
            Assert.Equal(TrajectoryKind.Analytic, accurate.Kind);
        }

        [Fact]
        public void AnOlderIntegratingProviderGetsAnAccurateAskRefusedAndAnAnalyticOneAnsweredInTwoBody()
        {
            var older = new OlderIntegratingProvider();

            var accurate = ChannelEngine.FromState(older, true, Seed, 200.0, 4, PropagationCertification.Unspecified);
            var analytic = ChannelEngine.FromState(older, true, Seed, 200.0, 4, PropagationCertification.Unbounded);

            Assert.False(accurate.Solved);
            Assert.False(string.IsNullOrEmpty(accurate.Refusal));
            Assert.True(analytic.Solved, analytic.Refusal);
            Assert.Equal(TrajectoryKind.Analytic, analytic.Kind);
        }
    }
}

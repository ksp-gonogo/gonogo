using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Reach as a DECLARED property of the elected comms backend, the sibling of
    /// <see cref="CommsOcclusionTests"/> and the other half of the same wall.
    ///
    /// <para>The thing under test is a disagreement core cannot resolve. Stock
    /// gates a link on antenna power against a range curve; RealAntennas gates
    /// on whether a budget closes in dB, AND zeroes the power fields stock's
    /// rule reads. So core applying stock's rule on an RA install does not get a
    /// slightly wrong number, it gets zero for every craft in the game: a
    /// permanent blackout that looks exactly like a real one. Whoever is
    /// elected, the consumer reads one shape and never branches on which mod is
    /// installed.</para>
    ///
    /// <para>The REPLICATION these tests carry is the second one below: before
    /// reach reached the seam there was no reach question at all, so
    /// <c>Sitrep.Propagation.Visibility</c> modelled geometry and nothing else
    /// and every contact prediction promised reacquisition on line of sight
    /// alone. That is core answering a question only the backend can answer, by
    /// not asking it.</para>
    /// </summary>
    public class CommsReachSeamTests
    {
        private const string VanillaBackendId = "commnet";

        /// <summary>
        /// The higher-priority provider, deliberately named for its ROLE rather
        /// than for any shipped mod: what this file tests is that election
        /// precedence decides whose reach rule a consumer reads, and binding a
        /// core test to one mod's provider id would make it about that mod.
        /// </summary>
        private const string HigherPriorityBackendId = "test-higher-priority";

        private sealed class StubBackend : ICommsBackend
        {

        public bool? StillCarriesTo(string nodeId) => null;
            private readonly Func<object?, object?, ICommsReachModel> _reach;

            public StubBackend(string id, Func<object?, object?, ICommsReachModel> reach)
            {
                ProviderId = id;
                _reach = reach;
            }

            public string ProviderId { get; }
            public CommsConnectivity Connectivity() => new CommsConnectivity();
            public CommsSignalStrength SignalStrength() => new CommsSignalStrength();
            public CommsControlState ControlState() => new CommsControlState();
            public CommsPath Path() => new CommsPath();
            public CommsNetwork Network() => new CommsNetwork();
            public IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to) => null;
            public ICommsReachModel ReachModel(object? from, object? to) => _reach(from, to);
            public object? ControlPathTerminus() => null;
            /// <summary>Nothing here occludes: this stub exists for the reach read.</summary>
            public ICommsOcclusionModel OcclusionModel() => CommsOcclusionModels.Unknown;

            public ICommsDegradeModel DegradeModel() => CommsDegradeModels.Unknown;
        }

        private static Kernel ResolvedKernel(
            Func<object?, object?, ICommsReachModel> vanilla,
            Func<object?, object?, ICommsReachModel>? higherPriority = null)
        {
            var kernel = new Kernel();
            CommsElection.RegisterCapability(kernel, _ => new StubBackend(VanillaBackendId, vanilla));
            if (higherPriority != null)
            {
                kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = CommsElection.CapabilityId,
                    Id = HigherPriorityBackendId,
                    Priority = 100.0,
                    Factory = _ => new StubBackend(HigherPriorityBackendId, higherPriority),
                });
            }
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        private static ICommsReachModel Fixed(string id, double? max) =>
            new MaxRangeReachModel(id, id, max);

        /// <summary>
        /// The elected backend answers, not the fallback and not core. With the
        /// higher-priority provider registered its rule is the one a consumer
        /// reads, even though the vanilla one is still perfectly able to answer.
        /// </summary>
        [Fact]
        public void TheELECTEDBackendsRuleIsTheOneAConsumerReads()
        {
            var stockOnly = CommsElection.ReachModel(
                ResolvedKernel((_, _) => Fixed("commnet-range-curve", 1e9)), new object(), new object());
            Assert.Equal("commnet-range-curve", stockOnly.ModelId);
            Assert.Equal(1e9, stockOnly.MaxRangeMeters);

            // The case that makes this a seam question at all: a
            // network-replacing backend whose own rule says 40 Gm, over a
            // vanilla rule that would answer ZERO for the same pair because the
            // replacing mod zeroes the antenna power fields vanilla reads. The
            // elected backend's answer replaces it entirely rather than being
            // reconciled with it.
            var replacementElected = CommsElection.ReachModel(
                ResolvedKernel(
                    (_, _) => Fixed("commnet-range-curve", 0.0),
                    (_, _) => Fixed("budget-closes-in-db", 4e10)),
                new object(),
                new object());
            Assert.Equal("budget-closes-in-db", replacementElected.ModelId);
            Assert.Equal(4e10, replacementElected.MaxRangeMeters);
        }

        /// <summary>
        /// The replication, stated as the property that was missing. A consumer
        /// asking the seam gets a rule whose id says whether anybody actually
        /// answered, so a prediction built on geometry alone is DECLARED rather
        /// than assumed. Before this method existed there was nothing to ask and
        /// no way to tell the two apart.
        /// </summary>
        [Fact]
        public void ARuleNobodyDeclaredIsAbsentAndSaysSo()
        {
            var noKernel = CommsElection.ReachModel(null, new object(), new object());

            Assert.Equal(CommsReachModels.UnknownModelId, noKernel.ModelId);
            Assert.Null(noKernel.MaxRangeMeters);
            Assert.Null(CommsReachModels.Reaches(noKernel, 1.0));
        }

        /// <summary>
        /// A backend whose declaration throws must not take the prediction with
        /// it, and must not be read as "nothing reaches" either: the fallback is
        /// ABSENT, so a consumer keeps predicting what it could before rather
        /// than blacking out on a failed read.
        /// </summary>
        [Fact]
        public void AThrowingBackendFallsBackToAbsentRatherThanZero()
        {
            var model = CommsElection.ReachModel(
                ResolvedKernel((_, _) => throw new InvalidOperationException("reflection moved")),
                new object(),
                new object());

            Assert.Equal(CommsReachModels.UnknownModelId, model.ModelId);
            Assert.Null(model.MaxRangeMeters);
        }

        /// <summary>
        /// The pair is what is asked about, not the install. Two different
        /// station handles get two different answers from one backend, which is
        /// what RSS/RealAntennas' dozen non-identical ground stations require.
        /// </summary>
        [Fact]
        public void ReachIsAskedPerPairRatherThanPerInstall()
        {
            var near = new object();
            var far = new object();
            var kernel = ResolvedKernel((_, to) =>
                Fixed("commnet-range-curve", ReferenceEquals(to, near) ? 1e6 : 1e12));

            Assert.Equal(1e6, CommsElection.ReachModel(kernel, new object(), near).MaxRangeMeters);
            Assert.Equal(1e12, CommsElection.ReachModel(kernel, new object(), far).MaxRangeMeters);
        }

        [Fact]
        public void AbsentAndZeroAreDifferentAnswers()
        {
            var absent = Fixed("x", null);
            var nothing = Fixed("x", 0.0);

            Assert.Null(CommsReachModels.Reaches(absent, 1.0));
            Assert.False(CommsReachModels.Reaches(nothing, 1.0));

            // And zero still admits the boundary, which is the one distance a
            // maximum of zero does carry.
            Assert.True(CommsReachModels.Reaches(nothing, 0.0));
        }

        /// <summary>
        /// Reaching AT the maximum counts as reaching, matching stock's own
        /// <c>InRange</c> and the sign convention the sweep's margin uses. Two
        /// copies of this comparison that disagreed by one <c>=</c> would put a
        /// refiner on the other side of the limit from the sweep that bracketed
        /// it, which is the reason it lives in one place.
        /// </summary>
        [Fact]
        public void TheBoundaryCountsAsReaching()
        {
            var model = Fixed("x", 1000.0);

            Assert.True(CommsReachModels.Reaches(model, 999.9));
            Assert.True(CommsReachModels.Reaches(model, 1000.0));
            Assert.False(CommsReachModels.Reaches(model, 1000.1));
        }

        /// <summary>
        /// A non-finite maximum is a failed resolve, not a measurement. An
        /// infinity in particular would pass every distance and read as "reaches
        /// everywhere", which is the over-promise in a different costume.
        /// </summary>
        [Theory]
        [InlineData(double.NaN)]
        [InlineData(double.PositiveInfinity)]
        [InlineData(double.NegativeInfinity)]
        public void ANonFiniteMaximumBecomesAbsent(double max)
        {
            Assert.Null(new MaxRangeReachModel("x", "x", max).MaxRangeMeters);
        }

        /// <summary>A negative maximum clamps to zero, which is what it means.</summary>
        [Fact]
        public void ANegativeMaximumClampsToNothingReaching()
        {
            Assert.Equal(0.0, new MaxRangeReachModel("x", "x", -5.0).MaxRangeMeters);
        }
    }
}

using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Contract.Tests
{
    /// <summary>
    /// The discriminator the drop event rests on: telling a relay that was
    /// REPLACED from one that STOPPED CARRYING.
    ///
    /// <para>Both look identical in <see cref="ICommsBackend.Path"/>: a
    /// different list of hops. Only the first should let the in-flight tail
    /// arrive, and getting it wrong in either direction is a real cost. Say a
    /// live reroute is a break and telemetry that physically landed is deleted;
    /// say a destruction is a reroute and the model goes on delivering samples
    /// that could not have arrived.</para>
    ///
    /// <para>Tested here rather than against either shipped backend because
    /// neither overrides it or <see cref="ICommsBackend.Path"/>: both answer the
    /// question with this same code, so a test against one of them would be a
    /// test of <see cref="CommsBackendBase"/> wearing a costume.</para>
    /// </summary>
    public class StillCarriesToTests
    {
        /// <summary>The craft most tests fly, standing in for any vessel handle.</summary>
        private static readonly object Craft = new object();

        /// <summary>
        /// A backend whose whole world is the control path each vessel is handed
        /// and a router that will route to anything not named as unreachable.
        /// </summary>
        private sealed class FakeBackend : CommsBackendBase
        {
            private readonly Dictionary<object, IReadOnlyList<CommsLinkView>> _paths =
                new Dictionary<object, IReadOnlyList<CommsLinkView>>();
            private readonly HashSet<object> _unreachable = new HashSet<object>();

            public readonly List<object?> Routed = new List<object?>();
            public readonly List<object?> RoutedFrom = new List<object?>();

            public override string ProviderId => "fake";

            /// <summary>One tick of <see cref="Craft"/> on this route.</summary>
            public void Fly(params string[] nodeIds) => Fly(Craft, "craft", nodeIds);

            /// <summary>One tick of <paramref name="vessel"/>, whose own node is <paramref name="origin"/>, on this route. Reads <c>Path</c> at the end because the production tick does, and that read is what retains the node handles.</summary>
            public void Fly(object vessel, string origin, params string[] nodeIds)
            {
                var links = new List<CommsLinkView>();
                var from = Node(origin);
                foreach (var id in nodeIds)
                {
                    var to = Node(id);
                    links.Add(new CommsLinkView(from, to));
                    from = to;
                }
                _paths[vessel] = links;
                Path(vessel);
            }

            /// <summary>One tick of <see cref="Craft"/> with no route home at all.</summary>
            public void GoDark() => GoDark(Craft);

            /// <summary>One tick of <paramref name="vessel"/> with no route home at all.</summary>
            public void GoDark(object vessel)
            {
                _paths[vessel] = new List<CommsLinkView>();
                Path(vessel);
            }

            /// <summary>The handle behind a node id, for asserting which end the router was asked from.</summary>
            public object HandleOf(string id) => Handle(id);

            /// <summary>A handle the router will refuse, which is what a destroyed relay looks like from here.</summary>
            public void Strand(string nodeId) => _unreachable.Add(Handle(nodeId));

            public override IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to)
            {
                Routed.Add(to);
                RoutedFrom.Add(from);
                if (to == null || _unreachable.Contains(to))
                {
                    return null;
                }
                return new List<CommsRouteHop>();
            }

            public override ICommsReachModel ReachModel(object? from, object? to) => CommsReachModels.Unknown;

            public override ICommsOcclusionModel OcclusionModel() => CommsOcclusionModels.Unknown;

            public override ICommsDegradeModel DegradeModel() => CommsDegradeModels.Unknown;

            protected override CommsSubject Subject() => new CommsSubject("craft", true);

            protected override CommsLinkState? LinkState() =>
                new CommsLinkState(true, CommsControlGrade.Full, 1.0);

            protected override IReadOnlyList<CommsLinkView>? ControlPath(object? vessel) =>
                vessel != null && _paths.TryGetValue(vessel, out var path) ? path : null;

            // One handle per id, so reference identity is stable across ticks
            // the way a live node's is.
            private readonly Dictionary<string, object> _handles = new Dictionary<string, object>();

            private object Handle(string id)
            {
                if (!_handles.TryGetValue(id, out var handle))
                {
                    handle = new object();
                    _handles[id] = handle;
                }
                return handle;
            }

            private CommsNodeView Node(string id) =>
                new CommsNodeView(Handle(id), id, id, id == "home", false, default);
        }

        [Fact]
        public void ANodeOnTheRouteRightNowIsCarrying()
        {
            var backend = new FakeBackend();
            backend.Fly("relay-a", "home");

            Assert.True(backend.StillCarriesTo(Craft, "relay-a"));

            // Demonstrated rather than inferred: the router was never consulted.
            Assert.Empty(backend.Routed);
        }

        [Fact]
        public void ANodeTheRouteLeftButTheRouterStillReachesIsCarrying()
        {
            var backend = new FakeBackend();
            backend.Fly("relay-a", "home");
            backend.Fly("relay-b", "home");

            Assert.True(backend.StillCarriesTo(Craft, "relay-a"));
        }

        [Fact]
        public void ANodeTheRouterWillNotRouteToIsNotCarrying()
        {
            var backend = new FakeBackend();
            backend.Fly("relay-a", "home");
            backend.Strand("relay-a");
            backend.Fly("relay-b", "home");

            Assert.False(backend.StillCarriesTo(Craft, "relay-a"));
        }

        /// <summary>
        /// With no route home at all there is nothing to compare against, and
        /// the question still has to be answerable: this is the destroyed-relay
        /// case, and the subject handle retained from the last route it had is
        /// what makes it so.
        /// </summary>
        [Fact]
        public void ANodeIsStillAnswerableAfterTheRouteHomeIsGone()
        {
            var backend = new FakeBackend();
            backend.Fly("relay-a", "home");
            backend.Strand("relay-a");
            backend.GoDark();

            Assert.False(backend.StillCarriesTo(Craft, "relay-a"));
        }

        /// <summary>
        /// A node this backend has never routed through gets no opinion, not a
        /// break. The caller must treat that as "still carrying", so answering
        /// false here would invent losses out of an empty memory.
        /// </summary>
        [Fact]
        public void ANodeNeverSeenOnARouteGetsNoOpinion()
        {
            var backend = new FakeBackend();
            backend.Fly("relay-a", "home");

            Assert.Null(backend.StillCarriesTo(Craft, "relay-zzz"));
            Assert.Null(backend.StillCarriesTo(Craft, ""));
        }

        /// <summary>
        /// The craft's own node is always carrying. The router answers null for
        /// the same node at both ends, and taken at face value that reads as a
        /// break at zero light-seconds out, which dooms every sample the craft
        /// has ever sent.
        /// </summary>
        [Fact]
        public void TheCraftsOwnNodeIsNeverABreak()
        {
            var backend = new FakeBackend();
            backend.Fly("relay-a", "home");
            backend.GoDark();

            Assert.True(backend.StillCarriesTo(Craft, "craft"));
        }

        /// <summary>
        /// One vessel's route answers for that vessel only. Two craft, two
        /// relays: the one that lost its relay gets the verdict, and the other,
        /// which never routed through it, has no opinion rather than inheriting
        /// the first craft's memory.
        /// </summary>
        [Fact]
        public void OneVesselsRouteNeverAnswersForAnother()
        {
            var backend = new FakeBackend();
            var other = new object();
            backend.Fly(Craft, "craft", "relay-a", "home");
            backend.Fly(other, "probe", "relay-b", "home");
            backend.Strand("relay-a");
            backend.Fly(Craft, "craft", "relay-c", "home");

            Assert.False(backend.StillCarriesTo(Craft, "relay-a"));
            Assert.Null(backend.StillCarriesTo(other, "relay-a"));
            Assert.True(backend.StillCarriesTo(other, "relay-b"));
        }

        /// <summary>
        /// A craft that is not the one on screen is asked about from its own
        /// node, and stays answerable after its own route home has gone.
        /// </summary>
        [Fact]
        public void ABackgroundVesselIsAskedFromItsOwnNodeAfterItsRouteIsGone()
        {
            var backend = new FakeBackend();
            var probe = new object();
            backend.Fly(Craft, "craft", "relay-a", "home");
            backend.Fly(probe, "probe", "relay-b", "home");
            backend.Strand("relay-b");
            backend.GoDark(probe);

            Assert.False(backend.StillCarriesTo(probe, "relay-b"));
            Assert.Same(backend.HandleOf("probe"), Assert.Single(backend.RoutedFrom));
        }

        /// <summary>
        /// A null vessel has no route, so there is nothing it could have lost.
        /// </summary>
        [Fact]
        public void ANullVesselGetsNoOpinion()
        {
            var backend = new FakeBackend();
            backend.Fly("relay-a", "home");

            Assert.Null(backend.StillCarriesTo(null, "relay-a"));
        }
    }
}

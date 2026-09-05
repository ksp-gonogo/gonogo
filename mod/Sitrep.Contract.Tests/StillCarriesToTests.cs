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
        /// <summary>
        /// A backend whose whole world is the control path it is handed and a
        /// router that will route to anything not named as unreachable.
        /// </summary>
        private sealed class FakeBackend : CommsBackendBase
        {
            private IReadOnlyList<CommsLinkView>? _path;
            private readonly HashSet<object> _unreachable = new HashSet<object>();

            public readonly List<object?> Routed = new List<object?>();

            public override string ProviderId => "fake";

            /// <summary>One tick on this route. Reads <c>Path()</c> at the end because the production tick does, and that read is what retains the node handles.</summary>
            public void Fly(params string[] nodeIds)
            {
                var links = new List<CommsLinkView>();
                var from = Node("craft");
                foreach (var id in nodeIds)
                {
                    var to = Node(id);
                    links.Add(new CommsLinkView(from, to));
                    from = to;
                }
                _path = links;
                Path();
            }

            /// <summary>One tick with no route home at all.</summary>
            public void GoDark()
            {
                _path = new List<CommsLinkView>();
                Path();
            }

            /// <summary>A handle the router will refuse, which is what a destroyed relay looks like from here.</summary>
            public void Strand(string nodeId) => _unreachable.Add(Handle(nodeId));

            public override IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to)
            {
                Routed.Add(to);
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

            protected override IReadOnlyList<CommsLinkView>? ControlPath() => _path;

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

            Assert.True(backend.StillCarriesTo("relay-a"));

            // Demonstrated rather than inferred: the router was never consulted.
            Assert.Empty(backend.Routed);
        }

        [Fact]
        public void ANodeTheRouteLeftButTheRouterStillReachesIsCarrying()
        {
            var backend = new FakeBackend();
            backend.Fly("relay-a", "home");
            backend.Fly("relay-b", "home");

            Assert.True(backend.StillCarriesTo("relay-a"));
        }

        [Fact]
        public void ANodeTheRouterWillNotRouteToIsNotCarrying()
        {
            var backend = new FakeBackend();
            backend.Fly("relay-a", "home");
            backend.Strand("relay-a");
            backend.Fly("relay-b", "home");

            Assert.False(backend.StillCarriesTo("relay-a"));
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

            Assert.False(backend.StillCarriesTo("relay-a"));
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

            Assert.Null(backend.StillCarriesTo("relay-zzz"));
            Assert.Null(backend.StillCarriesTo(""));
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

            Assert.True(backend.StillCarriesTo("craft"));
        }
    }
}

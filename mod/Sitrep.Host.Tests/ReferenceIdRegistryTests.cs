using System.Collections.Generic;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless coverage for <see cref="ReferenceIdRegistry{T}"/> — the M3 R3
    /// maneuver-node-id determinism the capture-add report calls out. Uses a
    /// plain reference-type stand-in (not the real KSP <c>ManeuverNode</c>,
    /// which only <c>Gonogo.KSP</c> can reference) since this class is
    /// generic and genuinely KSP-free — see its own doc comment.
    /// </summary>
    public class ReferenceIdRegistryTests
    {
        private sealed class Node
        {
            public double Ut;
        }

        [Fact]
        public void GetOrAssignReturnsTheSameIdForTheSameInstanceEveryTime()
        {
            var registry = new ReferenceIdRegistry<Node>();
            var node = new Node { Ut = 100.0 };

            var first = registry.GetOrAssign(node);
            var second = registry.GetOrAssign(node);

            Assert.Equal(first, second);
        }

        [Fact]
        public void GetOrAssignReturnsADifferentIdForADifferentInstanceEvenWithIdenticalFieldValues()
        {
            // The whole reason this is reference-keyed rather than derived
            // from Ut/ordinal: two distinct nodes that happen to carry the
            // same Ut must still be told apart.
            var registry = new ReferenceIdRegistry<Node>();
            var a = new Node { Ut = 100.0 };
            var b = new Node { Ut = 100.0 };

            Assert.NotEqual(registry.GetOrAssign(a), registry.GetOrAssign(b));
        }

        [Fact]
        public void IdSurvivesAMutationOfTheInstanceEgAnUpdateChangingUt()
        {
            // Mirrors vessel.maneuver.update dragging a node's Ut -- the id
            // must not change just because a field on the same live object
            // did (a derived UT+ordinal key would break exactly this case).
            var registry = new ReferenceIdRegistry<Node>();
            var node = new Node { Ut = 100.0 };
            var idBefore = registry.GetOrAssign(node);

            node.Ut = 250.0;
            var idAfter = registry.GetOrAssign(node);

            Assert.Equal(idBefore, idAfter);
        }

        [Fact]
        public void TryResolveFindsTheInstanceAmongCandidatesMatchingTheAssignedId()
        {
            var registry = new ReferenceIdRegistry<Node>();
            var a = new Node { Ut = 100.0 };
            var b = new Node { Ut = 200.0 };
            var idOfB = registry.GetOrAssign(b);
            registry.GetOrAssign(a);

            var resolved = registry.TryResolve(idOfB, new[] { a, b }, out var node);

            Assert.True(resolved);
            Assert.Same(b, node);
        }

        [Fact]
        public void TryResolveReturnsFalseWhenNoCandidateCarriesTheGivenId()
        {
            var registry = new ReferenceIdRegistry<Node>();
            var a = new Node { Ut = 100.0 };
            registry.GetOrAssign(a);

            var resolved = registry.TryResolve("some-unknown-id", new[] { a }, out var node);

            Assert.False(resolved);
            Assert.Null(node);
        }

        [Fact]
        public void TryResolveReturnsFalseForACandidateTheRegistryHasNeverSeen()
        {
            // A node created after the last read-side sample has no entry
            // yet -- must fail cleanly, not throw or false-match.
            var registry = new ReferenceIdRegistry<Node>();
            var neverSeen = new Node { Ut = 999.0 };

            var resolved = registry.TryResolve("anything", new[] { neverSeen }, out var node);

            Assert.False(resolved);
            Assert.Null(node);
        }

        [Fact]
        public void TryResolveHandlesAnEmptyCandidateListWithoutThrowing()
        {
            var registry = new ReferenceIdRegistry<Node>();

            var resolved = registry.TryResolve("anything", new List<Node>(), out var node);

            Assert.False(resolved);
            Assert.Null(node);
        }
    }
}

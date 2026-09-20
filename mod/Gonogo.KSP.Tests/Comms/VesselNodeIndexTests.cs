using System.Collections.Generic;
using CommNet;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// That a pass can name a node by reference, and says so honestly when it
    /// cannot.
    ///
    /// <para>The index exists so naming a node costs a dictionary probe rather
    /// than a walk over every vessel, which is what kept break-detection to the
    /// active vessel's route. What matters here is the identity rule: a node is
    /// matched by BEING the same object. Two nodes that compare equal on their
    /// fields are still different nodes, and a route solved over one of them
    /// must not be named after the other.</para>
    ///
    /// <para>The vessel-walking half is exercised through the degenerate shapes
    /// only, because building a real <c>Vessel</c> needs a running game. The
    /// identity cases go through <c>VesselNodeIndex.ForNodes</c> rather than a
    /// dictionary built here, so they run against the index's OWN comparer: a
    /// test that supplied its own would be asserting that its own helper
    /// distinguishes two references, which is true of any correct comparer and
    /// says nothing about the one production uses.</para>
    /// </summary>
    public class VesselNodeIndexTests
    {
        private static VesselNodeIndex IndexOf(params (CommNode Node, string Id)[] entries) =>
            VesselNodeIndex.ForNodes(entries);

        [Fact]
        public void NamesANodeItWasBuiltWith()
        {
            var node = new CommNode();

            Assert.True(IndexOf((node, "vessel-1")).TryId(node, out var id));
            Assert.Equal("vessel-1", id);
        }

        /// <summary>
        /// The identity rule, and the reason the index carries its own
        /// comparer: these two nodes are field-identical and must still not be
        /// confused for one another.
        /// </summary>
        [Fact]
        public void DoesNotNameADifferentNodeWithTheSameFields()
        {
            var indexed = new CommNode { precisePosition = new Vector3d(1, 2, 3) };
            var lookalike = new CommNode { precisePosition = new Vector3d(1, 2, 3) };

            var index = IndexOf((indexed, "vessel-1"));

            Assert.True(index.TryId(indexed, out _));
            Assert.False(index.TryId(lookalike, out var id));
            Assert.Equal("", id);
        }

        /// <summary>
        /// A ground station's node belongs to no vessel, so a miss is an
        /// ordinary answer rather than a failure, and it must be distinguishable
        /// from a vessel that somehow reported a blank id.
        /// </summary>
        [Fact]
        public void ReportsAMissRatherThanABlankId()
        {
            Assert.False(IndexOf().TryId(new CommNode(), out var id));
            Assert.Equal("", id);
        }

        [Fact]
        public void TreatsANullNodeAsAMiss()
        {
            Assert.False(IndexOf((new CommNode(), "vessel-1")).TryId(null, out _));
        }

        /// <summary>
        /// The shapes a torn-down or not-yet-started game hands over. Each
        /// contributes nothing instead of throwing, because this runs inside a
        /// capture pass that must not take the mod down with it.
        /// </summary>
        [Fact]
        public void SurvivesTheDegenerateVesselLists()
        {
            Assert.Equal(0, VesselNodeIndex.From(null).Count);
            Assert.Equal(0, VesselNodeIndex.From(new Vessel?[0]).Count);
            Assert.Equal(0, VesselNodeIndex.From(new Vessel?[] { null, null }).Count);
        }
    }
}

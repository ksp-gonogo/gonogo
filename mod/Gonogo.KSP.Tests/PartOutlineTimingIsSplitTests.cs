using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The sample timing line splits a part's outline into the variant lookup, the
    /// renderer search, the walk over them (with the carry into the part's frame
    /// inside it) and the assembly, and counts the renderers and the pieces measured
    /// afresh, so a rig take says which of them a part tree's cost is.
    ///
    /// <para>Source text, not behaviour: the measure reads live Unity objects and cannot
    /// be compiled into this project.</para>
    /// </summary>
    public class PartOutlineTimingIsSplitTests
    {
        private static readonly string Source = CurrencyDelaySourceText.ReadRelative("PartMeshBounds.cs");

        [Theory]
        [InlineData("SampleTiming.Part(\"topo.mesh.variant\")")]
        [InlineData("SampleTiming.Part(\"topo.mesh.renderers\")")]
        [InlineData("SampleTiming.Part(\"topo.mesh.walk\")")]
        [InlineData("SampleTiming.Add(\"topo.mesh.carry\", carryTicks)")]
        [InlineData("SampleTiming.Part(\"topo.mesh.assemble\")")]
        [InlineData("SampleTiming.Count(\"topo.mesh.renderers\", renderers.Length)")]
        [InlineData("SampleTiming.Count(\"topo.mesh.measured\", Pieces.Measured - measuredBefore)")]
        public void each_part_of_the_outline_is_timed_or_counted(string call)
        {
            Assert.Contains(call, Source, StringComparison.Ordinal);
        }
    }
}

using System.Linq;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// After an unlock the game's node list repeats the whole tree; the walk must still
    /// report each tech once, or the R&amp;D widget lists every node twice.
    /// </summary>
    public class TechTreeWalkTests
    {
        [Fact]
        public void a_node_list_repeated_after_an_unlock_keeps_its_node_count()
        {
            var tree = new[] { "start", "basicRocketry", "engineering101" };
            var afterUnlock = tree.Concat(tree).ToArray();

            var walked = TechTreeWalk.DistinctByTechId(afterUnlock, id => id).ToArray();

            Assert.Equal(tree, walked);
        }

        [Fact]
        public void nodes_without_an_id_are_dropped()
        {
            var walked = TechTreeWalk.DistinctByTechId(new string?[] { "start", null, "" }, id => id).ToArray();

            Assert.Equal(new[] { "start" }, walked);
        }
    }
}

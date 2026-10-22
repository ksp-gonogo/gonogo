using System.Linq;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class CraftFileTreeTests
    {
        [Fact]
        public void AParentIsWhicheverPartLinksToAKey()
        {
            var keys = new[] { "pod_1", "tank_2", "engine_3", "fin_4" };
            var links = new[]
            {
                new[] { "tank_2" },
                new[] { "engine_3", "fin_4" },
                new string[0],
                new string[0],
            };

            Assert.Equal(new[] { -1, 0, 1, 1 }, CraftFileTree.ParentIndices(keys, links));
        }

        [Fact]
        public void APartNothingLinksToHasNoParent()
        {
            var keys = new[] { "pod_1", "floating_9" };
            var links = new[] { new string[0], new string[0] };

            Assert.Equal(new[] { -1, -1 }, CraftFileTree.ParentIndices(keys, links));
        }

        [Fact]
        public void AnUnknownLinkAndASelfLinkAreIgnored()
        {
            var keys = new[] { "pod_1", "tank_2" };
            var links = new[] { new[] { "pod_1", "missing_7", "tank_2" }, new string[0] };

            Assert.Equal(new[] { -1, 0 }, CraftFileTree.ParentIndices(keys, links));
        }

        [Fact]
        public void TheFirstPartToClaimAChildKeepsIt()
        {
            var keys = new[] { "a_1", "b_2", "c_3" };
            var links = new[] { new[] { "c_3" }, new[] { "c_3" }, new string[0] };

            Assert.Equal(new[] { -1, -1, 0 }, CraftFileTree.ParentIndices(keys, links));
        }

        [Theory]
        [InlineData("liquidEngine2.v2_4288729676", "liquidEngine2.v2")]
        [InlineData("my_modded_part_12", "my_modded_part")]
        [InlineData("noSuffix", "noSuffix")]
        [InlineData("trailing_", "trailing_")]
        [InlineData("word_notDigits", "word_notDigits")]
        [InlineData("", "")]
        public void ThePartNameIsTheKeyWithoutItsNumericSuffix(string key, string name)
        {
            Assert.Equal(name, CraftFileTree.PartName(key));
        }

        [Fact]
        public void AVectorReadsOnlyWhenItHasTheRightNumberOfFinitePlaces()
        {
            Assert.Equal(new[] { 0.5, -1.25, 3.0 }, CraftFileTree.ParseVector("0.5,-1.25,3", 3));
            Assert.Equal(new[] { 0.0, 0.0, 0.0, 1.0 }, CraftFileTree.ParseVector("0,0,0,1", 4));
            Assert.Equal(new[] { -1.78813934E-07, 6.98762846, -4.76837158E-07 }, CraftFileTree.ParseVector("-1.78813934E-07,6.98762846,-4.76837158E-07", 3));
            Assert.Null(CraftFileTree.ParseVector("0,0,0,1", 3));
            Assert.Null(CraftFileTree.ParseVector("0,x,0", 3));
            Assert.Null(CraftFileTree.ParseVector("0,NaN,0", 3));
            Assert.Null(CraftFileTree.ParseVector("", 3));
            Assert.Null(CraftFileTree.ParseVector(null, 3));
        }

        [Fact]
        public void APlanesFuselageRunsAlongTheRootsYAxisInTheRootFrame()
        {
            // The Seahawk's root cockpit is turned a quarter turn about x in the editor, where the plane's length runs along z.
            var root = new[] { 0.707106829, 0, 0, 0.707106829 };

            var nose = CraftFileTree.InRootFrame(root, 0, 0, 3);
            var wing = CraftFileTree.InRootFrame(root, 6, 0.2, 0);

            Assert.Equal(new[] { 0.0, 3.0, 0.0 }, nose.Select(v => System.Math.Round(v, 5)).ToArray());
            Assert.Equal(new[] { 6.0, 0.0, -0.2 }, wing.Select(v => System.Math.Round(v, 5)).ToArray());
        }

        [Fact]
        public void ARootWithNoTurnLeavesTheVectorAlone()
        {
            var turned = CraftFileTree.InRootFrame(new double[] { 0, 0, 0, 1 }, 1, 2, 3);

            Assert.Equal(new[] { 1.0, 2.0, 3.0 }, turned);
        }
    }
}

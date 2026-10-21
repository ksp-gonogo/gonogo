using System.Collections.Generic;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests
{
    public class PartBoxRulesTests
    {
        private static Dictionary<string, bool> Variant(params (string Name, bool Shown)[] listed)
        {
            var dict = new Dictionary<string, bool>();
            foreach (var (name, shown) in listed)
            {
                dict[name] = shown;
            }
            return dict;
        }

        /// <summary>One tube with three lengths, each a mesh the others hide.</summary>
        private static readonly Dictionary<string, bool> Long = Variant(("tubeLong", true), ("tubeMedium", false), ("tubeShort", false));
        private static readonly Dictionary<string, bool> Medium = Variant(("tubeLong", false), ("tubeMedium", true), ("tubeShort", false));

        [Fact]
        public void TheSelectedVariantHidesTheMeshesItSwitchesOff()
        {
            var hidden = VariantMeshRule.Hidden(Medium, new[] { Long }, _ => true);

            Assert.Contains("tubeLong", hidden);
            Assert.Contains("tubeShort", hidden);
            Assert.DoesNotContain("tubeMedium", hidden);
        }

        [Fact]
        public void TwoVariantsOfOnePartHideDifferentMeshes()
        {
            var long_ = VariantMeshRule.Hidden(Long, new[] { Medium }, _ => true);
            var medium = VariantMeshRule.Hidden(Medium, new[] { Long }, _ => true);

            Assert.NotEqual(long_, medium);
            Assert.DoesNotContain("tubeLong", long_);
            Assert.Contains("tubeLong", medium);
        }

        [Fact]
        public void AMeshOnlyAnotherVariantListsFollowsItsStateOnThePart()
        {
            var selected = Variant(("tubeMedium", true));
            var other = Variant(("collar", true));

            Assert.Contains("collar", VariantMeshRule.Hidden(selected, new[] { other }, name => name != "collar"));
            Assert.DoesNotContain("collar", VariantMeshRule.Hidden(selected, new[] { other }, _ => true));
        }

        [Fact]
        public void AMeshTheSelectedVariantShowsIsNeverHiddenByAnotherVariant()
        {
            var hidden = VariantMeshRule.Hidden(Variant(("tubeLong", true)), new[] { Medium }, _ => false);

            Assert.DoesNotContain("tubeLong", hidden);
        }

        [Theory]
        [InlineData(0, 0, 5, -1)]
        [InlineData(0, 3, 5, 3)]
        [InlineData(2, 2, 5, -1)]
        [InlineData(1, 0, 5, 0)]
        [InlineData(1, -1, 5, -1)]
        [InlineData(1, 9, 5, -1)]
        public void ASavedRootThatNamesItselfAsParentIsParentless(int index, int saved, int count, int expected)
        {
            Assert.Equal(expected, PartTreeRules.ParentIndex(index, saved, count));
        }
    }
}

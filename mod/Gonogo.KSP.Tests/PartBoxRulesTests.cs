using System;
using System.Linq;
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
        public void AParachuteCanopyIsLeftOutOfThePartBox()
        {
            var hidden = VariantMeshRule.WithCanopies(new HashSet<string> { "tubeLong" }, new string?[] { "canopy", null, "" });

            Assert.Contains("canopy", hidden!);
            Assert.Contains("tubeLong", hidden!);
            Assert.Equal(2, hidden!.Count);
        }

        private sealed class RealChuteBlock
        {
            public string? parachuteName;
            public string? capName;
        }

        [Fact]
        public void EveryRealChuteCanopyIsLeftOutOfThePartBoxButItsCapStays()
        {
            var blocks = new object?[]
            {
                new RealChuteBlock { parachuteName = "B_ParachuteLargeDrogueRotator", capName = "ChuteCap" },
                null,
                new RealChuteBlock { parachuteName = "canopy2", capName = "cap2" },
            };

            var hidden = VariantMeshRule.WithCanopies(
                null,
                VariantMeshRule.RealChuteCanopies(blocks, b => ((RealChuteBlock)b).parachuteName));

            Assert.Equal(new[] { "B_ParachuteLargeDrogueRotator", "canopy2" }, hidden!.OrderBy(n => n, StringComparer.Ordinal).ToArray());
            Assert.DoesNotContain("ChuteCap", hidden);
        }

        [Fact]
        public void ARealChutePartWithNoParachuteBlocksLeavesNothingOut()
        {
            Assert.Empty(VariantMeshRule.RealChuteCanopies(null, _ => "x"));
            Assert.Null(VariantMeshRule.WithCanopies(null, VariantMeshRule.RealChuteCanopies(new object[0], _ => "x")));
        }

        [Fact]
        public void APartWithNoCanopyAndNoHiddenMeshesStaysUnrestricted()
        {
            Assert.Null(VariantMeshRule.WithCanopies(null, new string?[] { null }));
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

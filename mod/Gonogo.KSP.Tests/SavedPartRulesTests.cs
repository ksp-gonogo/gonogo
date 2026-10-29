using System.Collections.Generic;
using Sitrep.Host;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>A part read from a saved craft or an unloaded vessel is drawn in the variant and with the structures a loaded one has.</summary>
    public class SavedPartRulesTests
    {
        /* The AE-FF1's first interstage truss: shown while any of its nodes holds a part. */
        private const string Truss1Nodes = "interstage01a,interstage01b,interstage02a,interstage02b,interstage03a,interstage03b,interstage04a,interstage04b,interstage05a,interstage05b,interstage06a,interstage06b";

        /* The stock ComSat Lx's fairing, as its craft file saves it: held by its top and bottom nodes, every interstage node free. */
        private static readonly string[] ComSatFairingAttN =
        {
            "top,Decoupler.0_4291783810_0|0.22|0",
            "bottom,fuelTankSmall_4291736480_0|-0.2|0",
        };

        [Fact]
        public void AFairingWithNothingOnItsInterstageNodesHidesItsTruss()
        {
            var attached = SavedPartRules.AttachedFromCraftFile(ComSatFairingAttN);

            Assert.False(SavedPartRules.StructureShown(true, false, false, false, Truss1Nodes, attached));
            Assert.False(SavedPartRules.StructureShown(true, false, false, false, "interstage06a,interstage06b", attached));
        }

        [Fact]
        public void AStructureShowsOnceANodeItWatchesHoldsAPart()
        {
            var attached = SavedPartRules.AttachedFromCraftFile(new[] { "interstage03b,fuelTank_1_0|1.2|0" });

            Assert.True(SavedPartRules.StructureShown(true, false, false, false, Truss1Nodes, attached));
            Assert.False(SavedPartRules.StructureShown(true, false, false, false, "interstage06a,interstage06b", attached));
        }

        [Fact]
        public void VisibilitySwitchedOffHidesItWhateverIsAttached()
        {
            var attached = new HashSet<string> { "interstage01a" };

            Assert.False(SavedPartRules.StructureShown(false, false, false, false, Truss1Nodes, attached));
            Assert.False(SavedPartRules.StructureShown(false, false, false, true, Truss1Nodes, attached));
        }

        [Fact]
        public void ASpawnedByHandStructureFollowsItsSavedStateAndReverseFlipsIt()
        {
            var none = new HashSet<string>();

            Assert.True(SavedPartRules.StructureShown(true, true, true, false, "bottom", none));
            Assert.False(SavedPartRules.StructureShown(true, true, false, false, "bottom", none));
            Assert.True(SavedPartRules.StructureShown(true, false, false, true, "bottom", none));
        }

        [Fact]
        public void ANullAttachLineAttachesNothing()
        {
            Assert.Empty(SavedPartRules.AttachedFromCraftFile(new[] { "interstage01a,Null_0|0.7|0", "interstage01b,", "bottom" }));
        }

        [Fact]
        public void AnUnloadedPartsNodesAreAttachedWhereTheyNameAPart()
        {
            var attached = SavedPartRules.AttachedFromSnapshots(new[]
            {
                new KeyValuePair<string, int>("top", 3),
                new KeyValuePair<string, int>("interstage01a", -1),
            });

            Assert.Equal(new[] { "top" }, attached);
        }

        [Fact]
        public void ASavedFlagFallsBackToThePrefabsWhenTheSaveHasNone()
        {
            Assert.False(SavedPartRules.SavedFlag("False", true));
            Assert.True(SavedPartRules.SavedFlag(null, true));
            Assert.True(SavedPartRules.SavedFlag("maybe", true));
        }

        [Fact]
        public void ASavedPartWithNoVariantTakesThePrefabsAndKeysAsTheLivePartDoes()
        {
            var live = PartShapeWire.Key("fairingSize1", "White");
            var saved = PartShapeWire.Key("fairingSize1", SavedPartRules.VariantName(null, "White"));

            Assert.Equal("fairingSize1.White", live);
            Assert.Equal(live, saved);
            Assert.Equal("fairingSize1.Black", PartShapeWire.Key("fairingSize1", SavedPartRules.VariantName("Black", "White")));
            Assert.Equal("fuelTank", PartShapeWire.Key("fuelTank", SavedPartRules.VariantName(null, null)));
        }
    }
}

using System.Collections.Generic;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>A kerbal's sample and a flag's plaque are read from the save when the vessel is not loaded.</summary>
    public class SavedModuleReadsTests
    {
        private static SavedModule Module(string name, Dictionary<string, string>? values = null, params Dictionary<string, string>[] science) =>
            new SavedModule(name, values ?? new Dictionary<string, string>(), science);

        private static Dictionary<string, string> Sample(string id, string title, string data) =>
            new Dictionary<string, string> { ["subjectID"] = id, ["title"] = title, ["data"] = data };

        [Fact]
        public void ASampleSavedOnTheExperimentModuleIsHeld()
        {
            var held = SavedModuleReads.HeldData(new[]
            {
                Module("ModuleScienceExperiment", null, Sample("surfaceSample@MunSrfLandedMidlands", "Surface Sample from The Mun's Midlands", "30")),
            });

            var item = Assert.Single(held!);
            Assert.Equal("surfaceSample@MunSrfLandedMidlands", item.SubjectId);
            Assert.Equal("Surface Sample from The Mun's Midlands", item.Title);
            Assert.Equal(30.0, item.DataAmount);
        }

        [Fact]
        public void ResultsInAContainerAreHeldToo()
        {
            var held = SavedModuleReads.HeldData(new[]
            {
                Module("ModuleScienceContainer", null, Sample("crewReport@KerbinSrfLanded", "Crew Report", "5.5")),
            });

            Assert.Equal(5.5, Assert.Single(held!).DataAmount);
        }

        [Fact]
        public void AKerbalWithNoSavedResultHoldsAnEmptyList()
        {
            var held = SavedModuleReads.HeldData(new[] { Module("ModuleScienceExperiment"), Module("KerbalEVA") });

            Assert.NotNull(held);
            Assert.Empty(held!);
        }

        [Fact]
        public void NoSavedModulesIsNotKnowingRatherThanHoldingNothing()
        {
            Assert.Null(SavedModuleReads.HeldData(null));
        }

        [Fact]
        public void AnAmountThatDoesNotParseIsAbsentRatherThanZero()
        {
            var held = SavedModuleReads.HeldData(new[]
            {
                Module("ModuleScienceExperiment", null, Sample("a@b", "A", "not a number")),
            });

            Assert.Null(Assert.Single(held!).DataAmount);
        }

        [Fact]
        public void TheAmountIsReadWhateverTheMachinesCulture()
        {
            var previous = System.Threading.Thread.CurrentThread.CurrentCulture;
            System.Threading.Thread.CurrentThread.CurrentCulture = new System.Globalization.CultureInfo("de-DE");
            try
            {
                var held = SavedModuleReads.HeldData(new[]
                {
                    Module("ModuleScienceExperiment", null, Sample("a@b", "A", "12.5")),
                });

                Assert.Equal(12.5, Assert.Single(held!).DataAmount);
            }
            finally
            {
                System.Threading.Thread.CurrentThread.CurrentCulture = previous;
            }
        }

        [Fact]
        public void AFlagsPlanterAndPlaqueComeOffItsSavedModule()
        {
            var modules = new[]
            {
                Module("FlagSite", new Dictionary<string, string> { ["placedBy"] = "Maxwell Kerman", ["PlaqueText"] = "First on the Mun" }),
            };

            Assert.Equal("Maxwell Kerman", SavedModuleReads.FlagValue(modules, "placedBy"));
            Assert.Equal("First on the Mun", SavedModuleReads.FlagValue(modules, "PlaqueText"));
        }

        [Fact]
        public void AFlagWithNoSavedPlaqueTextHasNoPlaque()
        {
            var modules = new[] { Module("FlagSite", new Dictionary<string, string> { ["placedBy"] = "Maxwell Kerman" }) };

            Assert.Null(SavedModuleReads.FlagValue(modules, "PlaqueText"));
        }

        [Fact]
        public void AnEmptySavedPlaqueIsEmptyNotAbsent()
        {
            var modules = new[] { Module("FlagSite", new Dictionary<string, string> { ["PlaqueText"] = "" }) };

            Assert.Equal("", SavedModuleReads.FlagValue(modules, "PlaqueText"));
        }

        [Fact]
        public void AVesselWithNoFlagModuleSaysNothingAboutAPlanter()
        {
            Assert.Null(SavedModuleReads.FlagValue(new[] { Module("ModuleCommand") }, "placedBy"));
            Assert.Null(SavedModuleReads.FlagValue(null, "placedBy"));
        }
    }
}

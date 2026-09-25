using System;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.CompilerServices;
using KSP.Localization;
using Xunit;

namespace Gonogo.KSP.Tests.Localisation
{
    /// <summary>
    /// KSP's own <c>Localizer</c>, stood up with a hand-written table instead of
    /// the game's language files. The formatting that runs is the game's; only
    /// the table is ours.
    /// </summary>
    internal sealed class InstalledLocalizer : IDisposable
    {
        private static readonly PropertyInfo InstanceProperty =
            typeof(Localizer).GetProperty(nameof(Localizer.Instance), BindingFlags.Public | BindingFlags.Static)!;

        public InstalledLocalizer(Dictionary<string, string> tags)
        {
            var localizer = (Localizer)RuntimeHelpers.GetUninitializedObject(typeof(Localizer));
            typeof(Localizer)
                .GetField("tagValues", BindingFlags.NonPublic | BindingFlags.Instance)!
                .SetValue(localizer, tags);
            InstanceProperty.GetSetMethod(nonPublic: true)!.Invoke(null, new object?[] { localizer });
        }

        public void Dispose() => InstanceProperty.GetSetMethod(nonPublic: true)!.Invoke(null, new object?[] { null });
    }

    /// <summary>
    /// Installing a Localizer is process-wide, so nothing that reads one may run
    /// alongside these.
    /// </summary>
    [CollectionDefinition(nameof(InstalledLocalizerCollection), DisableParallelization = true)]
    public sealed class InstalledLocalizerCollection
    {
    }

    [Collection(nameof(InstalledLocalizerCollection))]
    public class GameNameTests
    {
        private const string StockCraftTag = "#autoLOC_8006417";

        private static Vessel CraftNamed(string name)
        {
            var vessel = (Vessel)RuntimeHelpers.GetUninitializedObject(typeof(Vessel));
            vessel.vesselName = name;
            return vessel;
        }

        [Fact]
        public void AStockCraftIsNamedAsThePlayerSeesItAndNotByItsTag()
        {
            using var _ = new InstalledLocalizer(new Dictionary<string, string> { [StockCraftTag] = "Kerbal X" });

            Assert.Equal("Kerbal X", GameWords.VesselName(CraftNamed(StockCraftTag)));
        }

        [Fact]
        public void APlayersOwnCraftNameIsLeftAsTheyTypedIt()
        {
            using var _ = new InstalledLocalizer(new Dictionary<string, string>());

            Assert.Equal("Muna 1", GameWords.VesselName(CraftNamed("Muna 1")));
        }

        [Fact]
        public void ATagTheTableCannotResolveFallsBackRatherThanReadingAsResolved()
        {
            using var _ = new InstalledLocalizer(new Dictionary<string, string>());

            Assert.Equal("fallback", GameWords.Name(StockCraftTag, "fallback"));
        }

        /// <summary>
        /// The pad's id and the game's own label for it: what the facility's
        /// localisation tag resolves to on the space-centre screens.
        /// </summary>
        [Fact]
        public void TheKscPadIsNamedAsTheGameLabelsItAndNotByItsId()
        {
            var tag = FacilityTag(SpaceCenterFacility.LaunchPad);
            using var _ = new InstalledLocalizer(new Dictionary<string, string> { [tag] = "Launch Pad" });

            Assert.Equal("Launch Pad", GameWords.LaunchSiteName("LaunchPad"));
        }

        [Fact]
        public void ASiteTheGameCannotNameIsGivenByItsId()
        {
            using var _ = new InstalledLocalizer(new Dictionary<string, string>());

            Assert.Equal("LaunchPad", GameWords.LaunchSiteName("LaunchPad"));
            Assert.Equal("Desert_Launch_Site", GameWords.LaunchSiteName("Desert_Launch_Site"));
        }

        /// <summary>
        /// The tag the game formats for a facility, read back through a
        /// Localizer that answers every tag with itself, so the test never
        /// hard-codes a number KSP may renumber.
        /// </summary>
        private static string FacilityTag(SpaceCenterFacility facility)
        {
            using var _ = new InstalledLocalizer(new Dictionary<string, string>());
            return ScenarioUpgradeableFacilities.GetFacilityName(facility);
        }

        [Fact]
        public void ALocalizerThatIsNotUpFallsBackRatherThanNamingNothing()
        {
            Assert.Equal("fallback", GameWords.Name(StockCraftTag, "fallback"));
        }
    }
}

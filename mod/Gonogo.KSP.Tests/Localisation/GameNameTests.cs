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

        [Fact]
        public void ALocalizerThatIsNotUpFallsBackRatherThanNamingNothing()
        {
            Assert.Equal("fallback", GameWords.Name(StockCraftTag, "fallback"));
        }
    }
}

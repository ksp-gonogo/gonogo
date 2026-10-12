using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A kerbal on EVA is reported as the craft they left, and that craft unloads once the
    /// kerbal is past physics range. An unloaded craft has an empty part list, so every
    /// part walk sums to zero, while stock goes on solving its CommNet link on rails.
    ///
    /// <para>Source text, not behaviour: these readers walk live KSP and cannot be compiled
    /// into this project.</para>
    /// </summary>
    public class EvaParentOnRailsTests
    {
        [Theory]
        [InlineData("attitude")]
        [InlineData("resources")]
        [InlineData("thermal")]
        [InlineData("crew")]
        [InlineData("inventories")]
        [InlineData("misc")]
        [InlineData("propulsion")]
        [InlineData("dock")]
        [InlineData("landing")]
        [InlineData("topology")]
        [InlineData("deltaV")]
        public void a_group_read_off_live_parts_is_omitted_while_the_vessel_is_unloaded(string group)
        {
            var entry = VesselEntry();

            Assert.Contains("PartsGroup(\"" + group + "\",", entry, StringComparison.Ordinal);
            Assert.DoesNotContain("TryBuildGroup(entry, \"" + group + "\",", entry, StringComparison.Ordinal);
        }

        [Fact]
        public void the_parts_gate_is_the_vessel_being_loaded()
        {
            var entry = VesselEntry();

            Assert.Contains("var loaded = vessel.loaded;", entry, StringComparison.Ordinal);
            Assert.Contains("if (loaded)", entry, StringComparison.Ordinal);
        }

        [Fact]
        public void the_link_of_the_craft_a_kerbal_left_is_read_on_rails()
        {
            var source = CurrencyDelaySourceText.ReadRelative("CommNetBackend.cs");
            var connection = CurrencyDelaySourceText.MethodBody(source, "private static CommNetVessel? Connection()");

            Assert.Contains("ActiveVesselScope.CurrentFor(out var substitutedForEva)", connection, StringComparison.Ordinal);
            Assert.Contains("!vessel.loaded && !substitutedForEva", connection, StringComparison.Ordinal);
        }

        [Fact]
        public void a_kerbal_on_an_unloaded_vessel_is_still_outside()
        {
            var entry = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspHost.cs"),
                "private static Dictionary<string, object?>? BuildEvaKerbalEntry(Vessel vessel)");

            var loadedGate = entry.IndexOf("if (vessel.loaded)", StringComparison.Ordinal);
            var noSuit = entry.IndexOf("if (eva == null)\n            {\n                return entry;", StringComparison.Ordinal);
            Assert.True(loadedGate >= 0, "the suit read must be gated on the vessel being loaded");
            Assert.True(noSuit > loadedGate, "a kerbal with no suit to read must still return its row");
        }

        private static string VesselEntry() =>
            CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspHost.cs"),
                "private static Dictionary<string, object?> BuildVesselEntry(");
    }
}

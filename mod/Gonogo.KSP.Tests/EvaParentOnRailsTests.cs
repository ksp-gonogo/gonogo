using System;
using Gonogo.KSP.Tests.CurrencyDelay;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// A vessel that unloads has an empty part list, so every part walk sums to zero. The
    /// craft a kerbal left is reported only while it is loaded, and the vessel in focus is
    /// the one position is read off.
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
            Assert.Contains(": loaded)", entry, StringComparison.Ordinal);
        }

        [Fact]
        public void the_link_is_read_off_the_reported_vessel_while_it_is_loaded()
        {
            var source = CurrencyDelaySourceText.ReadRelative("CommNetBackend.cs");
            var connection = CurrencyDelaySourceText.MethodBody(source, "private static CommNetVessel? Connection()");

            Assert.Contains("ActiveVesselScope.Current", connection, StringComparison.Ordinal);
            Assert.Contains("!vessel.loaded", connection, StringComparison.Ordinal);
        }

        [Fact]
        public void only_a_loaded_kerbal_has_its_suit_read_and_an_unloaded_one_is_listed_without_it()
        {
            var source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");
            Assert.Contains("evaUnloaded.Add(BuildEvaUnloadedEntry(candidate));", source, StringComparison.Ordinal);
            Assert.True(
                source.IndexOf("if (!candidate.loaded)", StringComparison.Ordinal)
                    < source.IndexOf("BuildEvaKerbalEntry(candidate)", StringComparison.Ordinal),
                "an unloaded kerbal must be diverted before its suit is read");

            var entry = CurrencyDelaySourceText.MethodBody(
                source,
                "private static Dictionary<string, object?>? BuildEvaKerbalEntry(Vessel vessel)");
            Assert.DoesNotContain("vessel.loaded", entry, StringComparison.Ordinal);
        }

        [Fact]
        public void a_dead_kerbal_is_not_listed_as_outside()
        {
            var source = CurrencyDelaySourceText.ReadRelative("KspHost.cs");

            Assert.Contains("|| candidate.state == Vessel.State.DEAD)", source, StringComparison.Ordinal);
        }

        [Fact]
        public void a_tank_with_no_capacity_reports_neither_propellant_figure()
        {
            var entry = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspHost.cs"),
                "private static Dictionary<string, object?>? BuildEvaKerbalEntry(Vessel vessel)");

            var gate = entry.IndexOf("capacity is > 0", StringComparison.Ordinal);
            Assert.True(gate >= 0, "the propellant read must be gated on a capacity");
            Assert.True(entry.IndexOf("\"propellantAmount\"", StringComparison.Ordinal) > gate);
            Assert.True(entry.IndexOf("\"propellantCapacity\"", StringComparison.Ordinal) > gate);
        }

        [Theory]
        [InlineData("attitude")]
        [InlineData("landing")]
        public void a_position_group_is_read_off_the_focused_vessel_and_gated_on_it_being_loaded(string group)
        {
            var entry = VesselEntry();

            Assert.Contains("PartsGroup(\"" + group + "\", () => Build", entry, StringComparison.Ordinal);
            Assert.Contains(", focused);", entry, StringComparison.Ordinal);
        }

        [Theory]
        [InlineData("orbit", "BuildOrbit(focusedOrbit)")]
        [InlineData("flight", "BuildFlight(focused)")]
        [InlineData("surface", "BuildSurface(focused, focusedOrbit, lowestPoint)")]
        public void a_position_group_follows_the_vessel_in_focus(string group, string call)
        {
            var entry = VesselEntry();

            Assert.Contains("TryBuildGroup(entry, \"" + group + "\", () => " + call + ")", entry, StringComparison.Ordinal);
        }

        private static string VesselEntry() =>
            CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspHost.cs"),
                "private static Dictionary<string, object?> BuildVesselEntry(");
    }
}

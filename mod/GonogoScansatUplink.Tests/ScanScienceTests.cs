using System.Collections.Generic;
using Gonogo.ScansatUplink;
using Xunit;

namespace GonogoScansatUplink.Tests
{
    /// <summary>
    /// Shape-tests the pure <c>scansat.science</c> wire builder
    /// (<see cref="ScanScience"/>) — the exact camelCase keys, the friendly-name
    /// mapping, and the always-false <c>deployed</c>/<c>inoperable</c> constants
    /// the client contract (<c>Sitrep.Contract.ScanScienceEntry</c> / the
    /// ScienceOfficer augment) reads. No live SCANsat/KSP: the builder takes
    /// plain scalars, so the SCANexperiment-typed read is exercised separately on
    /// the Deck.
    /// </summary>
    public class ScanScienceTests
    {
        [Fact]
        public void EmitsExactWireKeys()
        {
            var wire = ScanScience.Build(
                partId: "42",
                partTitle: "SAR Altimetry Sensor",
                expId: "SCANsatAltimetryHiRes",
                hasData: true,
                rerunnable: true);

            Assert.Equal("42", wire["partId"]);
            Assert.Equal("SAR Altimetry Sensor", wire["partTitle"]);
            Assert.Equal("SCANsatAltimetryHiRes", wire["expId"]);
            Assert.Equal("SAR", wire["title"]);
            Assert.Equal(true, wire["hasData"]);
            Assert.Equal(true, wire["rerunnable"]);

            // No SCANsat source for either — always false.
            Assert.Equal(false, wire["deployed"]);
            Assert.Equal(false, wire["inoperable"]);
        }

        [Fact]
        public void HasDataAndRerunnable_PassThroughFromInputs()
        {
            var wire = ScanScience.Build(
                partId: "7",
                partTitle: "Radar",
                expId: "SCANsatAltimetryLoRes",
                hasData: false,
                rerunnable: true);

            Assert.Equal(false, wire["hasData"]);
            Assert.Equal(true, wire["rerunnable"]);
        }

        [Theory]
        [InlineData("SCANsatAltimetryLoRes", "RADAR")]
        [InlineData("SCANsatAltimetryHiRes", "SAR")]
        [InlineData("SCANsatBiomeAnomaly", "Multispectral")]
        [InlineData("SCANsatResources", "Resources")]
        [InlineData("SCANsatVisual", "Visual")]
        public void FriendlyTitle_MapsKnownExperimentIds(string expId, string expected)
        {
            Assert.Equal(expected, ScanScience.FriendlyTitle(expId));
        }

        [Fact]
        public void FriendlyTitle_FallsBackToRawIdForUnknown()
        {
            Assert.Equal("SomethingNew", ScanScience.FriendlyTitle("SomethingNew"));
        }

        [Fact]
        public void Title_UsesFriendlyNameForKnownExperiment()
        {
            var wire = ScanScience.Build("1", "Multispectral Sensor", "SCANsatBiomeAnomaly", hasData: true, rerunnable: true);
            Assert.Equal("Multispectral", wire["title"]);
        }
    }
}

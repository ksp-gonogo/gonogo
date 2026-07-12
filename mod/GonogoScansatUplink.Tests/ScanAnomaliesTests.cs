using System.Collections.Generic;
using Gonogo.ScansatUplink;
using Xunit;

namespace GonogoScansatUplink.Tests
{
    /// <summary>
    /// Shape-tests the pure <c>scansat.anomalies.&lt;body&gt;</c> wire builder
    /// (<see cref="ScanAnomalies"/>) — the exact camelCase keys and the
    /// straight pass-through of SCANsat's own name/lat/lon/known/detail
    /// fields the client contract (<c>Sitrep.Contract.ScanAnomalyEntry</c> /
    /// the client's <c>SCANAnomalyEntry</c>) reads. No live SCANsat/KSP: the
    /// builder takes plain scalars, so the <c>SCANdata.Anomalies</c> read is
    /// exercised separately on the Deck.
    /// </summary>
    public class ScanAnomaliesTests
    {
        [Fact]
        public void EmitsExactWireKeysForOneAnomaly()
        {
            var wire = ScanAnomalies.Build(new List<ScanAnomalies.AnomalyInput>
            {
                new ScanAnomalies.AnomalyInput("KSC Monolith", 285.3, -0.05, known: true, detail: true),
            });

            Assert.Single(wire);
            var entry = Assert.IsType<Dictionary<string, object?>>(wire[0]);
            Assert.Equal("KSC Monolith", entry["name"]);
            Assert.Equal(285.3, entry["longitude"]);
            Assert.Equal(-0.05, entry["latitude"]);
            Assert.Equal(true, entry["known"]);
            Assert.Equal(true, entry["detail"]);
        }

        [Fact]
        public void UndiscoveredAnomaly_KnownAndDetailBothFalse()
        {
            var wire = ScanAnomalies.Build(new List<ScanAnomalies.AnomalyInput>
            {
                new ScanAnomalies.AnomalyInput("Hidden Site", 10.0, 20.0, known: false, detail: false),
            });

            var entry = Assert.IsType<Dictionary<string, object?>>(wire[0]);
            Assert.Equal(false, entry["known"]);
            Assert.Equal(false, entry["detail"]);
        }

        [Fact]
        public void KnownButNoDetail_ReflectsPartialDiscovery()
        {
            // Anomaly-type scan found it (known) but AnomalyDetail hasn't —
            // the player sees a marker without a name yet.
            var wire = ScanAnomalies.Build(new List<ScanAnomalies.AnomalyInput>
            {
                new ScanAnomalies.AnomalyInput("Unnamed", 1.0, 2.0, known: true, detail: false),
            });

            var entry = Assert.IsType<Dictionary<string, object?>>(wire[0]);
            Assert.Equal(true, entry["known"]);
            Assert.Equal(false, entry["detail"]);
        }

        [Fact]
        public void EmptyInput_BuildsEmptyList()
        {
            var wire = ScanAnomalies.Build(new List<ScanAnomalies.AnomalyInput>());
            Assert.Empty(wire);
        }

        [Fact]
        public void PreservesInputOrder()
        {
            var wire = ScanAnomalies.Build(new List<ScanAnomalies.AnomalyInput>
            {
                new ScanAnomalies.AnomalyInput("First", 0, 0, true, true),
                new ScanAnomalies.AnomalyInput("Second", 0, 0, true, true),
            });

            var first = Assert.IsType<Dictionary<string, object?>>(wire[0]);
            var second = Assert.IsType<Dictionary<string, object?>>(wire[1]);
            Assert.Equal("First", first["name"]);
            Assert.Equal("Second", second["name"]);
        }
    }
}

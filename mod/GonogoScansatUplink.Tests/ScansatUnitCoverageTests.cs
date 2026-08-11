using GonogoScansatUplink;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace GonogoScansatUplink.Tests
{
    /// <summary>
    /// The per-Uplink half of the uplink-types-out-of-core plan's Unit guard
    /// (§5b): now that <see cref="ScanningVesselEntry"/>/
    /// <see cref="ScanSensorEntry"/>/<see cref="ScanTrackColor"/>/
    /// <see cref="ScanScienceEntry"/>/<see cref="ScanAnomalyEntry"/> live in
    /// their own assembly (<c>GonogoScansatUplink.Contract</c>) instead of
    /// <c>Sitrep.Contract</c>, nothing FORCES a future property on this Uplink's
    /// own contract types to declare its unit. The sweep itself is
    /// <c>UnitCoverageAssertion.AssertExhaustive</c>, shared with every other
    /// relocated Uplink; this file names what is this Uplink's own.
    ///
    /// <para><b>Why no baseline file.</b> This Uplink's five contract types
    /// carry thirty-two scalar properties total and every one is already
    /// annotated, so the surface starts, and must stay, entirely covered: same
    /// zero-pending starting point as every relocated slice.</para>
    ///
    /// <para><b>The branch this slice made reachable.</b> This set is not flat:
    /// <see cref="ScanningVesselEntry"/> carries
    /// <c>List&lt;ScanSensorEntry&gt; Sensors</c> and a nested
    /// <see cref="ScanTrackColor"/>, so the sequence-element branch of the shared
    /// <c>RequiresUnit</c> is genuinely exercised here. Its effect is to keep a
    /// container of annotated POCOs exempt (each element carries its own units)
    /// while still demanding an annotation on a future
    /// <c>List&lt;double&gt;</c>.</para>
    ///
    /// <para>This test only checks the ATTRIBUTE side (every scalar wire
    /// property carries <c>[SitrepUnit]</c>); the generated-file/import side is
    /// <c>generated-value-import.test.ts</c> in this Uplink's client package,
    /// and the decode-time side is <c>topics.test.ts</c> there.</para>
    /// </summary>
    public class ScansatUnitCoverageTests
    {
        [Fact]
        public void EveryScalarWirePropertyDeclaresAUnit() =>
            UnitCoverageAssertion.AssertExhaustive(
                typeof(ScanningVesselEntry).Assembly,
                "Units.Degrees/Units.Metres");

        /// <summary>
        /// The nesting this relocation introduced, asserted rather than assumed.
        /// <see cref="EveryScalarWirePropertyDeclaresAUnit"/> would pass
        /// vacuously on the nested half if
        /// <see cref="ScanSensorEntry"/>/<see cref="ScanTrackColor"/> ever
        /// stopped being reached, either because they lost
        /// <c>[SitrepContract]</c> or because <see cref="ScanningVesselEntry"/>
        /// stopped referencing them. Both are silent failures of the guard, not
        /// of the wire, so they get their own assertion.
        /// </summary>
        [Fact]
        public void TheNestedPayloadTypesAreReachedByTheCoverageScan()
        {
            UnitCoverageAssertion.AssertContractTypesAreExactly(
                typeof(ScanningVesselEntry).Assembly,
                nameof(ScanningVesselEntry),
                nameof(ScanSensorEntry),
                nameof(ScanTrackColor),
                nameof(ScanScienceEntry),
                nameof(ScanAnomalyEntry));

            // ScanningVesselEntry genuinely nests both, so the sequence-element
            // branch of RequiresUnit is exercised by real data, not just present.
            var sensors = typeof(ScanningVesselEntry).GetProperty(nameof(ScanningVesselEntry.Sensors))!;
            Assert.False(
                UnitCoverageAssertion.RequiresUnit(sensors),
                "List<ScanSensorEntry> must be exempt: each element carries its own units.");

            var trackColor = typeof(ScanningVesselEntry).GetProperty(nameof(ScanningVesselEntry.TrackColor))!;
            Assert.False(
                UnitCoverageAssertion.RequiresUnit(trackColor),
                "A nested ScanTrackColor must be exempt: its own four channels are annotated.");
        }
    }
}

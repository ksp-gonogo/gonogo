using GonogoAvionicsUplink;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace GonogoAvionicsUplink.Tests
{
    /// <summary>
    /// The per-Uplink half of the uplink-types-out-of-core plan's Unit guard
    /// (§5b): now that <see cref="AvionicsStatus"/> lives in its own assembly
    /// (<c>GonogoAvionicsUplink.Contract</c>) instead of <c>Sitrep.Contract</c>,
    /// nothing FORCES a future property on this Uplink's own contract type to
    /// declare its unit. The sweep itself is
    /// <c>UnitCoverageAssertion.AssertExhaustive</c>, shared with every other
    /// relocated Uplink; this file names what is this Uplink's own.
    ///
    /// <para><b>Why no baseline file.</b> This Uplink has exactly four scalar
    /// properties and all four are already annotated, so the surface starts,
    /// and must stay, entirely covered: same zero-pending starting point as
    /// every relocated slice.</para>
    ///
    /// <para><b>What this one exercises that the command-arg slices cannot.</b>
    /// <see cref="AvionicsStatus"/> is an outbound READ payload, not command
    /// args, so <c>RtConfig.ApplyUnitValueTypes</c> genuinely retypes
    /// <see cref="AvionicsStatus.ControllableMassTons"/>/
    /// <see cref="AvionicsStatus.VesselMassTons"/> to <c>Value&lt;"t"&gt;</c> in
    /// the generated contract (see <c>AvionicsRtConfig.Configure</c>'s doc
    /// comment). This test only checks the ATTRIBUTE side (every scalar wire
    /// property carries <c>[SitrepUnit]</c>); the generated-file/import side is
    /// <c>generated-value-import.test.ts</c> in this Uplink's client package.</para>
    /// </summary>
    public class AvionicsUnitCoverageTests
    {
        [Fact]
        public void EveryScalarWirePropertyDeclaresAUnit() =>
            UnitCoverageAssertion.AssertExhaustive(
                typeof(AvionicsStatus).Assembly,
                "Units.Tonnes");

        /// <summary>
        /// The one type is reached by the sweep, and nothing else is.
        /// <see cref="EveryScalarWirePropertyDeclaresAUnit"/> would pass on an
        /// EMPTY set, which is exactly what a type quietly losing
        /// <c>[SitrepContract]</c> would leave behind.
        /// </summary>
        [Fact]
        public void TheContractTypeIsExactlyTheStatusPayload() =>
            UnitCoverageAssertion.AssertContractTypesAreExactly(
                typeof(AvionicsStatus).Assembly,
                nameof(AvionicsStatus));
    }
}

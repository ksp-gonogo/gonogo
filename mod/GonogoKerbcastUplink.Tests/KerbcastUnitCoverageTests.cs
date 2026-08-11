using GonogoKerbcastUplink;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace GonogoKerbcastUplink.Tests
{
    /// <summary>
    /// The per-Uplink half of the uplink-types-out-of-core plan's Unit guard
    /// (§5b): now that <see cref="KerbcastCameraEntry"/>/
    /// <see cref="KerbcastSetFieldOfViewArgs"/>/<see cref="KerbcastSetPanArgs"/>
    /// live in their own assembly (<c>GonogoKerbcastUplink.Contract</c>) instead
    /// of <c>Sitrep.Contract</c>, nothing FORCES a future property on this
    /// Uplink's own contract types to declare its unit. The sweep itself is
    /// <c>UnitCoverageAssertion.AssertExhaustive</c>, shared with every other
    /// relocated Uplink; this file names what is this Uplink's own.
    ///
    /// <para><b>Why no baseline file.</b> This Uplink's three contract types
    /// carry twenty-five scalar properties total and every one is already
    /// annotated, so the surface starts, and must stay, entirely covered: same
    /// zero-pending starting point as every relocated slice.</para>
    ///
    /// <para><b>What this one holds that no single predecessor did.</b>
    /// <see cref="KerbcastCameraEntry"/> is an outbound READ payload: its nine
    /// <c>Units.Degrees</c> properties genuinely retype to
    /// <c>Value&lt;"deg"&gt;</c> in the generated contract (see
    /// <c>KerbcastRtConfig.Configure</c>'s doc comment).
    /// <see cref="KerbcastSetFieldOfViewArgs"/>/<see cref="KerbcastSetPanArgs"/>
    /// are command args: their own <c>Units.Degrees</c> properties stay bare,
    /// since <c>RtConfig.ApplyUnitValueTypes</c> deliberately skips inbound-only
    /// args. The sweep demands the ATTRIBUTE on all three types alike, which is
    /// the point: the attribute is the DECLARATION, and whether codegen acts on
    /// it is a separate question answered by
    /// <c>generated-value-import.test.ts</c> in this Uplink's client
    /// package.</para>
    /// </summary>
    public class KerbcastUnitCoverageTests
    {
        [Fact]
        public void EveryScalarWirePropertyDeclaresAUnit() =>
            UnitCoverageAssertion.AssertExhaustive(
                typeof(KerbcastCameraEntry).Assembly,
                "Units.Degrees");

        /// <summary>
        /// All three types are reached by the sweep, and nothing else is.
        /// <see cref="EveryScalarWirePropertyDeclaresAUnit"/> passes VACUOUSLY on
        /// any type that quietly loses <c>[SitrepContract]</c>, and with the read
        /// payload and the two arg shapes sharing an assembly the loss would be
        /// invisible in the remaining green.
        /// </summary>
        [Fact]
        public void TheContractTypesAreExactlyTheCameraEntryAndItsTwoArgShapes() =>
            UnitCoverageAssertion.AssertContractTypesAreExactly(
                typeof(KerbcastCameraEntry).Assembly,
                nameof(KerbcastCameraEntry),
                nameof(KerbcastSetFieldOfViewArgs),
                nameof(KerbcastSetPanArgs));
    }
}

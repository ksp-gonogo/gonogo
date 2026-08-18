using System.Reflection;
using Gonogo.KosUplink;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace GonogoKosUplink.Tests
{
    /// <summary>
    /// The per-Uplink half of the uplink-types-out-of-core plan's Unit guard
    /// (§5b): now that the eleven <c>Kos*</c> payload and command-arg types live
    /// in their own assembly (<c>GonogoKosUplink.Contract</c>) instead of
    /// <c>Sitrep.Contract</c>, nothing FORCES a future property on this Uplink's
    /// own contract types to declare its unit. The sweep itself is
    /// <c>UnitCoverageAssertion.AssertExhaustive</c>, shared with every other
    /// relocated Uplink; this file names what is this Uplink's own.
    ///
    /// <para><b>Why no baseline file.</b> Every scalar property on all eleven
    /// types is already annotated, so the surface starts, and must stay, entirely
    /// covered: same zero-pending starting point as every other relocated
    /// slice.</para>
    ///
    /// <para><b>What is distinctive about this slice, and it is not the
    /// quantities.</b> Eight of the eleven are inbound-only command args, and the
    /// eleven types between them declare exactly ONE property whose token names a
    /// real dimension (<see cref="KosComputeStatus.LastGoodAt"/>,
    /// <c>Units.Seconds</c>). Everything else is <c>Id</c>/<c>Text</c>/
    /// <c>Flag</c>/<c>Count</c>. That makes this the thinnest slice of the six on
    /// units and the one where the ATTRIBUTE gate does the most work relative to
    /// the retyping: a bare <c>string LeaseToken</c> added to one of the terminal
    /// arg types would be invisible to any Value-based check and is caught here.
    /// The <c>Units.Count</c> pair on <see cref="KosTerminalResizeArgs"/> is the
    /// case that shows the two halves are separate: <c>Count</c> is deliberately
    /// NOT in <c>RtConfig.NonQuantityUnits</c>, so those two would retype on any
    /// non-args type, and they stay bare purely because of the inbound-only
    /// rule.</para>
    ///
    /// <para>This test only checks the ATTRIBUTE side (every scalar wire
    /// property carries <c>[SitrepUnit]</c>); the generated-file/import side is
    /// <c>generated-value-import.test.ts</c> in this Uplink's client package,
    /// and the runtime-registry side is <c>topics.test.ts</c> there.</para>
    /// </summary>
    public class KosUnitCoverageTests
    {
        [Fact]
        public void EveryScalarWirePropertyDeclaresAUnit() =>
            UnitCoverageAssertion.AssertExhaustive(
                typeof(KosProcessorInfo).Assembly,
                "Units.Seconds/Units.Count");

        /// <summary>
        /// All eleven are reached by the sweep, and nothing else is.
        /// <see cref="EveryScalarWirePropertyDeclaresAUnit"/> passes VACUOUSLY on
        /// any type the sweep does not reach, and this slice spans three files, so
        /// one of them losing its <c>[SitrepContract]</c> tags wholesale would
        /// leave the remaining green looking untouched.
        /// </summary>
        [Fact]
        public void EveryRelocatedTypeIsReachedByTheCoverageScan() =>
            UnitCoverageAssertion.AssertContractTypesAreExactly(
                typeof(KosProcessorInfo).Assembly,
                nameof(KosProcessorInfo), nameof(KosComputeStatus),
                nameof(KosExecArgs), nameof(KosReEnableArgs),
                nameof(KosTerminalFrame), nameof(KosTerminalOpenArgs),
                nameof(KosKeystrokeArgs), nameof(KosTerminalResizeArgs),
                nameof(KosTerminalCloseArgs),
                nameof(KosRunArgs), nameof(KosRunResult));

        /// <summary>
        /// The one field in this whole slice that a formatter could get WRONG, as
        /// opposed to merely print bare, pinned by name. Everything else here is
        /// an identifier or a flag, where an absent unit costs nothing;
        /// <see cref="KosComputeStatus.LastGoodAt"/> is an INSTANT on the
        /// universal-time clock, and a client that does not know that renders a
        /// timestamp as a raw five-digit number, or worse counts down to it.
        ///
        /// <para><c>UniversalTime</c> rather than <c>Seconds</c>, and the
        /// difference is the point: this is when the last good result came back,
        /// never how long ago. The two shared a token until an absolute UT
        /// reached a countdown in two shipped widgets.</para>
        /// </summary>
        [Fact]
        public void TheOneRealQuantityDeclaresAnInstant()
        {
            var lastGoodAt = typeof(KosComputeStatus).GetProperty(nameof(KosComputeStatus.LastGoodAt))!;

            Assert.True(UnitCoverageAssertion.RequiresUnit(lastGoodAt));
            Assert.Equal(Units.UniversalTime, lastGoodAt.GetCustomAttribute<SitrepUnitAttribute>()!.Unit);
        }

        /// <summary>
        /// <see cref="KosRunResult.Fields"/> is the one property in the slice the
        /// sweep must NOT demand a unit for, and the reason is worth pinning: it
        /// is a <c>Dictionary&lt;string, object?&gt;</c> of whatever a kerboscript
        /// printed, so there is no single dimension that could describe its
        /// values. It is the contrast case to a name-keyed map of same-unit
        /// readings, where the annotation IS the thing that makes the numbers
        /// renderable.
        /// </summary>
        [Fact]
        public void TheHeterogeneousFieldMapIsExemptAndDeliberatelyUnannotated()
        {
            var fields = typeof(KosRunResult).GetProperty(nameof(KosRunResult.Fields))!;

            Assert.False(
                UnitCoverageAssertion.RequiresUnit(fields),
                "A dictionary collapses to object: the sweep cannot demand an annotation.");
            Assert.Null(fields.GetCustomAttribute<SitrepUnitAttribute>());
        }
    }
}

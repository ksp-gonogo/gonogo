using Gonogo.MechJebUplink;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace GonogoMechJebUplink.Tests
{
    /// <summary>
    /// The per-Uplink half of the uplink-types-out-of-core plan's Unit guard
    /// (§5b): now that <see cref="MechJebAscentArgs"/>/<see cref="MechJebNoArgs"/>
    /// live in their own assembly (<c>GonogoMechJebUplink.Contract</c>) instead
    /// of <c>Sitrep.Contract</c>, nothing FORCES a future property on this
    /// Uplink's own contract types to declare its unit.
    ///
    /// <para><b>The sweep is shared now.</b> This file used to hold its own copy
    /// of the reflection body, as the pilot for the mechanism; the plan (§5b)
    /// always intended a shared
    /// <c>UnitCoverageAssertion.AssertExhaustive(Assembly)</c> once a second
    /// Uplink needed the identical check, and five of them ended up with one
    /// each. The copies had drifted: this one, being the pilot for two flat
    /// command-arg DTOs, trimmed <c>RequiresUnit</c> to scalars-only and said so.
    /// The shared helper carries core's rule in full, so a
    /// <c>List&lt;double&gt;</c> added here later is demanded rather than waved
    /// through.</para>
    ///
    /// <para><b>Why no baseline file, unlike the core gate.</b>
    /// <c>UnitCoverageTests</c> ships a shrink-only baseline because core has
    /// ~580 properties and some are still bare. This Uplink has exactly one
    /// scalar property (<see cref="MechJebAscentArgs.TargetAltitudeKm"/>) and
    /// it is already annotated, so the surface starts, and must stay,
    /// entirely covered: a bare assertion is the honest gate for a
    /// zero-pending starting point, and adding a baseline mechanism nothing
    /// uses yet would be needless ceremony.</para>
    ///
    /// <para><b>What this pilot does NOT exercise.</b> Both of this
    /// assembly's types are command ARGS (inbound-only), which
    /// <c>RtConfig.ApplyUnitValueTypes</c> deliberately never retypes to
    /// <c>Value&lt;&gt;</c>/<c>Vec3Of&lt;&gt;</c> (see its own doc comment): a
    /// widget JSON-stringifies these straight to the wire, and there is no
    /// unwrap step to make a wrapped value round-trip. So the plan's "resolves
    /// to a core gonogo Value type" half of §5b has nothing to check here,
    /// <c>mod/GonogoMechJebUplink/client/src/generated-value-import.test.ts</c>
    /// covers the mechanism generically (it passes vacuously for MechJeb
    /// today) and is the one that fires for an Uplink with an outbound,
    /// unit-bearing payload.</para>
    /// </summary>
    public class MechJebUnitCoverageTests
    {
        [Fact]
        public void EveryScalarWirePropertyDeclaresAUnit() =>
            UnitCoverageAssertion.AssertExhaustive(
                typeof(MechJebAscentArgs).Assembly,
                "Units.Kilometres");

        /// <summary>
        /// Both types are reached by the sweep, and nothing else is. Cheap here,
        /// where the set is two flat DTOs, and the reason it is still worth
        /// asserting is that <see cref="EveryScalarWirePropertyDeclaresAUnit"/>
        /// passes VACUOUSLY on a type that quietly loses
        /// <c>[SitrepContract]</c>.
        /// </summary>
        [Fact]
        public void TheContractTypesAreExactlyTheTwoCommandArgShapes() =>
            UnitCoverageAssertion.AssertContractTypesAreExactly(
                typeof(MechJebAscentArgs).Assembly,
                nameof(MechJebAscentArgs),
                nameof(MechJebNoArgs));
    }
}

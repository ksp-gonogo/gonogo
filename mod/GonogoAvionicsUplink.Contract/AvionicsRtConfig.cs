#if SITREP_CODEGEN
using System;
using Reinforced.Typings.Fluent;

namespace GonogoAvionicsUplink;

/// <summary>
/// This Uplink's OWN codegen configuration: mirrors
/// <c>Sitrep.Contract.RtConfig.Configure</c>'s shape exactly, scoped to just
/// this assembly's one wire type, and reuses
/// <c>RtConfig.ApplyUnitValueTypes</c> the same way
/// <c>MechJebRtConfig.Configure</c> does (the uplink-types-out-of-core
/// pilot's mechanism, unchanged here).
///
/// <para><b>The difference from the MechJeb pilot: this one actually
/// retypes something.</b> MechJeb's two types were both command ARGS
/// (inbound-only), which <c>ApplyUnitValueTypes</c> deliberately skips (see
/// its own doc comment), so MechJeb's generated <c>contract.ts</c> imported
/// <c>Value</c>/<c>Vec3Of</c> but never used either. <see cref="AvionicsStatus"/>
/// is an outbound READ payload, not an args type, so its two
/// <c>[SitrepUnit(Units.Tonnes)]</c> properties
/// (<see cref="AvionicsStatus.ControllableMassTons"/>/
/// <see cref="AvionicsStatus.VesselMassTons"/>) genuinely retype to
/// <c>Value&lt;"t"&gt;</c> below, exactly as they did while still declared in
/// <c>Sitrep.Contract</c>. The two <c>Units.Flag</c> properties
/// (<see cref="AvionicsStatus.AvionicsActive"/>/
/// <see cref="AvionicsStatus.Controllable"/>) stay plain <c>boolean</c>,
/// <c>Flag</c> is one of <c>ApplyUnitValueTypes</c>'s non-quantity tokens
/// (see <c>RtConfig.NonQuantityUnits</c>), unrelated to the args exclusion.
/// This is therefore the first relocation to exercise the "resolves to a
/// core gonogo Value type" half of the plan's Unit guard for real: see
/// <c>generated-value-import.test.ts</c> in this Uplink's client package,
/// which asserts the emitted import non-vacuously here (it only proved the
/// assertion itself worked for MechJeb).</para>
///
/// <para>Invoked by <c>mod/codegen.sh</c>'s per-uplink codegen step, writing
/// into <c>mod/GonogoAvionicsUplink/client/src/__generated__/</c>, never into
/// <c>sitrep-sdk</c>. Unlike MechJeb, this Uplink's one type carries a real
/// <see cref="Sitrep.Contract.SitrepTopicAttribute"/> (<c>avionics.status</c>),
/// so <c>EmitTopicMap</c> is wired here too (MechJeb had nothing to name: see
/// its own <c>Configure</c>'s comment).</para>
///
/// <para><b>Runtime hydration, not just codegen.</b> This Topic's declared
/// units also have to reach <c>wrapTopicPayload</c>'s runtime lookup
/// (<c>sitrep-sdk</c>'s <c>unitsForTopic</c>/<c>shapesForTopic</c>), and the
/// SDK's own generated map has nothing for a type declared outside
/// <c>Sitrep.Contract</c>. So this Uplink's client package (<c>topics.ts</c>)
/// calls the SDK's <c>registerTopicUnits</c> at module load, feeding it the
/// UNIT map this Configure emits below. Both legs are needed:
/// <c>ApplyUnitValueTypes</c> fixes the codegen-time TYPE, never the
/// decode-time VALUE.</para>
/// </summary>
public static class AvionicsRtConfig
{
    public static void Configure(ConfigurationBuilder builder)
    {
        builder.Global(g => g
            .CamelCaseForProperties()
            .UseModules(true)
            .AutoOptionalProperties()
            // Carry this slice's `///` prose onto its generated declarations, the
            // same way core does. See Sitrep.Contract.RtDocVisitor.
            .GenerateDocumentation()
            .UseVisitor<Sitrep.Contract.RtDocVisitor>());

        Sitrep.Contract.RtDocText.MergeRemarksIntoSummaries(builder);

        // Held in a local for the same reason RtConfig.wirePayloadTypes is:
        // ApplyUnitValueTypes re-enters this exact set, only a type
        // registered with rtcli may have its properties retyped.
        var wireTypes = new[]
        {
            typeof(AvionicsStatus),
        };

        builder.ExportAsInterfaces(wireTypes, c => c.AutoI(false).WithPublicProperties());

        // Same call core's own Configure makes, just against THIS
        // assembly's types and pointed at the npm package this Uplink's
        // generated file actually imports from (a relative "../value" path,
        // core's default, would not resolve from
        // mod/GonogoAvionicsUplink/client/src/__generated__/).
        Sitrep.Contract.RtConfig.ApplyUnitValueTypes(builder, wireTypes, valueImportFrom: "@ksp-gonogo/sitrep-sdk");

        // AvionicsStatus carries [SitrepTopic("avionics.status")]: unlike
        // MechJeb's two command-arg types, there IS a topic to name here.
        var topicMapOut = Environment.GetEnvironmentVariable("SITREP_AVIONICS_TOPICMAP_OUT");
        if (!string.IsNullOrEmpty(topicMapOut))
        {
            Sitrep.Contract.RtConfig.EmitTopicMap(topicMapOut!, typeof(AvionicsRtConfig).Assembly);
        }

        var unitMapOut = Environment.GetEnvironmentVariable("SITREP_AVIONICS_UNITMAP_OUT");
        if (!string.IsNullOrEmpty(unitMapOut))
        {
            Sitrep.Contract.RtConfig.EmitUnitMap(
                unitMapOut!,
                Environment.GetEnvironmentVariable("SITREP_AVIONICS_UNITJSON_OUT"),
                typeof(AvionicsRtConfig).Assembly);
        }
    }
}
#endif

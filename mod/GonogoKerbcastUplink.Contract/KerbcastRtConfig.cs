#if SITREP_CODEGEN
using System;
using Reinforced.Typings.Fluent;

namespace GonogoKerbcastUplink;

/// <summary>
/// This Uplink's OWN codegen configuration: mirrors
/// <c>Sitrep.Contract.RtConfig.Configure</c>'s shape exactly, scoped to just
/// this assembly's three wire types, and reuses
/// <c>RtConfig.ApplyUnitValueTypes</c> the same way <c>MechJebRtConfig
/// .Configure</c>/<c>AvionicsRtConfig.Configure</c> do (the
/// uplink-types-out-of-core plan's mechanism, unchanged here).
///
/// <para><b>Both halves the pilot and the Avionics relocation each hit
/// separately, together for the first time.</b> <see cref="KerbcastCameraEntry"/>
/// is an outbound READ payload carrying nine <c>[SitrepUnit(Units.Degrees)]</c>
/// properties (field of view + pan yaw/pitch, each with a min/max pair), so it
/// genuinely retypes to <c>Value&lt;"deg"&gt;</c> below, exactly like
/// <c>AvionicsStatus</c>'s two <c>Units.Tonnes</c> properties did.
/// <see cref="KerbcastSetFieldOfViewArgs"/>/<see cref="KerbcastSetPanArgs"/>
/// are command ARGS (their type names end in <c>"Args"</c>), so
/// <c>ApplyUnitValueTypes</c> deliberately skips retyping their own
/// <c>Units.Degrees</c> properties, same as MechJeb's two types: a widget
/// builds these and sends them straight to <c>JSON.stringify</c>, there is no
/// unwrap step on the way out. See <c>generated-value-import.test.ts</c> in
/// this Uplink's client package, which asserts the emitted import
/// non-vacuously (KerbcastCameraEntry's nine fields make it so).</para>
///
/// <para>Invoked by <c>mod/codegen.sh</c>'s per-uplink codegen step, writing
/// into <c>mod/GonogoKerbcastUplink/client/src/__generated__/</c>, never into
/// <c>sitrep-sdk</c>. <see cref="KerbcastCameraEntry"/> carries a real
/// <see cref="Sitrep.Contract.SitrepTopicAttribute"/> (<c>kerbcast.cameras</c>),
/// so <c>EmitTopicMap</c> is wired here too. An Uplink whose types carry no
/// <c>[SitrepTopic]</c> has nothing to name and skips it.</para>
///
/// <para><b>Runtime hydration, not just codegen.</b> This Topic's declared
/// units also have to reach <c>wrapTopicPayload</c>'s runtime lookup
/// (<c>sitrep-sdk</c>'s <c>unitsForTopic</c>/<c>shapesForTopic</c>), and the
/// SDK's own generated map has nothing for a type declared outside
/// <c>Sitrep.Contract</c>. So this Uplink's client package (<c>topics.ts</c>)
/// calls the SDK's <c>registerTopicUnits</c> at module load, feeding it the
/// UNIT map this Configure emits below. Both legs are needed:
/// <c>ApplyUnitValueTypes</c> fixes the codegen-time TYPE, never the
/// decode-time VALUE. Without this,
/// fieldOfView/panYaw/panPitch (and their min/max pairs) would arrive as bare
/// numbers at runtime while the TYPE still says <c>Value&lt;"deg"&gt;</c>.</para>
/// </summary>
public static class KerbcastRtConfig
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
            typeof(KerbcastCameraEntry),
            typeof(KerbcastSetFieldOfViewArgs),
            typeof(KerbcastSetPanArgs),
        };

        builder.ExportAsInterfaces(wireTypes, c => c.AutoI(false).WithPublicProperties());

        // Same call core's own Configure makes, just against THIS assembly's
        // types and pointed at the npm package this Uplink's generated file
        // actually imports from (a relative "../value" path, core's default,
        // would not resolve from
        // mod/GonogoKerbcastUplink/client/src/__generated__/).
        Sitrep.Contract.RtConfig.ApplyUnitValueTypes(builder, wireTypes, valueImportFrom: "@ksp-gonogo/sitrep-sdk");

        // KerbcastCameraEntry carries [SitrepTopic("kerbcast.cameras")]: there
        // IS a topic to name here, unlike MechJeb's two command-arg-only types.
        var topicMapOut = Environment.GetEnvironmentVariable("SITREP_KERBCAST_TOPICMAP_OUT");
        if (!string.IsNullOrEmpty(topicMapOut))
        {
            Sitrep.Contract.RtConfig.EmitTopicMap(topicMapOut!, typeof(KerbcastRtConfig).Assembly);
        }

        var unitMapOut = Environment.GetEnvironmentVariable("SITREP_KERBCAST_UNITMAP_OUT");
        if (!string.IsNullOrEmpty(unitMapOut))
        {
            Sitrep.Contract.RtConfig.EmitUnitMap(
                unitMapOut!,
                Environment.GetEnvironmentVariable("SITREP_KERBCAST_UNITJSON_OUT"),
                typeof(KerbcastRtConfig).Assembly);
        }

        // This slice declares commands of its own, so it emits its own command
        // map beside the topic map above. `CommandResult`/`CommandResultOf` are
        // core's and are not in this slice's contract.ts, so they come from the
        // published package rather than from a relative path that would not
        // resolve out of client/src/__generated__/.
        var commandMapOut = Environment.GetEnvironmentVariable("SITREP_KERBCAST_COMMANDMAP_OUT");
        if (!string.IsNullOrEmpty(commandMapOut))
        {
            Sitrep.Contract.RtConfig.EmitCommandMap(
                commandMapOut!,
                typeof(KerbcastRtConfig).Assembly,
                resultImportFrom: "@ksp-gonogo/sitrep-sdk");
        }
    }
}
#endif

#if NETSTANDARD2_0
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
/// so <c>EmitTopicMap</c> is wired here too, mirroring
/// <c>AvionicsRtConfig.Configure</c> (MechJeb had nothing to name: see its own
/// <c>Configure</c>'s comment).</para>
///
/// <para><b>Runtime hydration, not just codegen.</b> A relocated Topic's
/// declared units also have to reach <c>wrapTopicPayload</c>'s runtime lookup
/// (<c>sitrep-sdk</c>'s <c>unitsForTopic</c>/<c>shapesForTopic</c>), which
/// used to read <c>kerbcast.cameras</c> straight out of the SDK's own
/// generated map because <see cref="KerbcastCameraEntry"/> lived in
/// <c>Sitrep.Contract</c>. It does not any more, so this Uplink's client
/// package (<c>topics.ts</c>) now calls the SDK's <c>registerTopicUnits</c> at
/// module load, feeding it the UNIT map this Configure emits below (see that
/// file's comment for why: <c>ApplyUnitValueTypes</c> only fixes the
/// codegen-time TYPE, not the decode-time VALUE). Without this,
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
            .AutoOptionalProperties());

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
    }
}
#endif

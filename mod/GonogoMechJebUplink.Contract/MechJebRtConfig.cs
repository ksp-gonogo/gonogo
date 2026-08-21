#if SITREP_CODEGEN
using System;
using Reinforced.Typings.Fluent;

namespace Gonogo.MechJebUplink;

/// <summary>
/// This Uplink's OWN codegen configuration: the per-uplink mechanism the
/// uplink-types-out-of-core plan calls for, activated for the first time
/// here. Mirrors <c>Sitrep.Contract.RtConfig.Configure</c>'s shape exactly,
/// scoped to just this assembly's wire types, and reuses
/// <c>RtConfig.ApplyUnitValueTypes</c> (already public, already documented as
/// assembly-generic, simply never called this way before this pilot) so a
/// quantity-bearing property on a Value the client receives gets the SAME
/// <c>Value&lt;"token"&gt;</c>/<c>Vec3Of&lt;"token"&gt;</c> retyping a
/// first-party payload gets. No enforcement is lost by living outside
/// <c>Sitrep.Contract</c>: see <c>ApplyUnitValueTypes</c>'s own doc comment.
///
/// <para>Invoked by <c>mod/codegen.sh</c>'s per-uplink codegen step, the same
/// way <c>Sitrep.Contract.RtConfig.Configure</c> is invoked for core: one
/// <c>rtcli</c> run per registered Uplink, each writing into that Uplink's
/// own <c>client/src/__generated__/</c> (this one:
/// <c>mod/GonogoMechJebUplink/client/src/__generated__/</c>), never into
/// <c>sitrep-sdk</c>. The next Uplink to migrate copies this file, its own
/// <c>wireTypes</c> array, and the matching codegen.sh stanza.</para>
///
/// <para><b>Neither of this Uplink's two types actually emits a
/// <c>Value&lt;&gt;</c> today.</b> Both are command ARGS
/// (<c>MechJebAscentArgs</c>/<c>MechJebNoArgs</c>): inbound-only, client
/// &gt; mod, and <c>ApplyUnitValueTypes</c> deliberately skips any type whose
/// name ends <c>Args</c> (see its own doc comment: a widget JSON-stringifies
/// these straight to the wire, so wrapping would require an unwrap step
/// nothing performs). <c>MechJebAscentArgs.TargetAltitudeKm</c> still
/// declares <see cref="Sitrep.Contract.SitrepUnitAttribute"/>, so the
/// DECLARATION survives relocation and the unit is still discoverable via
/// <c>EmitUnitMap</c>'s field-&gt;unit table; the retype to a wire TYPE
/// simply never applied to it, in core OR here, unchanged by this move. The
/// next Uplink to migrate that HAS an outbound, unit-bearing payload
/// (Avionics's <c>AvionicsStatus</c> is next in the plan's sequencing) is the
/// one that actually exercises the <c>Value&lt;&gt;</c> retype+import path
/// this file wires up.</para>
/// </summary>
public static class MechJebRtConfig
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
            typeof(MechJebAscentArgs),
            typeof(MechJebNoArgs),
        };

        builder.ExportAsInterfaces(wireTypes, c => c.AutoI(false).WithPublicProperties());

        // Same call core's own Configure makes, just against THIS
        // assembly's types and pointed at the npm package this Uplink's
        // generated file actually imports from (a relative "../value" path,
        // core's default, would not resolve from
        // mod/GonogoMechJebUplink/client/src/__generated__/).
        Sitrep.Contract.RtConfig.ApplyUnitValueTypes(builder, wireTypes, valueImportFrom: "@ksp-gonogo/sitrep-sdk");

        var topicMapOut = Environment.GetEnvironmentVariable("SITREP_MECHJEB_TOPICMAP_OUT");
        if (!string.IsNullOrEmpty(topicMapOut))
        {
            Sitrep.Contract.RtConfig.EmitTopicMap(topicMapOut!, typeof(MechJebRtConfig).Assembly);
        }

        var unitMapOut = Environment.GetEnvironmentVariable("SITREP_MECHJEB_UNITMAP_OUT");
        if (!string.IsNullOrEmpty(unitMapOut))
        {
            Sitrep.Contract.RtConfig.EmitUnitMap(
                unitMapOut!,
                Environment.GetEnvironmentVariable("SITREP_MECHJEB_UNITJSON_OUT"),
                typeof(MechJebRtConfig).Assembly);
        }
    }
}
#endif

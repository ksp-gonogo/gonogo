#if NETSTANDARD2_0
using System;
using Reinforced.Typings.Fluent;

namespace GonogoPrincipiaUplink;

/// <summary>
/// This Uplink's OWN codegen configuration, the same shape every sibling
/// Uplink's <c>*RtConfig.Configure</c> has, scoped to this assembly's types.
///
/// <para>Both wire types go in the <c>ExportAsInterfaces</c> set, not just the
/// topic-carrying one. <see cref="PrincipiaFlightPlanBurn"/> is a nested payload
/// reached only through <see cref="PrincipiaFlightPlan.Burns"/>, and a type left
/// out of this set is not registered with rtcli, so
/// <c>ApplyUnitValueTypes</c> cannot retype its properties: the burn rows would
/// generate as bare <c>number</c> where the plan's own fields generate as
/// <c>Value&lt;"ut"&gt;</c>, in the same file, with nothing failing. Every
/// <c>*Entry</c>/<c>*Args</c>-shaped sibling type belongs here for the same
/// reason.</para>
///
/// <para>Invoked by <c>mod/codegen.sh</c>'s per-uplink step, writing into
/// <c>mod/GonogoPrincipiaUplink/client/src/__generated__/</c>, never into
/// <c>sitrep-sdk</c>.</para>
/// </summary>
public static class PrincipiaRtConfig
{
    public static void Configure(ConfigurationBuilder builder)
    {
        builder.Global(g => g
            .CamelCaseForProperties()
            .UseModules(true)
            .AutoOptionalProperties());

        // Held in a local for the same reason RtConfig.wirePayloadTypes is:
        // ApplyUnitValueTypes re-enters this exact set, and only a type
        // registered with rtcli may have its properties retyped.
        var wireTypes = new[]
        {
            typeof(PrincipiaFlightPlan),
            typeof(PrincipiaFlightPlanBurn),
        };

        builder.ExportAsInterfaces(wireTypes, c => c.AutoI(false).WithPublicProperties());

        Sitrep.Contract.RtConfig.ApplyUnitValueTypes(builder, wireTypes, valueImportFrom: "@ksp-gonogo/sitrep-sdk");

        var topicMapOut = Environment.GetEnvironmentVariable("SITREP_PRINCIPIA_TOPICMAP_OUT");
        if (!string.IsNullOrEmpty(topicMapOut))
        {
            Sitrep.Contract.RtConfig.EmitTopicMap(topicMapOut!, typeof(PrincipiaRtConfig).Assembly);
        }

        var unitMapOut = Environment.GetEnvironmentVariable("SITREP_PRINCIPIA_UNITMAP_OUT");
        if (!string.IsNullOrEmpty(unitMapOut))
        {
            Sitrep.Contract.RtConfig.EmitUnitMap(
                unitMapOut!,
                Environment.GetEnvironmentVariable("SITREP_PRINCIPIA_UNITJSON_OUT"),
                typeof(PrincipiaRtConfig).Assembly);
        }
    }
}
#endif

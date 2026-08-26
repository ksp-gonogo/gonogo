#if SITREP_CODEGEN
using System;
using Reinforced.Typings.Fluent;

namespace GonogoFerramAerospaceResearchUplink;

/// <summary>
/// This Uplink's OWN codegen configuration, scoped to its own contract slice and
/// writing into its own client, never into sitrep-sdk.
///
/// <para>One wire type, and it is dense in declared quantities: twelve of
/// <see cref="AeroState"/>'s fifteen properties name a real dimension, so nearly
/// the whole generated interface retypes to <c>Value&lt;&gt;</c>. Two of those
/// tokens are this Uplink's own (<c>kg/m²</c> and <c>W/kg</c>, declared in
/// <see cref="Contract.Units"/>); the catalog check judges this assembly against
/// core's tokens PLUS that class, so a typo in either still stops the
/// build.</para>
/// </summary>
public static class AeroRtConfig
{
    public static void Configure(ConfigurationBuilder builder)
    {
        builder.Global(g => g
            .CamelCaseForProperties()
            .UseModules(true)
            .AutoOptionalProperties());

        // Held in a local for the same reason core's own wirePayloadTypes is:
        // ApplyUnitValueTypes re-enters this exact set, and only a type
        // registered with rtcli may have its properties retyped.
        var wireTypes = new[]
        {
            typeof(AeroState),
        };

        builder.ExportAsInterfaces(wireTypes, c => c.AutoI(false).WithPublicProperties());

        Sitrep.Contract.RtConfig.ApplyUnitValueTypes(builder, wireTypes, valueImportFrom: "@ksp-gonogo/sitrep-sdk");

        var topicMapOut = Environment.GetEnvironmentVariable("SITREP_AERO_TOPICMAP_OUT");
        if (!string.IsNullOrEmpty(topicMapOut))
        {
            Sitrep.Contract.RtConfig.EmitTopicMap(topicMapOut!, typeof(AeroRtConfig).Assembly);
        }

        var unitMapOut = Environment.GetEnvironmentVariable("SITREP_AERO_UNITMAP_OUT");
        if (!string.IsNullOrEmpty(unitMapOut))
        {
            Sitrep.Contract.RtConfig.EmitUnitMap(
                unitMapOut!,
                Environment.GetEnvironmentVariable("SITREP_AERO_UNITJSON_OUT"),
                typeof(AeroRtConfig).Assembly);
        }
    }
}
#endif

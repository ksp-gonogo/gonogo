#if SITREP_CODEGEN
using System;
using Reinforced.Typings.Fluent;

namespace GonogoRp1Uplink;

/// <summary>
/// This Uplink's OWN codegen configuration, scoped to its own contract slice and
/// writing into its own client, never into sitrep-sdk.
///
/// <para>Eleven wire types, eight of which are array Topics, and two unit
/// tokens core has never heard of (<c>bp</c> and <c>confidence</c>, declared in
/// <see cref="Contract.Units"/>). The catalog check judges this assembly against
/// core's tokens PLUS that class, so a typo in either still stops the build.</para>
/// </summary>
public static class Rp1RtConfig
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
            typeof(Rp1CentreEntry),
            typeof(Rp1ComplexEntry),
            typeof(Rp1BuildItemEntry),
            typeof(Rp1WarehouseItemEntry),
            typeof(Rp1PadEntry),
            typeof(Rp1OperationEntry),
            typeof(Rp1ResearchEntry),
            typeof(Rp1Personnel),
            typeof(Rp1Confidence),
            typeof(Rp1ProgramEntry),
            typeof(Rp1ProgramSlots),
        };

        builder.ExportAsInterfaces(wireTypes, c => c.AutoI(false).WithPublicProperties());

        Sitrep.Contract.RtConfig.ApplyUnitValueTypes(builder, wireTypes, valueImportFrom: "@ksp-gonogo/sitrep-sdk");

        var topicMapOut = Environment.GetEnvironmentVariable("SITREP_RP1_TOPICMAP_OUT");
        if (!string.IsNullOrEmpty(topicMapOut))
        {
            Sitrep.Contract.RtConfig.EmitTopicMap(topicMapOut!, typeof(Rp1RtConfig).Assembly);
        }

        var unitMapOut = Environment.GetEnvironmentVariable("SITREP_RP1_UNITMAP_OUT");
        if (!string.IsNullOrEmpty(unitMapOut))
        {
            Sitrep.Contract.RtConfig.EmitUnitMap(
                unitMapOut!,
                Environment.GetEnvironmentVariable("SITREP_RP1_UNITJSON_OUT"),
                typeof(Rp1RtConfig).Assembly);
        }
    }
}
#endif

#if SITREP_CODEGEN
using System;
using Reinforced.Typings.Fluent;

namespace GonogoRealFuelsUplink;

/// <summary>
/// This Uplink's OWN codegen configuration, scoped to its three wire types and
/// pointed at its own client package's <c>__generated__</c> directory. Same
/// shape every other relocated contract slice uses.
///
/// <para>Both <see cref="RealFuelsEngines"/> and <see cref="RealFuelsBoiloff"/>
/// carry a <c>[SitrepTopic]</c>, so <c>EmitTopicMap</c> is wired here and names
/// two channels rather than one. <see cref="RealFuelsEngineEntry"/> carries
/// none: it is the element type of <c>RealFuelsEngines.Engines</c> and is
/// exported so that array has a real type to point at, not because it is a
/// channel of its own.</para>
///
/// <para>The runtime half matters as much as the codegen half. These types live
/// outside <c>Sitrep.Contract</c>, so the SDK's own generated unit map knows
/// nothing about them and cannot hydrate a <c>Value&lt;&gt;</c> at decode time.
/// This Uplink's client feeds the map emitted below back through the SDK's
/// <c>registerTopicUnits</c> at module load (see <c>client/src/topics.ts</c>).
/// </para>
/// </summary>
public static class RealFuelsRtConfig
{
    public static void Configure(ConfigurationBuilder builder)
    {
        builder.Global(g => g
            .CamelCaseForProperties()
            .UseModules(true)
            .AutoOptionalProperties());

        // Held in a local because ApplyUnitValueTypes re-enters this exact set:
        // only a type registered with rtcli may have its properties retyped.
        var wireTypes = new[]
        {
            typeof(RealFuelsEngineEntry),
            typeof(RealFuelsEngines),
            typeof(RealFuelsBoiloff),
        };

        builder.ExportAsInterfaces(wireTypes, c => c.AutoI(false).WithPublicProperties());

        Sitrep.Contract.RtConfig.ApplyUnitValueTypes(builder, wireTypes, valueImportFrom: "@ksp-gonogo/sitrep-sdk");

        var topicMapOut = Environment.GetEnvironmentVariable("SITREP_REALFUELS_TOPICMAP_OUT");
        if (!string.IsNullOrEmpty(topicMapOut))
        {
            Sitrep.Contract.RtConfig.EmitTopicMap(topicMapOut!, typeof(RealFuelsRtConfig).Assembly);
        }

        var unitMapOut = Environment.GetEnvironmentVariable("SITREP_REALFUELS_UNITMAP_OUT");
        if (!string.IsNullOrEmpty(unitMapOut))
        {
            Sitrep.Contract.RtConfig.EmitUnitMap(
                unitMapOut!,
                Environment.GetEnvironmentVariable("SITREP_REALFUELS_UNITJSON_OUT"),
                typeof(RealFuelsRtConfig).Assembly);
        }
    }
}
#endif

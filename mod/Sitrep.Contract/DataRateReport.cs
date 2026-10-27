using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>The rate tiers a <c>set-rate</c> may name.</summary>
public static class DataRateTierNames
{
    /// <summary>The rate every Topic is sent at while nobody asks for more.</summary>
    public const string Base = "base";

    /// <summary>The rate for a Topic a widget plots or models closely, such as a descent.</summary>
    public const string Fast = "fast";

    /// <summary>Every tier, slowest first.</summary>
    public static readonly IReadOnlyList<string> All = new[] { Base, Fast };
}

/// <summary>One rate tier and the samples a game second it stands for now.</summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class DataRateTierEntry
{
    /// <summary>The tier: <c>"base"</c> or <c>"fast"</c>.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "\"base\" | \"fast\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Tier { get; set; } = DataRateTierNames.Base;

    /// <summary>Samples a game second at this tier.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double SamplesPerSecond { get; set; }
}

/// <summary>One Topic sent above the base rate, and the rate it is sent at.</summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class TopicDataRate
{
    /// <summary>The Topic id.</summary>
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";

    /// <summary>The fastest tier any connection asks for on this Topic.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "\"base\" | \"fast\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Tier { get; set; } = DataRateTierNames.Base;

    /// <summary>Samples a game second this Topic is sent at.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double SamplesPerSecond { get; set; }
}

/// <summary>
/// Wire wrapper for <c>system.dataRates</c>: what each rate tier is in samples a
/// game second, and every Topic sent above the base tier now. A Topic not listed
/// is sent at the base tier's rate.
///
/// <para>A rate is in game time. Under time warp the mod sends at most ten
/// samples a real second, so a Topic can arrive with more game time between
/// samples than its rate gives.</para>
/// <internal>
/// Engine-declared like <c>system.channels</c>, so it carries no
/// <see cref="SitrepTopicAttribute"/> and the SDK maps it by hand in
/// <c>topics.ts</c>. The tier table is <c>Sitrep.Host.DataRateTiers</c>.
/// </internal>
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class DataRateReport
{
    /// <summary>Every tier, slowest first. Never null.</summary>
    public List<DataRateTierEntry> Tiers { get; set; } = new List<DataRateTierEntry>();

    /// <summary>Every Topic sent above the base tier, sorted by Topic id. Never null.</summary>
    public List<TopicDataRate> Topics { get; set; } = new List<TopicDataRate>();
}

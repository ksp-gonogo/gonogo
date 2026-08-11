#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Topic names for the source-attributed currency events. Each is a
/// <c>currency.&lt;vesselGuid&gt;.&lt;currency&gt;</c> channel in the
/// <c>ChannelEngine.CurrencyEventPrefix</c> dynamic namespace, so it records under
/// the per-vessel node <c>fleet.&lt;guid&gt;</c> and is revealed at that vessel's own
/// light-time to the observer rather than instantly.
/// </summary>
public static class CurrencyEventTopics
{
    /// <summary>The dynamic-namespace prefix both event families share.</summary>
    public const string Prefix = "currency.";

    /// <summary>Sub-topic (appended after the vessel guid) for a science credit.</summary>
    public const string ScienceField = "science";

    /// <summary>The full topic for one vessel's science credits.</summary>
    public static string Science(string vesselId) => Prefix + vesselId + "." + ScienceField;
}

/// <summary>
/// One science credit, attributed to the vessel that earned it.
///
/// <para>Stock credits science in a lump the moment a transmit stream finishes;
/// Kerbalism accrues it continuously against available data rate. Both land on
/// <c>GameEvents.OnScienceRecieved</c> (KSP's own spelling), which carries the
/// crediting <c>ProtoVessel</c>, so both are attributed the same way with no
/// mod-specific handling: this is a core type, not a Kerbalism one.</para>
///
/// <para>Carried on <c>currency.&lt;guid&gt;.science</c> as a Delayed,
/// ReliableOrdered discrete event, mirroring <c>crash.lastCrash</c>'s shape (a
/// one-shot record with its own <c>ut</c>, replayed to a late subscriber by the
/// reliable lane's keyframe-on-subscribe). It reveals at
/// <c>DelayTo(vantage, fleet.&lt;guid&gt;)</c>, so a probe five light-minutes out
/// reports its transmit five minutes after the fact.</para>
///
/// <para>ADDITIVE to <c>career.status.economy.science</c>, which is untouched and
/// still <see cref="DelayRole.TrueNow"/>: that field gates what tech the operator can
/// afford, so it must stay the number the game will actually gate against (the same
/// principle as the always-show-the-funds-balance rule). These events let a consumer
/// build a separate, honestly-delayed running total; they never replace the gating
/// one.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ScienceCreditEvent
{
    /// <summary>The crediting vessel's persistent id (<c>ProtoVessel.vesselID</c>), the same guid the <c>fleet.</c> namespace keys by.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = string.Empty;

    /// <summary>The crediting vessel's display name at the moment of the credit.</summary>
    [SitrepUnit(Units.Text)]
    public string VesselName { get; set; } = string.Empty;

    /// <summary>Science points credited by this event. Positive; science is monotonic-up outside the ground-side admin conversion, which is not attributed here.</summary>
    [SitrepUnit(Units.Science)]
    public double Amount { get; set; }

    /// <summary>The research subject's id (<c>ScienceSubject.id</c>), e.g. the experiment+body+biome key.</summary>
    [SitrepUnit(Units.Id)]
    public string SubjectId { get; set; } = string.Empty;

    /// <summary>The research subject's human title, e.g. "Crew Report from Kerbin's Shores".</summary>
    [SitrepUnit(Units.Text)]
    public string SubjectTitle { get; set; } = string.Empty;

    /// <summary>Universal Time the credit happened at, the UT its reveal delay is measured from.</summary>
    [SitrepUnit(Units.Seconds)]
    public double Ut { get; set; }
}

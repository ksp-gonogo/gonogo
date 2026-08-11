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

    /// <summary>Sub-topic (appended after the vessel guid) for a reputation loss.</summary>
    public const string ReputationField = "reputation";

    /// <summary>The full topic for one vessel's science credits.</summary>
    public static string Science(string vesselId) => Prefix + vesselId + "." + ScienceField;

    /// <summary>The full topic for one vessel's reputation losses.</summary>
    public static string Reputation(string vesselId) => Prefix + vesselId + "." + ReputationField;
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

/// <summary>
/// One reputation loss, attributed to the vessel it happened aboard.
///
/// <para>NARRATIVE ONLY. This is not a reputation total and must never be read as
/// one. See <see cref="ScienceCreditEvent"/> for the general shape, and the hard
/// constraint below for why this type deliberately carries no absolute figure.</para>
///
/// <para><b>The gating field stays instant, non-negotiably.</b> Reputation GATES:
/// <c>StrategyEntry.RequiredReputation</c> is a strategy's minimum-rep unlock
/// threshold, and contract offer availability keys off the game's real current
/// reputation. A stale-high delayed number sitting where the operator reads it before
/// clicking "Activate Strategy" or "Accept Contract" could show a strategy as
/// available when the game's already-dropped reputation has made it unavailable, and
/// the action would then fail against ground truth the operator had no way to see
/// coming. So <c>career.status.economy.reputation</c> remains TrueNow, instant, and
/// completely untouched: it is the number the game will actually gate against, the
/// same principle as the always-show-the-funds-balance rule. This event is ADDITIVE
/// and carries only a DELTA with no absolute total precisely so it can never be
/// substituted for the gating value, and it must never be co-located with an
/// activate/accept control.</para>
///
/// <para><b>What actually costs reputation in stock.</b> Decompile-confirmed: the only
/// loss-related reputation penalty stock applies is <c>Reputation.OnCrewKilled</c>,
/// which fires on <c>GameEvents.onCrewKilled</c> with
/// <c>TransactionReasons.VesselLoss</c>. Losing an UNCREWED vessel costs no reputation
/// at all, so a probe crashing raises no event here. <see cref="Cause"/> is carried
/// rather than assumed so a mod that penalises other loss classes still fits this
/// shape.</para>
///
/// <para><b>Attribution.</b> <c>ProtoCrewMember.Die()</c> fires <c>onCrewKilled</c> with
/// a NULL <c>EventReport.origin</c>, so the vessel cannot always be read off the event.
/// The producer resolves it from the report's part when present, otherwise from the
/// vessel a destruction detector armed in the same frame, otherwise the active vessel.
/// An unattributable death raises no event rather than being blamed on a guess.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ReputationLossEvent
{
    /// <summary>The vessel the loss happened aboard (<c>Vessel.id</c> as a string GUID), the same guid the <c>fleet.</c> namespace keys by.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = string.Empty;

    /// <summary>The vessel's display name at the moment of the loss.</summary>
    [SitrepUnit(Units.Text)]
    public string VesselName { get; set; } = string.Empty;

    /// <summary>
    /// The reputation CHANGE this loss caused, negative for a penalty. A delta, never a
    /// total: there is deliberately no absolute reputation on this type, so it cannot be
    /// mistaken for the gating figure (see the type's own doc comment).
    /// </summary>
    [SitrepUnit(Units.Reputation)]
    public double Delta { get; set; }

    /// <summary>What caused the loss, e.g. <c>crew-loss</c>. Carried rather than assumed so a non-stock penalty class still fits.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string Cause { get; set; } = string.Empty;

    /// <summary>The kerbals lost, all of those folded into this event's <see cref="Delta"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string[] CrewLost { get; set; } = new string[0];

    /// <summary>Universal Time the loss happened at, the UT its reveal delay is measured from.</summary>
    [SitrepUnit(Units.Seconds)]
    public double Ut { get; set; }
}

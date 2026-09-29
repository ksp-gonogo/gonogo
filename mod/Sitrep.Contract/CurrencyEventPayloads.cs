#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Topic names for the vessel-attributed currency events. Each is a
/// <c>currency.&lt;vesselGuid&gt;.&lt;currency&gt;</c> dynamic topic, recorded
/// against the vessel's <c>fleet.&lt;guid&gt;</c> node and revealed at that
/// vessel's own light-time to the observer rather than instantly.
/// <internal>
/// The namespace is ChannelEngine.CurrencyEventPrefix.
/// </internal>
/// </summary>
/// <category>Channels and emission</category>
public static class CurrencyEventTopics
{
    /// <summary>The dynamic-namespace prefix both event families share.</summary>
    public const string Prefix = "currency.";

    /// <summary>Sub-topic (appended after the vessel guid) for a science
    /// credit.</summary>
    public const string ScienceField = "science";

    /// <summary>Sub-topic (appended after the vessel guid) for a reputation
    /// loss.</summary>
    public const string ReputationField = "reputation";

    /// <summary>The full topic for one vessel's science credits.</summary>
    /// <param name="vesselId">The vessel's <c>Vessel.id</c> GUID, as a string.</param>
    /// <returns><c>currency.&lt;vesselId&gt;.science</c>.</returns>
    public static string Science(string vesselId) => Prefix + vesselId + "." + ScienceField;

    /// <summary>The full topic for one vessel's reputation losses.</summary>
    /// <param name="vesselId">The vessel's <c>Vessel.id</c> GUID, as a string.</param>
    /// <returns><c>currency.&lt;vesselId&gt;.reputation</c>.</returns>
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
/// <para>Carried on <c>currency.&lt;guid&gt;.science</c> as a delayed,
/// reliable, ordered event, the same shape as <c>crash.lastCrash</c>: a one-shot
/// record with its own <c>ut</c>, replayed to a late subscriber. It reveals at
/// the light-time from the observer's vantage to that vessel, so a probe five
/// light-minutes out reports its transmit five minutes after the fact.</para>
///
/// <para>In addition to <c>career.status.balances.science</c>, which it does not
/// change. That field is held at the home command because it gates what tech the
/// operator can afford, so it stays the number the game will gate against,
/// reaching a ground centre at once and a crewed vessel after its path home.
/// These events let a consumer build a separate, delayed running total; they
/// never replace the gating one.</para>
/// </summary>
/// <category>Career</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ScienceCreditEvent
{
    /// <summary>The crediting vessel's persistent id
    /// (<c>ProtoVessel.vesselID</c>), the same guid the <c>fleet.</c> namespace
    /// keys by.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = string.Empty;

    /// <summary>The crediting vessel's display name at the moment of the
    /// credit.</summary>
    [SitrepUnit(Units.Text)]
    public string VesselName { get; set; } = string.Empty;

    /// <summary>Science points credited by this event. Positive; science is
    /// monotonic-up outside the ground-side admin conversion, which is not
    /// attributed here.</summary>
    [SitrepUnit(Units.Science)]
    public double Amount { get; set; }

    /// <summary>The research subject's id (<c>ScienceSubject.id</c>), e.g. the
    /// experiment+body+biome key.</summary>
    [SitrepUnit(Units.Id)]
    public string SubjectId { get; set; } = string.Empty;

    /// <summary>The research subject's human title, e.g. "Crew Report from
    /// Kerbin's Shores".</summary>
    [SitrepUnit(Units.Text)]
    public string SubjectTitle { get; set; } = string.Empty;

    /// <summary>Universal Time the credit happened at, the UT its reveal delay
    /// is measured from.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }
}

/// <summary>
/// One reputation loss, attributed to the vessel it happened aboard.
///
/// <para>Narrative only. This is not a reputation total and must never be read
/// as one. Delivery and delay are as for <see cref="ScienceCreditEvent"/>, on
/// <c>currency.&lt;guid&gt;.reputation</c>.</para>
///
/// <para><b>The gating field is not delayed by this event.</b>
/// Reputation gates: <c>StrategyEntry.RequiredReputation</c> is a strategy's
/// minimum-rep unlock threshold, and contract offer availability keys off the
/// game's real current reputation. A delayed number that is still too high,
/// sitting where the operator reads it before clicking "Activate Strategy" or
/// "Accept Contract" could show a strategy as available when the game's
/// already-dropped reputation has made it unavailable, and the action would
/// then fail against ground truth the operator had no way to see coming. So
/// <c>career.status.balances.reputation</c> is held at the home command, where
/// the gate is decided, and this event does not change it: it is the number the
/// game will gate against. This event carries only a delta with no absolute
/// total, so it can never be substituted for the gating value; do not place it
/// beside an activate or accept control.</para>
///
/// <para><b>What costs reputation in stock.</b> The only loss-related reputation penalty stock applies is
/// <c>Reputation.OnCrewKilled</c>, which fires on
/// <c>GameEvents.onCrewKilled</c> with <c>TransactionReasons.VesselLoss</c>.
/// Losing an UNCREWED vessel costs no reputation at all, so a probe crashing
/// raises no event here. <see cref="Cause"/> is carried rather than assumed so
/// a mod that penalises other loss classes still fits this shape.</para>
///
/// <para><b>Attribution.</b> The vessel is taken from the event's part when
/// KSP supplies one, otherwise from the vessel destroyed in the same frame,
/// otherwise the active vessel. A death that cannot be attributed raises no
/// event rather than being blamed on a guess.</para>
/// <internal>
/// ProtoCrewMember.Die() fires onCrewKilled with a null EventReport.origin,
/// which is why the vessel cannot always be read off the event.
/// </internal>
/// </summary>
/// <category>Career</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ReputationLossEvent
{
    /// <summary>The vessel the loss happened aboard (<c>Vessel.id</c> as a
    /// string GUID), the same guid the <c>fleet.</c> namespace keys
    /// by.</summary>
    [SitrepUnit(Units.Id)]
    public string VesselId { get; set; } = string.Empty;

    /// <summary>The vessel's display name at the moment of the loss.</summary>
    [SitrepUnit(Units.Text)]
    public string VesselName { get; set; } = string.Empty;

    /// <summary>The reputation change this loss caused, negative for a
    /// penalty. A delta, never a total: this type carries no absolute
    /// reputation, so it cannot be mistaken for the gating figure.
    /// </summary>
    [SitrepUnit(Units.Reputation)]
    public double Delta { get; set; }

    /// <summary>What caused the loss. The core mod sends <c>crew-loss</c>; the
    /// field is open so a mod that penalises another kind of loss still
    /// fits.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string Cause { get; set; } = string.Empty;

    /// <summary>The names of the kerbals lost, all of them folded into this event's <see
    /// cref="Delta"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string[] CrewLost { get; set; } = new string[0];

    /// <summary>Universal Time the loss happened at, the UT its reveal delay is
    /// measured from.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }
}

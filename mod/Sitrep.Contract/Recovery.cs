using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The payload for the <c>recovery.lastSummary</c> channel: the most recent
/// vessel recovery in the current save, as KSP's mission recovery dialog
/// reports it. Delivered on the <see cref="Delivery.ReliableOrdered"/> lane,
/// so a late subscriber is sent the last recovery. The recovery-side
/// counterpart of <see cref="CrashReport"/>.
///
/// <para>Published only for a real craft: recovering debris, a flag or a
/// vessel of unknown type publishes nothing. The four breakdown lists can be
/// empty while the totals are present, if KSP's dialog could not be read for
/// them.</para>
/// <internal>
/// Typing-only mirror: Gonogo.KSP.RecoveryUplink flattens the live recovery
/// into a dictionary via Sitrep.Host.Recovery.RecoveryPayload.Build, so
/// JsonWriter only ever sees the dictionary (this type is on
/// WirePayloadCoverageTests' producer-flatten allowlist). The breakdowns are
/// read from MissionRecoveryDialog's private widget lists by reflection, and a
/// failed read yields an empty list rather than failing the publish.
/// </internal>
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("recovery.lastSummary")]
public class RecoveryReport
{
    /// <summary>Universal time of the recovery capture.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double CapturedAtUT { get; set; }

    /// <summary>The recovered vessel's name, as KSP holds it (<c>ProtoVessel.vesselName</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string VesselName { get; set; } = "";

    /// <summary>Where the vessel came down: KSP's own recovery-location string (e.g. <c>"KSC"</c>, <c>"Water"</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string RecoveryLocation { get; set; } = "";

    /// <summary>KSP's own recovery-factor display string (e.g. <c>"100%"</c>), the payout multiplier for landing precision.</summary>
    [SitrepUnit(Units.Text)]
    public string RecoveryFactor { get; set; } = "";

    /// <summary>Science this recovery earned, as KSP's recovery dialog totals it.</summary>
    [SitrepUnit(Units.Science)]
    public double ScienceEarned { get; set; }

    /// <summary>The career's science balance as the recovery dialog reports it. 0 in a save with no science (Sandbox).</summary>
    [SitrepUnit(Units.Science)]
    public double TotalScience { get; set; }

    /// <summary>Funds this recovery earned, after the recovery factor and any strategy modifiers KSP applies to a recovery.</summary>
    [SitrepUnit(Units.Funds)]
    public double FundsEarned { get; set; }

    /// <summary>The career's funds balance as the recovery dialog reports it. 0 in a save with no funds (Science or Sandbox).</summary>
    [SitrepUnit(Units.Funds)]
    public double TotalFunds { get; set; }

    /// <summary>Reputation this recovery earned, after any strategy modifiers KSP applies. Show it only when <see cref="DisplayReputation"/> is true.</summary>
    [SitrepUnit(Units.Reputation)]
    public double ReputationEarned { get; set; }

    /// <summary>The career's reputation as the recovery dialog reports it. Show it only when <see cref="DisplayReputation"/> is true.</summary>
    [SitrepUnit(Units.Reputation)]
    public double TotalReputation { get; set; }

    /// <summary>Whether reputation applies to this save: false in Science and Sandbox, where the reputation fields carry nothing meaningful.</summary>
    [SitrepUnit(Units.Flag)]
    public bool DisplayReputation { get; set; }

    /// <summary>Each science subject recovered, in the order KSP's dialog lists them. Empty when nothing was recovered or the dialog could not be read.</summary>
    public List<RecoveryScienceEntry> ScienceBreakdown { get; set; } = new();

    /// <summary>Each group of recovered parts, in the order KSP's dialog lists them. Empty when the dialog could not be read.</summary>
    public List<RecoveryPartEntry> PartBreakdown { get; set; } = new();

    /// <summary>Each recovered resource, in the order KSP's dialog lists them. Empty when there were none or the dialog could not be read.</summary>
    public List<RecoveryResourceEntry> ResourceBreakdown { get; set; } = new();

    /// <summary>Each crew member aboard at recovery. Empty for an uncrewed vessel or when the dialog could not be read.</summary>
    public List<RecoveryCrewEntry> CrewBreakdown { get; set; } = new();
}

/// <summary>
/// One science subject recovered: an entry of <see cref="RecoveryReport.ScienceBreakdown"/>.
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class RecoveryScienceEntry
{
    /// <summary>The KSP science subject id, e.g. <c>crewReport@KerbinSrfLandedLaunchPad</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string SubjectId { get; set; } = "";

    /// <summary>The subject's display title, as KSP writes it.</summary>
    [SitrepUnit(Units.Text)]
    public string SubjectTitle { get; set; } = "";

    /// <summary>How much data was recovered for this subject.</summary>
    [SitrepUnit(Units.Mits)]
    public double DataGathered { get; set; }

    /// <summary>Science earned for this subject by this recovery.</summary>
    [SitrepUnit(Units.Science)]
    public double ScienceAmount { get; set; }
}

/// <summary>
/// One recovered-part group: an entry of <see cref="RecoveryReport.PartBreakdown"/>.
/// Parts of the same kind and the same recovered value are grouped, hence
/// <see cref="Count"/>. Every value is already scaled by the recovery factor.
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class RecoveryPartEntry
{
    /// <summary>The part's <c>partInfo.name</c> (e.g. <c>"mk1pod.v2"</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string PartName { get; set; } = "";

    /// <summary>The part's <c>partInfo.title</c> (e.g. <c>"Mk1 Command Pod"</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string PartTitle { get; set; } = "";

    /// <summary>How many parts are in this group. At least 1.</summary>
    [SitrepUnit(Units.Count)]
    public int Count { get; set; }

    /// <summary>The recovered dry value of one part in the group, excluding its resources.</summary>
    [SitrepUnit(Units.Funds)]
    public double PartValue { get; set; }

    /// <summary>The recovered value of the resources the group's parts held, summed over the group.</summary>
    [SitrepUnit(Units.Funds)]
    public double ResourcesValue { get; set; }

    /// <summary>The group's recovered dry value: <see cref="PartValue"/> times <see cref="Count"/>. Does not include <see cref="ResourcesValue"/>.</summary>
    [SitrepUnit(Units.Funds)]
    public double TotalValue { get; set; }
}

/// <summary>
/// One recovered-resource group: an entry of <see cref="RecoveryReport.ResourceBreakdown"/>.
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class RecoveryResourceEntry
{
    /// <summary>The resource's KSP definition name, e.g. <c>LiquidFuel</c>.</summary>
    [SitrepUnit(Units.Text)]
    public string ResourceName { get; set; } = "";

    /// <summary>How much of the resource was recovered, summed over every part that held it.</summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double Amount { get; set; }

    /// <summary>The recovered value of one unit of the resource, already scaled by the recovery factor.</summary>
    [SitrepUnit(Units.Funds)]
    public double UnitValue { get; set; }

    /// <summary>The recovered value of the whole amount: <see cref="UnitValue"/> times <see cref="Amount"/>.</summary>
    [SitrepUnit(Units.Funds)]
    public double TotalValue { get; set; }
}

/// <summary>
/// One crew member aboard at recovery: an entry of <see cref="RecoveryReport.CrewBreakdown"/>.
/// </summary>
/// <category>Flights</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class RecoveryCrewEntry
{
    /// <summary>The kerbal's name, which is also their roster key.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>The kerbal's career trait (e.g. <c>"Pilot"</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string Trait { get; set; } = "";

    /// <summary>Whether the kerbal is a tourist, who earns no experience.</summary>
    [SitrepUnit(Units.Flag)]
    public bool IsTourist { get; set; }

    /// <summary>Experience points this flight added.</summary>
    [SitrepUnit(Units.Count)]
    public double XpGained { get; set; }

    /// <summary>How many experience levels this flight added: <see cref="NewLevel"/> minus the level before.</summary>
    [SitrepUnit(Units.Count)]
    public int LevelsGained { get; set; }

    /// <summary>The kerbal's experience level after this flight, 0 to 5 in stock.</summary>
    [SitrepUnit(Units.Count)]
    public int NewLevel { get; set; }
}

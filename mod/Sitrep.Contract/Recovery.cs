using System.Collections.Generic;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The payload for the <c>recovery.lastSummary</c> channel — a single "last
/// notable recovery" record for the current save, delivered on the
/// <see cref="Delivery.ReliableOrdered"/> event lane. Mirrors the wire shape
/// the consumer already parses (<c>FlightOutcomeBanner.parseRecovery</c>)
/// field-for-field, the recovery-side counterpart of <see cref="CrashReport"/>.
///
/// <para>TYPING/codegen marker only. The producer (<c>Gonogo.KSP.RecoveryUplink</c>)
/// hand-flattens the live-KSP recovery into a <c>Dictionary&lt;string, object?&gt;</c>
/// via <c>Sitrep.Host.Recovery.RecoveryPayload.Build</c> before publishing, so
/// <see cref="Sitrep.Core.Serialization.JsonWriter"/> only ever sees the
/// dictionary — this POCO exists solely so the TS SDK has a concrete payload
/// type to name (it is on <c>WirePayloadCoverageTests</c>'s producer-flatten
/// allowlist for exactly that reason).</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("recovery.lastSummary")]
public class RecoveryReport
{
    /// <summary>Universal time of the recovery capture.</summary>
    public double CapturedAtUT { get; set; }

    public string VesselName { get; set; } = "";

    /// <summary>Where the vessel came down — KSP's own recovery-location string (e.g. <c>"KSC"</c>, <c>"Water"</c>).</summary>
    public string RecoveryLocation { get; set; } = "";

    /// <summary>KSP's own recovery-factor display string (e.g. <c>"100%"</c>) — the payout multiplier for landing precision.</summary>
    public string RecoveryFactor { get; set; } = "";

    public double ScienceEarned { get; set; }

    public double TotalScience { get; set; }

    public double FundsEarned { get; set; }

    public double TotalFunds { get; set; }

    public double ReputationEarned { get; set; }

    public double TotalReputation { get; set; }

    /// <summary>Whether reputation applies to this save (off in Science/Sandbox) — gates the reputation row client-side.</summary>
    public bool DisplayReputation { get; set; }

    public List<RecoveryScienceEntry> ScienceBreakdown { get; set; } = new();

    public List<RecoveryPartEntry> PartBreakdown { get; set; } = new();

    public List<RecoveryResourceEntry> ResourceBreakdown { get; set; } = new();

    public List<RecoveryCrewEntry> CrewBreakdown { get; set; } = new();
}

/// <summary>
/// One science subject recovered — an entry of <see cref="RecoveryReport.ScienceBreakdown"/>.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class RecoveryScienceEntry
{
    public string SubjectId { get; set; } = "";

    public string SubjectTitle { get; set; } = "";

    public double DataGathered { get; set; }

    public double ScienceAmount { get; set; }
}

/// <summary>
/// One recovered-part group — an entry of <see cref="RecoveryReport.PartBreakdown"/>.
/// Identically-named parts are grouped, hence <see cref="Count"/>.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class RecoveryPartEntry
{
    /// <summary>The part's <c>partInfo.name</c> (e.g. <c>"mk1pod.v2"</c>).</summary>
    public string PartName { get; set; } = "";

    /// <summary>The part's <c>partInfo.title</c> (e.g. <c>"Mk1 Command Pod"</c>).</summary>
    public string PartTitle { get; set; } = "";

    public int Count { get; set; }

    public double PartValue { get; set; }

    public double ResourcesValue { get; set; }

    public double TotalValue { get; set; }
}

/// <summary>
/// One recovered-resource group — an entry of <see cref="RecoveryReport.ResourceBreakdown"/>.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class RecoveryResourceEntry
{
    public string ResourceName { get; set; } = "";

    public double Amount { get; set; }

    public double UnitValue { get; set; }

    public double TotalValue { get; set; }
}

/// <summary>
/// One crew member aboard at recovery — an entry of <see cref="RecoveryReport.CrewBreakdown"/>.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class RecoveryCrewEntry
{
    public string Name { get; set; } = "";

    /// <summary>The kerbal's career trait (e.g. <c>"Pilot"</c>).</summary>
    public string Trait { get; set; } = "";

    public bool IsTourist { get; set; }

    public double XpGained { get; set; }

    public int LevelsGained { get; set; }

    public int NewLevel { get; set; }
}

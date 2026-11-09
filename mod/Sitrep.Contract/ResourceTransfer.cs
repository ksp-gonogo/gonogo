using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Start moving one resource between tanks of the active vessel
/// (<c>vessel.resource.transfer.start</c>), at the pace of the game's own
/// transfer: each destination fills at a twentieth of its capacity per second of
/// game time. Tanks are named by part flight id, the same id <c>vessel.parts</c>
/// carries.
///
/// <para>Set exactly one of <see cref="UntilFull"/> or <see cref="Amount"/>.
/// <see cref="FromPartIds"/> and <see cref="ToPartIds"/> must both be non-empty
/// and share no part, or the command fails with
/// <see cref="CommandErrorCode.Range"/>. A tank that cannot take part, out of
/// <c>vessel.transferReach</c> for example, fails with
/// <see cref="CommandErrorCode.CapabilityMismatch"/>; a tank already in a running
/// transfer of the resource fails with
/// <see cref="CommandErrorCode.WrongState"/>.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.resource.transfer.start", Payload = typeof(ResourceTransferStarted), Summary = "Move a resource between tanks of the vessel.")]
public class ResourceTransferStartArgs
{
    /// <summary>The resource's name, as the keys of <c>vessel.parts</c> resources give it.</summary>
    [SitrepUnit(Units.Text)]
    public string Resource { get; set; } = "";

    /// <summary>The tanks to draw from, as part flight ids.</summary>
    [SitrepUnit(Units.Id)]
    public List<string> FromPartIds { get; set; } = new();

    /// <summary>The tanks to fill, as part flight ids.</summary>
    [SitrepUnit(Units.Id)]
    public List<string> ToPartIds { get; set; } = new();

    /// <summary>Run until the destinations are full or the sources are empty.</summary>
    [SitrepUnit(Units.Flag)]
    public bool UntilFull { get; set; }

    /// <summary>The amount to move. Required when <see cref="UntilFull"/> is false, refused when it is true.</summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double? Amount { get; set; }
}

/// <summary>What <c>vessel.resource.transfer.start</c> answers with.</summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ResourceTransferStarted
{
    /// <summary>The new transfer's <see cref="ResourceTransferJob.Id"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string TransferId { get; set; } = "";
}

/// <summary>
/// Stop one resource transfer, or every one on the vessel
/// (<c>vessel.resource.transfer.stop</c>). A transfer that has already ended
/// answers success with no change. An id that was never issued fails with
/// <see cref="CommandErrorCode.NotFound"/>.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("vessel.resource.transfer.stop", Summary = "Stop a resource transfer, or every one.")]
public class ResourceTransferStopArgs
{
    /// <summary>Stop every running transfer. <see cref="TransferId"/> must then be absent.</summary>
    [SitrepUnit(Units.Flag)]
    public bool All { get; set; }

    /// <summary>The transfer to stop. Required when <see cref="All"/> is false.</summary>
    [SitrepUnit(Units.Id)]
    public string? TransferId { get; set; }
}

/// <summary>Whether a <see cref="ResourceTransferJob"/> is still moving.</summary>
/// <category>Parts</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum TransferJobState
{
    /// <summary>Moving now.</summary>
    Running = 0,
    /// <summary>Finished; <see cref="ResourceTransferJob.EndReason"/> says why.</summary>
    Ended = 1,
}

/// <summary>Why a <see cref="ResourceTransferJob"/> ended.</summary>
/// <category>Parts</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum TransferEndReason
{
    /// <summary>The requested amount has moved.</summary>
    AmountMoved = 0,
    /// <summary>Every destination is full.</summary>
    DestinationsFull = 1,
    /// <summary>Every source is empty.</summary>
    SourcesEmpty = 2,
    /// <summary>A stop command arrived.</summary>
    Stopped = 3,
    /// <summary>No source or no destination remains on the vessel.</summary>
    PartsLeft = 4,
    /// <summary>The active vessel no longer holds the transfer's tanks.</summary>
    VesselLeft = 5,
    /// <summary>The game left the flight scene.</summary>
    SceneLeft = 6,
}

/// <summary>One resource transfer, running or recently ended.</summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ResourceTransferJob
{
    /// <summary>Identifies this transfer to <c>vessel.resource.transfer.stop</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>The resource's name.</summary>
    [SitrepUnit(Units.Text)]
    public string Resource { get; set; } = "";

    /// <summary>The tanks drawn from, as part flight ids.</summary>
    [SitrepUnit(Units.Id)]
    public List<string> FromPartIds { get; set; } = new();

    /// <summary>The tanks being filled, as part flight ids.</summary>
    [SitrepUnit(Units.Id)]
    public List<string> ToPartIds { get; set; } = new();

    /// <summary>True when it runs until the destinations are full or the sources empty.</summary>
    [SitrepUnit(Units.Flag)]
    public bool UntilFull { get; set; }

    /// <summary>The amount asked for. Null exactly when <see cref="UntilFull"/> is true.</summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double? Requested { get; set; }

    /// <summary>The amount the destinations have taken so far.</summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double Moved { get; set; }

    /// <summary>Total into all destinations per second of game time at the last step. Null once ended.</summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? Rate { get; set; }

    /// <summary>Whether it is still moving.</summary>
    [SitrepUnit(Units.Enumeration)]
    public TransferJobState State { get; set; }

    /// <summary>Why it ended. Null while running.</summary>
    [SitrepUnit(Units.Enumeration)]
    public TransferEndReason? EndReason { get; set; }

    /// <summary>The universal time it started.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double StartedUt { get; set; }

    /// <summary>The universal time it ended. Null while running.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? EndedUt { get; set; }
}

/// <summary>
/// The active vessel's resource transfers: running ones, then the last eight
/// ended, newest first. Empty when there are none.
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.resourceTransfers", DisplayName = "Resource transfers")]
public class ResourceTransfers
{
    /// <summary>Running transfers, then recently ended ones.</summary>
    public List<ResourceTransferJob> Transfers { get; set; } = new();

    /// <summary>Provenance.</summary>
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>One group of parts that can draw from each other by crossfeed.</summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CrossfeedSet
{
    /// <summary>Identifies this set within <see cref="TransferReach.Sets"/>.</summary>
    [SitrepUnit(Units.Id)]
    public int Id { get; set; }

    /// <summary>The parts in this set, as flight ids.</summary>
    [SitrepUnit(Units.Id)]
    public List<string> PartIds { get; set; } = new();
}

/// <summary>Which set one tank can draw from.</summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class TankReach
{
    /// <summary>The tank's part, as a flight id.</summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>The <see cref="CrossfeedSet.Id"/> this tank can draw from. Null when it can draw only from itself.</summary>
    [SitrepUnit(Units.Id)]
    public int? DrawsFromSet { get; set; }
}

/// <summary>
/// Which tanks of the active vessel can exchange each resource. When
/// <see cref="ObeysCrossfeed"/> is false any two transferable tanks of a resource
/// can exchange. When it is true, a resource absent from <see cref="Resources"/>
/// is vessel-wide; otherwise a destination can take from a source only when the
/// set the destination draws from contains the source. Sets are directional, so
/// the rule is not symmetric.
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.transferReach", DisplayName = "Transfer reach")]
public class TransferReach
{
    /// <summary>Whether this save makes a transfer obey crossfeed.</summary>
    [SitrepUnit(Units.Flag)]
    public bool ObeysCrossfeed { get; set; }

    /// <summary>Each distinct crossfeed set once.</summary>
    public List<CrossfeedSet> Sets { get; set; } = new();

    /// <summary>By resource name, for resources whose flow limits reach.</summary>
    public Dictionary<string, List<TankReach>> Resources { get; set; } = new();

    /// <summary>Provenance.</summary>
    public PayloadMeta Meta { get; set; } = new();
}

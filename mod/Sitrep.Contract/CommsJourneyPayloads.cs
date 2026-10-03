using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>What one journey report says happened to a command, or to a cancel.</summary>
/// <category>Comms</category>
#if SITREP_CODEGEN
[TsEnum]
#endif
[SitrepContract]
public enum JourneyEventKind
{
    /// <summary>A node is holding the command for its next window; <see cref="CommsJourneyEvent.UntilUt"/> is when it predicts the command will leave. A node also reports this when a command it sent went unanswered and is its to send again.</summary>
    Held = 0,

    /// <summary>A node that had held the command sent it on; <see cref="CommsJourneyEvent.UntilUt"/> is when that node expects the light to land at its next node.</summary>
    Departed = 1,

    /// <summary>The command reached its expiry where it was and was deleted there.</summary>
    Expired = 2,

    /// <summary>A cancel stopped the command at the node reporting.</summary>
    Cancelled = 3,

    /// <summary>The command reached the craft and waits for earlier lane numbers, named in <see cref="CommsJourneyEvent.Missing"/>.</summary>
    Waiting = 4,

    /// <summary>The craft discarded the command because its lane number had already settled; <see cref="CommsJourneyEvent.Detail"/> says how.</summary>
    Discarded = 5,

    /// <summary>A cancel reached the craft before the command; the craft refuses the command whenever it arrives.</summary>
    CancelStored = 6,

    /// <summary>A cancel reached the craft after the command ran; <see cref="CommsJourneyEvent.UntilUt"/> is when it ran.</summary>
    CancelLate = 7,

    /// <summary>A cancel reached a node after the command left it, and follows it on.</summary>
    CancelLateHere = 8,

    /// <summary>The command ran at the craft; its result travels on the command's own reply.</summary>
    Ran = 9,
}

/// <summary>
/// Journey reports for this vantage's commands in the current timeline: where
/// each was held, sent on, stopped or run, as reports from those nodes arrive
/// back here.
///
/// <para>Every report has already travelled from the node that made it to this
/// centre, at light speed and through any holds of its own, so a report arrives
/// on this topic when this centre could first know it. Order a command's events
/// by <see cref="CommsJourneyEvent.AtUt"/>, not by arrival: two reports from
/// different nodes travel different routes. A terminal event is never undone by
/// an earlier one arriving late.</para>
///
/// <para>A report made here, by this centre, says only what this centre could
/// know. It reports a command held while its own plan says the way is shut, and
/// sent on when its plan says the way is open, whatever the far end is doing;
/// and it reports a command that went unanswered only once twice the light time
/// it expected has passed.</para>
///
/// <para>Each session receives only its own vantage's events.</para>
/// <internal>
/// Delivered through Courier.RecordAddressed to the sending centre alone, valid
/// at the report's AtUt and arriving when the report landed there: a Delayed
/// channel inside the delay machinery, never TrueNow.
/// </internal>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
[SitrepTopic("comms.journey")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsJourney
{
    /// <summary>The timeline these events belong to; events from an earlier timeline are dropped.</summary>
    [SitrepUnit(Units.Count)]
    public long Epoch { get; set; }

    /// <summary>Every event received so far in this timeline, oldest arrival first, up to a bounded number.</summary>
    public List<CommsJourneyEvent> Events { get; set; } = new List<CommsJourneyEvent>();
}

/// <summary>One journey report.</summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsJourneyEvent
{
    /// <summary>The report's own id.</summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>The command it is about, as its <c>system.uplink.pending</c> <see cref="PendingUplink.Id"/>, or for a copy sent again, the <see cref="UplinkActionReply.Id"/> that send again returned; for a cancel's events, the cancel's id.</summary>
    [SitrepUnit(Units.Id)]
    public string About { get; set; } = "";

    /// <summary>The craft the command's lane runs to.</summary>
    [SitrepUnit(Units.Id)]
    public string Craft { get; set; } = "";

    /// <summary>The lane number it concerns.</summary>
    [SitrepUnit(Units.Count)]
    public long LaneSeq { get; set; }

    /// <summary>What happened.</summary>
    [SitrepUnit(Units.Enumeration)]
    public JourneyEventKind Kind { get; set; }

    /// <summary>The node that made the report, as a roster or vessel id.</summary>
    [SitrepUnit(Units.Id)]
    public string At { get; set; } = "";

    /// <summary>When the thing it reports happened, at that node.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double AtUt { get; set; }

    /// <summary>For a hold, when the node predicts the command will leave; for a departure, when it lands; for a late cancel, when the command ran or left. Null otherwise.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? UntilUt { get; set; }

    /// <summary>A short reason, for a discard or a late cancel. Null otherwise.</summary>
    [SitrepUnit(Units.Text)]
    public string? Detail { get; set; }

    /// <summary>For a waiting report, the lane numbers the craft is still missing. Empty otherwise.</summary>
    [SitrepUnit(Units.Count)]
    public List<long> Missing { get; set; } = new List<long>();
}

/// <summary>
/// Cancels a held or travelling command: its lane number alone, or it and every
/// later number this centre had sent on the lane when it was pressed. A command
/// this centre is still holding stops at once; for one it has sent, a cancel
/// goes to the craft, stopping the command wherever it is held and refusing it
/// at the craft if it arrives there first. What it stopped arrives as journey
/// reports.
///
/// <para>The reply says the cancel was sent, never that the command was stopped.
/// A command sent less than twice its light time ago may have been lost on the
/// way, in which case it is still this centre's, but the centre cannot know that
/// yet, so the cancel is sent after it all the same and the command is reported
/// cancelled here only once it is known to have come back.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand(
    "system.uplink.cancel",
    Result = typeof(UplinkActionReply),
    Delay = DelayRole.TrueNow)]
public class UplinkCancelRequest
{
    /// <summary>The timeline the command was sent in; a cancel naming another timeline is refused.</summary>
    [SitrepUnit(Units.Count)]
    public long Epoch { get; set; }

    /// <summary>The craft its lane runs to, as <see cref="PendingUplink.Craft"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string Craft { get; set; } = "";

    /// <summary>Its lane number, as <see cref="PendingUplink.LaneSeq"/>.</summary>
    [SitrepUnit(Units.Count)]
    public long LaneSeq { get; set; }

    /// <summary>Whether to cancel every later number on the lane too, up to the newest this centre has sent.</summary>
    [SitrepUnit(Units.Flag)]
    public bool AndBehind { get; set; }
}

/// <summary>
/// Sends a held or overdue command again in its own place on its lane: a new
/// copy with the same lane number, which must arrive before the commands behind
/// it stop waiting for it. Whichever copy reaches the craft first runs; any other
/// is discarded.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand(
    "system.uplink.resend",
    Result = typeof(UplinkActionReply),
    Delay = DelayRole.TrueNow)]
public class UplinkResendRequest
{
    /// <summary>The timeline the command was sent in; a send again naming another timeline is refused.</summary>
    [SitrepUnit(Units.Count)]
    public long Epoch { get; set; }

    /// <summary>The craft its lane runs to.</summary>
    [SitrepUnit(Units.Id)]
    public string Craft { get; set; } = "";

    /// <summary>Its lane number.</summary>
    [SitrepUnit(Units.Count)]
    public long LaneSeq { get; set; }
}

/// <summary>What a cancel or a send again did at this centre.</summary>
/// <category>Command results</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class UplinkActionReply
{
    /// <summary>For a cancel, the last lane number it covers: more than the button counted when another screen sent on the lane meanwhile.</summary>
    [SitrepUnit(Units.Count)]
    public long ThroughSeq { get; set; }

    /// <summary>For a send again, the new copy's id, which its journey reports name; empty for a cancel.</summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>When the cancel or copy expires.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double ExpiresAtUt { get; set; }
}

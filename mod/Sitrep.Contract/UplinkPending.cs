using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One command sent and believed still in flight, an entry on
/// <c>system.uplink.pending</c>.
///
/// <para>An entry carries only what the sending centre knew when it sent the
/// command: what it sent, when, and what it predicted. It never says whether
/// the craft received or ran the command, or anything about the craft's
/// state. Show entries as in flight until they leave the queue, never as
/// confirmation that something happened aboard.</para>
/// <internal>
/// <c>Sitrep.Host.Tests.UplinkPendingShapeTests</c> pins the field set, with
/// no additive carve-out (unlike <c>ContractShapeGateTests</c>). The topic
/// constant is <c>ChannelEngine.UplinkPendingTopic</c>.
/// </internal>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PendingUplink
{
    /// <summary>
    /// Gonogo's own id for this dispatch, unique within this queue.
    ///
    /// <para>Not the <c>requestId</c> a client put on its
    /// <c>command-request</c>, and unrelated to it: the two are counted
    /// separately and can hold the same value. A client looking for its own
    /// dispatch matches on <see cref="ClientRequestId"/> instead.</para>
    /// <internal>
    /// ChannelEngine.NextRequestId(), minted in ProcessDispatchCommand and passed
    /// to Courier.DispatchCommand; the socket handler's req.RequestId reaches the
    /// job only as <see cref="ClientRequestId"/>.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>
    /// The <c>requestId</c> the dispatching client put on its <c>command-request</c>,
    /// carried through verbatim, so that client can find its own entry in this queue.
    /// Empty when the dispatch did not come over a client connection.
    ///
    /// <para>Only the dispatching client's own choice, so two clients can pick the
    /// same value: match it together with <see cref="Command"/>, and read it as
    /// "this entry is mine" only on the connection that sent the request.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string ClientRequestId { get; set; } = "";

    /// <summary>Wire command name (e.g. <c>kos.run</c>).</summary>
    [SitrepUnit(Units.Id)]
    public string Command { get; set; } = "";

    /// <summary>Caller-supplied envelope label, carried verbatim; empty when none was given, in which case show <see cref="Command"/> instead.</summary>
    [SitrepUnit(Units.Text)]
    public string Label { get; set; } = "";

    /// <summary>
    /// Which part or terminal the command was addressed to, as an opaque
    /// slash-separated route such as <c>kos/7</c>, so a widget can show only
    /// the entries for one part. Empty when the command was not addressed to
    /// one.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";

    /// <summary>
    /// The id of the command centre that sent this command, as on
    /// <c>commandCentre.roster</c>.
    /// <internal>
    /// Read from <c>job.Vantage</c> at dispatch.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Vantage { get; set; } = "";

    /// <summary>When the command was sent, in UT.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double DispatchedAt { get; set; }

    /// <summary>
    /// One-way signal delay in seconds as it stood when the command was sent,
    /// not updated as the delay changes. For a command on a lane it is how long the sending centre's
    /// own plan expects it to take to reach the craft, waits included, and
    /// <c>null</c> when that plan knows no route: the centre has no figure to
    /// give, which is not a figure of zero.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? OneWaySeconds { get; set; }

    /// <summary>
    /// The scalar this command asked for, when its command is one half of a
    /// declared <see cref="SitrepControlChannelAttribute"/> channel: a throttle
    /// setting, a switch as 1 or 0, an SAS mode as its ordinal. Absent (the key
    /// is left out, never written as null) for every other command, and for a
    /// channel command whose args did not carry the value, so a zero throttle
    /// and an unknown value never look the same.
    ///
    /// <para>It is what the centre sent, not anything the craft did. Use it to
    /// show which SAS mode is in flight rather than only that something is, or
    /// to mark one control in a group apart from the rest. A second command
    /// centre or a station screen has no other way to learn the value. The
    /// channel's declared args type says how to read the number back; see
    /// <see cref="ControlChannelDescriptor"/>.</para>
    /// <internal>
    /// One numeric field rather than a variant, because the channel's args
    /// type already carries how to read it. A commanded value is dispatch-time
    /// knowledge, so it does not break the class's no-vessel-state rule.
    /// </internal>
    /// </summary>
    // JsonWriter.AppendPendingUplink omits the key on !HasValue, so a zero throttle and an unknown value never arrive looking the same.
    [SitrepUnit(Units.NotApplicable)]
    [SitrepOmittedWhenNull]
    public double? CommandedValue { get; set; }

    /// <summary>
    /// Its position on its lane: every delayed command one centre sends to one
    /// craft runs in this order. Null for a command on no lane (a control-channel
    /// write, or one not addressed to a craft).
    /// </summary>
    [SitrepUnit(Units.Count)]
    public long? LaneSeq { get; set; }

    /// <summary>The craft the lane runs to, as a <c>"vessel:&lt;guid&gt;"</c> id. Null for a command on no lane.</summary>
    [SitrepUnit(Units.Id)]
    public string? Craft { get; set; }

    /// <summary>When it is deleted wherever it is, if it has not run: an hour after it was sent, or an earlier deadline it carries. Null for a command on no lane.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? ExpiresAtUt { get; set; }

    /// <summary>
    /// When the centre predicts it will reach the craft, from the route its own
    /// plan gave at dispatch. Null when its plan predicted no route. Like every
    /// prediction here it is what the centre believed when it sent, made from
    /// what it had heard, and says nothing of what the far end was really doing.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? PredictedArrivalUt { get; set; }

    /// <summary>When the centre predicts its reply will come back, from the routes at dispatch. Null when no route was predicted.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? PredictedReplyUt { get; set; }

    /// <summary>Where the centre predicts it will first wait for a window, as a node id; null when it is predicted to go straight through, or no route was predicted.</summary>
    [SitrepUnit(Units.Id)]
    public string? PredictedHeldAt { get; set; }

    /// <summary>
    /// What the centre told the sender when it accepted this command, as a
    /// sentence to show the operator: a continuous input that its plan says
    /// would have to wait at <see cref="PredictedHeldAt"/>, where it is lost.
    /// The same text the sender's <c>command-accepted</c> carries, here so every
    /// screen at the centre can show it. Null when the centre had nothing to
    /// say.
    /// <internal>
    /// A dispatch-time prediction from the sending centre's own plan, like the
    /// other predictions on this entry, so it reads no vessel state.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Warning { get; set; }

    /// <summary>When it is predicted to leave <see cref="PredictedHeldAt"/>. Null with it.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? PredictedHeldUntilUt { get; set; }

    /// <summary>
    /// When it is predicted to reach <see cref="PredictedHeldAt"/>, where it
    /// waits until <see cref="PredictedHeldUntilUt"/>. With
    /// <see cref="DispatchedAt"/> and <see cref="PredictedArrivalUt"/> it places
    /// the wait along the way to the craft. Null with <see cref="PredictedHeldAt"/>,
    /// and when the prediction was not read from a plan.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? PredictedHeldFromUt { get; set; }

    /// <summary>The last moment a cancel sent from this centre is predicted to stop it: at a node holding it or at the craft before it runs. Null when nothing is predicted to stop it.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? CancelDeadlineUt { get; set; }

    /// <summary>
    /// When the centre first found its reply overdue: the reply was predicted to
    /// be home by now, no wait for a window was predicted, and nothing has come.
    /// The command may have run and its answer be unable to come home, so this is
    /// news of silence, not of failure, and the entry stays until its reply, a
    /// report or its expiry settles it; one sent straight to the craft stays
    /// until its reply lands or the link to the craft is down. Null while the
    /// reply is not yet due, or is predicted to wait.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? ReplyOverdueUt { get; set; }

    /// <summary>How many copies of its lane number have been sent: 1, or more after a send again.</summary>
    [SitrepUnit(Units.Count)]
    public int Attempts { get; set; } = 1;

    /// <summary>
    /// The commands this entry stands for. A command sent alone lists its own
    /// <see cref="Id"/>. A group sent with <c>command-group</c> is one entry on
    /// one lane number and lists the <c>requestId</c> of each member as the
    /// client sent it, in the order they run, with the first also on
    /// <see cref="ClientRequestId"/>; its <see cref="Label"/> joins the members'
    /// labels.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public List<string> Members { get; set; } = new List<string>();
}

/// <summary>
/// One command that was on <c>system.uplink.pending</c> and came back refused
/// by the game, failed, or answered after the centre had found its reply
/// overdue, an entry of <see cref="PendingUplinkQueue.Settled"/>. Every screen
/// at the sending command centre reads it, so each can say what became of a
/// command another screen sent. A command answered on time leaves no entry
/// here: its leaving the queue says so, and its effect shows in the readings.
/// <internal>
/// Kept by ChannelEngine for a while after the reply reaches the centre, so a
/// screen that samples the queue now and then still sees it. A client takes
/// its own dispatch's outcome from its own reply and skips its own entries here.
/// </internal>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SettledUplink
{
    /// <summary>Gonogo's own id for the dispatch, the <see cref="PendingUplink.Id"/> it had on the queue.</summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>
    /// The <c>requestId</c> the dispatching client put on its
    /// <c>command-request</c>, as on <see cref="PendingUplink.ClientRequestId"/>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string ClientRequestId { get; set; } = "";

    /// <summary>Wire command name (e.g. <c>vessel.control.setRcs</c>).</summary>
    [SitrepUnit(Units.Id)]
    public string Command { get; set; } = "";

    /// <summary>Caller-supplied envelope label, carried verbatim; empty when none was given.</summary>
    [SitrepUnit(Units.Text)]
    public string Label { get; set; } = "";

    /// <summary>The part or terminal the command was addressed to, as on <see cref="PendingUplink.Topic"/>; empty when none.</summary>
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";

    /// <summary>The id of the command centre that sent the command, as on <c>commandCentre.roster</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string Vantage { get; set; } = "";

    /// <summary>When the outcome reached the sending command centre.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double SettledAt { get; set; }

    /// <summary>
    /// What became of the command: <c>refused</c> when the game refused it,
    /// with <see cref="Code"/> a refusal code; <c>failed</c> when the mod
    /// answered with a fault, with <see cref="Code"/> a fault code; or
    /// <c>answered</c> when it ran and its reply came after the centre had found
    /// it overdue, with <see cref="Code"/> empty.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Outcome { get; set; } = "";

    /// <summary>
    /// The refusal's root code, or the fault's code, as the command's own
    /// reply carries it; empty for <c>answered</c>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Code { get; set; } = "";

    /// <summary>The refinement's id when a refusal was more specific than <see cref="Code"/>; null otherwise.</summary>
    [SitrepUnit(Units.Id)]
    public string? Reason { get; set; }

    /// <summary>A refusal in the game's own words, when the game gave any; null otherwise.</summary>
    [SitrepUnit(Units.Text)]
    public string? Detail { get; set; }

    /// <summary>What the mod said of a fault, as a sentence to show; null otherwise.</summary>
    [SitrepUnit(Units.Text)]
    public string? Message { get; set; }
}

/// <summary>The <c>system.uplink.pending</c> payload: the whole queue, sent in full each time.</summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PendingUplinkQueue
{
    /// <summary>
    /// Every command still believed in flight that this session may know of, in
    /// no guaranteed order: the ones sent from this connection's command centre,
    /// and the ones this connection sent from another. Empty, never null, when nothing is
    /// pending.
    /// </summary>
    public List<PendingUplink> Pending { get; set; } = new List<PendingUplink>();

    /// <summary>
    /// The commands this session may know of that left <see cref="Pending"/>
    /// refused, failed or answered late lately, oldest first, by the same rule as
    /// <see cref="Pending"/>. Each stays for a few minutes of game time, and
    /// only the latest few are kept. Empty, never null, when there are none.
    /// </summary>
    public List<SettledUplink> Settled { get; set; } = new List<SettledUplink>();
}

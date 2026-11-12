#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// Who is speaking, as the speaking client describes itself. A speaker is the
/// screen sending a message, and a listener is a command centre in the group it
/// is sent to. Shown to listeners and trusted for nothing else: the vantage a
/// thing was said from, the command centre its connection works from, is always
/// the one the mod resolved for the connection that said it, never a field
/// here.
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommcastAuthor
{
    /// <summary>The name a listener reads beside what was said.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>The speaking device's own stable key, so a screen can recognise its own words coming back.</summary>
    [SitrepUnit(Units.Id)]
    public string StationKey { get; set; } = "";

    /// <summary>Which end of the light-path the speaker sits at, in the client's own vocabulary (<c>"pilot"</c>, <c>"mission-control"</c>).</summary>
    [SitrepUnit(Units.Id)]
    public string Seat { get; set; } = "";
}

/// <summary>
/// Start a group, a set of command centres
/// sharing one thread for messages and radio. A centre is a command centre, as
/// listed on <c>commandCentre.roster</c>. The command centre sending this is
/// always a member, named here or not.
///
/// <para>Never delayed on the way up. What is said crosses once, from the
/// speaker to each listener at that pair's signal delay, and the mod times that
/// crossing on the way down; delaying the command as well would count the gap
/// twice.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("commcast.group.open", Delay = DelayRole.TrueNow)]
public class CommcastGroupOpenArgs
{
    /// <summary>Minted by the client, so a resend opens nothing twice. Refused if another group already holds it.</summary>
    [SitrepUnit(Units.Id)]
    public string GroupId { get; set; } = "";

    /// <summary>Every centre the group starts with, as <c>commandCentre.roster</c> ids.</summary>
    [SitrepUnit(Units.Id)]
    public List<string> Members { get; set; } = new();

    /// <summary>How the speaker describes itself, for display only.</summary>
    public CommcastAuthor Author { get; set; } = new();
}

/// <summary>
/// Bring more centres into a group. Anyone the
/// speaker can see is a member may add; nobody is ever removed. Refused unless
/// the speaker is a member as its own vantage currently knows the group.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("commcast.group.add", Delay = DelayRole.TrueNow)]
public class CommcastGroupAddArgs
{
    /// <summary>The group, by the id it was opened with.</summary>
    [SitrepUnit(Units.Id)]
    public string GroupId { get; set; } = "";

    /// <summary>The centres to bring in, as <c>commandCentre.roster</c> ids. One already in the group is ignored.</summary>
    [SitrepUnit(Units.Id)]
    public List<string> Added { get; set; } = new();

    /// <summary>How the speaker describes itself, for display only.</summary>
    public CommcastAuthor Author { get; set; } = new();
}

/// <summary>
/// Say something to a group in text.
/// Refused unless the speaker is a member as its own vantage knows the group.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("commcast.message.send", Result = typeof(CommcastSendReceipt), Delay = DelayRole.TrueNow)]
public class CommcastMessageSendArgs
{
    /// <summary>Minted by the client and kept across a resend, so a listener holding both copies holds one message.</summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>The group, by the id it was opened with.</summary>
    [SitrepUnit(Units.Id)]
    public string GroupId { get; set; } = "";

    /// <summary>The words.</summary>
    [SitrepUnit(Units.Text)]
    public string Body { get; set; } = "";

    /// <summary>
    /// The members to say it to, as <c>commandCentre.roster</c> ids: for saying a
    /// message again to those who did not receive it, and to nobody else. Empty
    /// or absent means every member the speaker knows of. Refused if it names a
    /// centre that is not a member as the speaker's vantage knows the group.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public List<string> To { get; set; } = new();

    /// <summary>How the speaker describes itself, for display only.</summary>
    public CommcastAuthor Author { get; set; } = new();
}

/// <summary>
/// What <c>commcast.message.send</c> (args <see cref="CommcastMessageSendArgs"/>)
/// did with a message: which command centres it left for, and which it could not
/// leave for. <c>commcast.message.send</c> is the command, of Commcast, the Gonogo mod's
/// group messaging and radio, that sends a text message to a group of command
/// centres. A centre is a <c>commandCentre.roster</c> entry, a place
/// commands are sent from. It says nothing of arrival: a listener is a centre
/// that receives the message, and arrival is known only when that listener sends
/// <c>commcast.message.ack</c> (<see cref="CommcastMessageAckArgs"/>) back.
/// </summary>
/// <category>Command results</category>
/// <categoryDescription>
/// The answers a command sends back when it has more to report than accepted or
/// refused, read by the screen that sent it.
/// </categoryDescription>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommcastSendReceipt
{
    /// <summary>Every centre the message left for, the speaker's own included, sorted by id. The same list its listeners read as the message's <c>to</c>.</summary>
    [SitrepUnit(Units.Id)]
    public List<string> Addressed { get; set; } = new();

    /// <summary>
    /// Every member it was meant for that no signal from the speaker could
    /// reach when it was said, sorted by id, and that the host cannot keep the
    /// message for either. The message was never sent to these centres, so none
    /// of them will ever acknowledge it; to reach them, send it again later
    /// naming them in <c>to</c>. Empty on a host that keeps messages for centres
    /// it cannot reach yet, which lists those in <see cref="Queued"/> instead.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public List<string> Unreached { get; set; } = new();

    /// <summary>
    /// Every member it was meant for that no signal from the speaker could
    /// reach when it was said, and that the host is keeping the message for,
    /// sorted by id. It is carried to each as soon as a path opens, kept with
    /// the game until then, and the member acknowledges it when a screen at its
    /// centre reads it. Absent from a host that keeps nothing.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public List<string>? Queued { get; set; }
}

/// <summary>
/// Tell a message's author it arrived. The
/// acknowledgement travels back to the author over the signal delay between the
/// two centres, so the author learns of it one signal delay after it was read.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("commcast.message.ack", Delay = DelayRole.TrueNow)]
public class CommcastMessageAckArgs
{
    /// <summary>The message being acknowledged, by its <see cref="CommcastMessageSendArgs.Id"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string MessageId { get; set; } = "";

    /// <summary>How the speaker describes itself, for display only.</summary>
    public CommcastAuthor Author { get; set; } = new();
}

/// <summary>
/// One batch of live push-to-talk audio,
/// spoken to a group.
///
/// <para>Each chunk is one raw Opus packet of 20 ms, base64-encoded. Send about
/// 200 ms per batch: each batch leaves the mod as one binary frame per listener
/// on <c>commcast.radio</c>, and the per-frame header is what costs, not the
/// audio.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("commcast.radio.transmit", Delay = DelayRole.TrueNow)]
public class CommcastRadioTransmitArgs
{
    /// <summary>Minted by the client at key-down and carried on every batch of that keying.</summary>
    [SitrepUnit(Units.Id)]
    public string TransmissionId { get; set; } = "";

    /// <summary>The group, by the id it was opened with.</summary>
    [SitrepUnit(Units.Id)]
    public string GroupId { get; set; } = "";

    /// <summary>The 0-based index, within the transmission, of the first chunk in this batch.</summary>
    [SitrepUnit(Units.Count)]
    public int Seq { get; set; }

    /// <summary>Opus packets, 20 ms each, base64. May be empty on the batch that ends a keying.</summary>
    [SitrepUnit(Units.Text)]
    public List<string> Chunks { get; set; } = new();

    /// <summary>True on the last batch of a keying.</summary>
    [SitrepUnit(Units.Flag)]
    public bool End { get; set; }

    /// <summary>How the speaker describes itself, for display only.</summary>
    public CommcastAuthor Author { get; set; } = new();
}

/// <summary>
/// One command centre's ledger of messages: what it said, and what reached it,
/// as the state <c>commcast.ledger</c> carries.
///
/// <para><b>State, read like telemetry.</b> A message is a command from one
/// centre to another. It travels like any command, waiting for a path and
/// cancellable from the sender's uplink queue, and what it does on arrival is
/// write this ledger at the recipient. A screen reads the ledger as the latest
/// value of a state, and a screen that opens at a centre later is told the
/// whole ledger on connecting.</para>
///
/// <para><b>Addressed, never broadcast.</b> A connection receives only the
/// ledger of its own vantage.</para>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
[SitrepTopic("commcast.ledger")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommcastLedger
{
    /// <summary>Every entry the ledger keeps, oldest first: what this centre said and what reached it.</summary>
    public List<CommcastLedgerItem> Items { get; set; } = new();
}

/// <summary>
/// One entry of a centre's ledger.
///
/// <para>Two kinds, by <see cref="Kind"/>:</para>
/// <list type="bullet">
/// <item><c>"members"</c>: a group opened or grew. <see cref="Members"/> is its
/// whole membership after the change, <see cref="Added"/> who came in</item>
/// <item><c>"text"</c>: a message, <see cref="Id"/> and <see cref="Body"/></item>
/// </list>
///
/// <para>An entry this centre said has no <see cref="ArrivedUt"/> and carries how
/// each recipient stands: <see cref="Delivered"/>, <see cref="Ended"/> and
/// <see cref="Read"/>. An entry that reached this centre has <see cref="ArrivedUt"/>
/// and none of those.</para>
/// </summary>
/// <category>Comms</category>
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommcastLedgerItem
{
    /// <summary><c>"members"</c> or <c>"text"</c>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string Kind { get; set; } = "";

    /// <summary>A text message's own id, or a membership change's.</summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>The group, by the id it was opened with.</summary>
    [SitrepUnit(Units.Id)]
    public string GroupId { get; set; } = "";

    /// <summary>The centre it was said from, as the mod resolved it for the speaker's connection.</summary>
    [SitrepUnit(Units.Id)]
    public string From { get; set; } = "";

    /// <summary>How the speaker describes itself, for display only.</summary>
    public CommcastAuthor Author { get; set; } = new();

    /// <summary>The UT it was said at.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double SentUt { get; set; }

    /// <summary>Everyone it was addressed to, the speaker included, as the speaker could see the group.</summary>
    [SitrepUnit(Units.Id)]
    public List<string> To { get; set; } = new();

    /// <summary>The group's whole membership after a <c>"members"</c> change. Absent otherwise.</summary>
    [SitrepUnit(Units.Id)]
    public List<string>? Members { get; set; }

    /// <summary>Who a <c>"members"</c> change brought in. Absent otherwise.</summary>
    [SitrepUnit(Units.Id)]
    public List<string>? Added { get; set; }

    /// <summary>A <c>"text"</c> message's words. Absent otherwise.</summary>
    [SitrepUnit(Units.Text)]
    public string? Body { get; set; }

    /// <summary>The UT it reached this centre. Absent from an entry this centre said.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? ArrivedUt { get; set; }

    /// <summary>For an entry this centre said: the UT each recipient's copy ran, keyed by recipient, as the reply reached here. A recipient with no key has not been heard from.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public Dictionary<string, double>? Delivered { get; set; }

    /// <summary>For an entry this centre said: how a recipient's copy ended without running, <c>"cancelled"</c> or <c>"expired"</c>, keyed by recipient.</summary>
    [SitrepUnit(Units.Enumeration)]
    public Dictionary<string, string>? Ended { get; set; }

    /// <summary>For an entry this centre said: when a screen at each recipient read it, keyed by recipient, as the notice reached here.</summary>
    public Dictionary<string, CommcastRead>? Read { get; set; }
}

/// <summary>A recipient's screen reading a message: when, and who read it.</summary>
/// <category>Comms</category>
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommcastRead
{
    /// <summary>The UT a screen at the recipient read it.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double At { get; set; }

    /// <summary>The reading device's own stable key.</summary>
    [SitrepUnit(Units.Id)]
    public string StationKey { get; set; } = "";

    /// <summary>Which end of the light-path the screen that read it sits at, in the client's own vocabulary.</summary>
    [SitrepUnit(Units.Id)]
    public string Seat { get; set; } = "";
}

/// <summary>
/// The first segment of every <c>commcast.radio</c> frame, as UTF-8 JSON. The
/// segments after it are that batch's raw Opus packets, 20 ms each, in order.
///
/// <para><c>commcast.radio</c> is carried in <see cref="BinaryLane"/> frames
/// and is addressed exactly as <see cref="CommcastTraffic"/> is: a
/// connection hears only transmissions to groups its vantage belongs to, one
/// signal delay after each batch was spoken. Every frame carries this whole
/// description, so a listener that starts hearing partway through a keying
/// places it from the first frame it gets.</para>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommcastRadioBatch
{
    /// <summary>The keying this belongs to, by the id the speaking client minted at key-down.</summary>
    [SitrepUnit(Units.Id)]
    public string TransmissionId { get; set; } = "";

    /// <summary>The group, by the id it was opened with.</summary>
    [SitrepUnit(Units.Id)]
    public string GroupId { get; set; } = "";

    /// <summary>The centre it is spoken from, as the mod resolved it for the speaker's connection.</summary>
    [SitrepUnit(Units.Id)]
    public string From { get; set; } = "";

    /// <summary>How the speaker describes itself, for display only.</summary>
    public CommcastAuthor Author { get; set; } = new();

    /// <summary>The UT the keying's first batch reached the mod.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double StartedUt { get; set; }

    /// <summary>The 0-based index, within the transmission, of this frame's first audio segment.</summary>
    [SitrepUnit(Units.Count)]
    public int Seq { get; set; }

    /// <summary>True on the frame that ends the keying.</summary>
    [SitrepUnit(Units.Flag)]
    public bool End { get; set; }

    /// <summary>Everyone this batch was addressed to, the speaker included, as the speaker could see the group.</summary>
    [SitrepUnit(Units.Id)]
    public List<string> To { get; set; } = new();
}

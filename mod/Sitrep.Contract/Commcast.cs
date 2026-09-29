#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// Who is speaking, as the speaking client describes itself. Shown to listeners
/// and trusted for nothing else: the vantage a thing was said FROM is always the
/// one the mod resolved for the connection that said it, never a field here.
/// </summary>
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
/// <c>commcast.group.open</c>'s args: start a group, a set of command centres
/// sharing one thread for messages and radio. The speaker is always a member,
/// named here or not.
///
/// <para>Never delayed on the way up. What is said crosses once, from the
/// speaker to each listener at that pair's light-time, and the mod times that
/// crossing on the way down; delaying the command as well would count the gap
/// twice.</para>
/// </summary>
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
/// <c>commcast.group.add</c>'s args: bring more centres into a group. Anyone the
/// speaker can see is a member may add; nobody is ever removed. Refused unless
/// the speaker is a member as its own vantage currently knows the group.
/// </summary>
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
/// <c>commcast.message.send</c>'s args: say something to a group in text.
/// Refused unless the speaker is a member as its own vantage knows the group.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("commcast.message.send", Delay = DelayRole.TrueNow)]
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

    /// <summary>How the speaker describes itself, for display only.</summary>
    public CommcastAuthor Author { get; set; } = new();
}

/// <summary>
/// <c>commcast.message.ack</c>'s args: tell a message's author it arrived. The
/// acknowledgement crosses back to the author at their pair's light-time, so the
/// author learns it was read one crossing after it was.
/// </summary>
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
/// <c>commcast.radio.transmit</c>'s args: one batch of live push-to-talk audio,
/// spoken to a group.
///
/// <para>Each chunk is one raw Opus packet of 20 ms, base64-encoded. Send about
/// 200 ms per batch: each batch leaves the mod as one binary frame per listener
/// on <c>commcast.radio</c>, and the per-frame header is what costs, not the
/// audio.</para>
/// </summary>
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
/// One item of <c>commcast.traffic</c>: something said to a group this vantage
/// belongs to, delivered one light-time after it was said from where it was
/// said.
///
/// <para><b>Addressed, never broadcast.</b> A connection receives only the
/// items addressed to its own vantage. A group's members are addressed as the
/// speaker could see them when it spoke, so a centre added far away starts
/// receiving once word of it has reached the speaker, and a member with no path
/// from the speaker misses what was said.</para>
///
/// <para><b>A stream, not state.</b> Nothing is replayed to a connection that
/// subscribes after an item reached it, as with anything heard on a radio.</para>
///
/// <para>Three kinds, by <see cref="Kind"/>:</para>
/// <list type="bullet">
/// <item><c>"members"</c>: a group opened or grew. <see cref="Members"/> is its
/// whole membership after the change, <see cref="Added"/> who came in</item>
/// <item><c>"text"</c>: a message, <see cref="Id"/> and <see cref="Body"/></item>
/// <item><c>"ack"</c>: a member acknowledging <see cref="MessageId"/>, addressed
/// to that message's author alone</item>
/// </list>
/// </summary>
[SitrepContract]
[SitrepTopic("commcast.traffic")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommcastTraffic
{
    /// <summary><c>"members"</c>, <c>"text"</c> or <c>"ack"</c>.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string Kind { get; set; } = "";

    /// <summary>A text message's own id, or a membership change's. Absent from an ack.</summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    /// <summary>The group, by the id it was opened with.</summary>
    [SitrepUnit(Units.Id)]
    public string GroupId { get; set; } = "";

    /// <summary>The centre it was said from, as the mod resolved it for the speaker's connection.</summary>
    [SitrepUnit(Units.Id)]
    public string From { get; set; } = "";

    /// <summary>How the speaker describes itself, for display only.</summary>
    public CommcastAuthor Author { get; set; } = new();

    /// <summary>The UT it was said at, which is also this delivery's <c>meta.validAt</c>.</summary>
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

    /// <summary>The message an <c>"ack"</c> acknowledges. Absent otherwise.</summary>
    [SitrepUnit(Units.Id)]
    public string? MessageId { get; set; }
}

/// <summary>
/// The first segment of every <c>commcast.radio</c> frame, as UTF-8 JSON. The
/// segments after it are that batch's raw Opus packets, 20 ms each, in order.
///
/// <para><c>commcast.radio</c> rides the binary lane (see the binary-frames
/// reference) and is addressed exactly as <see cref="CommcastTraffic"/> is: a
/// connection hears only transmissions to groups its vantage belongs to, one
/// light-time after each batch was spoken. Every frame carries this whole
/// description, so a listener that starts hearing partway through a keying
/// places it from the first frame it gets.</para>
/// </summary>
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

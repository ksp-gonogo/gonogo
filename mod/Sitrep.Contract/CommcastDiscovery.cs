#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// One row of <c>commcast.transmissions</c>: a radio transmission this vantage
/// can detect.
///
/// <para><b>Detectable</b> means a signal from the speaker has a routed path
/// to this vantage, the same path its audio would take. The row reaches a
/// vantage at exactly the delay the transmission's audio does, so the instant
/// a transmission begins here is the same whichever of the two is read.</para>
///
/// <para>Rows are sent when a keying begins, again at most once a second of
/// game time while it continues (so a connection that subscribes partway
/// through learns of it), and once when it ends. Nothing is replayed to a
/// connection that subscribes after a row reached it.</para>
///
/// <para><b>Detection only.</b> A transmission's audio on <see cref="Topic"/>
/// is addressed to the members of its group only, and this row grants no
/// access to it: a group is joined by invitation, never by a vantage adding
/// itself, whatever it can detect.</para>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
[SitrepTopic("commcast.transmissions")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommcastTransmissionRow
{
    /// <summary><c>"open"</c> while the speaker is keyed, <c>"ended"</c> on the last row of a keying.</summary>
    [SitrepUnit(Units.Enumeration)]
    public string Phase { get; set; } = "";

    /// <summary>The keying, by the id the speaking client minted at key-down.</summary>
    [SitrepUnit(Units.Id)]
    public string TransmissionId { get; set; } = "";

    /// <summary>The group it is spoken to.</summary>
    [SitrepUnit(Units.Id)]
    public string GroupId { get; set; } = "";

    /// <summary>The centre it is spoken from.</summary>
    [SitrepUnit(Units.Id)]
    public string From { get; set; } = "";

    /// <summary>How the speaker describes itself, for display only.</summary>
    public CommcastAuthor Author { get; set; } = new();

    /// <summary>The UT the keying's first batch reached the mod.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double StartedUt { get; set; }

    /// <summary>Who the speaker addressed when this row was sent, the speaker included.</summary>
    [SitrepUnit(Units.Id)]
    public List<string> To { get; set; } = new();

    /// <summary>The binary-lane topic its audio rides: <c>commcast.radio</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";
}

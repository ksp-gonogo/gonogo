using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// Which screen hosts this game, the code a remote station joins with, and the
/// remote stations the host has approved. One screen per game hosts: the
/// others join it, and the game mod is the referee because every local screen
/// on every machine reaches it.
///
/// <para>A screen asks for the role with <c>host.claim</c> and keeps it by
/// sending <c>host.heartbeat</c>. Whether the screen reading this holds the
/// role is not on this Topic, since every screen reads the same value: a screen
/// compares <see cref="HolderId"/> with the <see cref="HostRoleReply.HolderId"/>
/// its own claim was answered with.</para>
///
/// <para>Never delayed by signal delay: it describes the screens in front of
/// the operator, not a craft. Neither a screen's token nor a station's
/// credential is ever on it, only ids that name them.</para>
/// <internal>
/// The code and the stations are stored in the mod's settings file, in rows
/// that are never declared, so <c>settings.gonogo</c> cannot publish them.
/// </internal>
/// </summary>
/// <category>Hosting</category>
/// <categoryDescription>
/// The record of which screen hosts a game, with the commands that claim,
/// keep and give up the role and the ones that manage the join code and the
/// approved remote stations.
/// </categoryDescription>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("host.record")]
public class HostRecordModel
{
    /// <summary>Whether a screen holds the role now, including one whose connection has closed and whose grace has not run out.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Held { get; set; }

    /// <summary>True while the holder's connection is closed and the role is kept for it to come back, as a page reload does. A screen that claims the role in this time is granted it. The role is freed when the grace ends.</summary>
    [SitrepUnit(Units.Flag)]
    public bool HolderAway { get; set; }

    /// <summary>The id of the screen that holds the role, or an empty string when nobody does.</summary>
    [SitrepUnit(Units.Id)]
    public string HolderId { get; set; } = "";

    /// <summary>
    /// The code a remote station enters to join the host: six characters from
    /// the letters and digits that cannot be mistaken for one another. It stays
    /// the same until <c>host.code.regenerate</c> changes it, whichever screen hosts.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Code { get; set; } = "";

    /// <summary>The remote stations the host has approved, oldest first.</summary>
    public List<ApprovedStationState> Stations { get; set; } = new();
}

/// <summary>One remote station the host has approved.</summary>
/// <category>Hosting</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ApprovedStationState
{
    /// <summary>An id that names the station without revealing its credential. It is what <c>host.station.revoke</c> takes.</summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>The name the station reported when it was approved.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>When the station was first approved, in Unix milliseconds.</summary>
    [SitrepUnit(Units.Count)]
    public long ApprovedAt { get; set; }
}

/// <summary>
/// The answer to <c>host.claim</c> and <c>host.heartbeat</c>: whether the screen
/// that sent it holds the role, and who does. A refused claim is an ordinary
/// answer with <see cref="Holds"/> false, not a failed command.
///
/// <para>A screen that sent a heartbeat and reads <see cref="Holds"/> false has
/// lost the role, having been cut off for longer than the grace while another
/// screen took over, and stops hosting at once.</para>
/// </summary>
/// <category>Command results</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class HostRoleReply
{
    /// <summary>Whether the screen that sent the command holds the role now.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Holds { get; set; }

    /// <summary>The id of the screen that holds the role, or an empty string when nobody does. Matches <see cref="HostRecordModel.HolderId"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string HolderId { get; set; } = "";

    /// <summary>How often the holder is asked to send a heartbeat.</summary>
    [SitrepUnit(Units.Seconds)]
    public double HeartbeatSeconds { get; set; }

    /// <summary>How long after its last heartbeat or the close of its connection a holder keeps the role before it is freed.</summary>
    [SitrepUnit(Units.Seconds)]
    public double GraceSeconds { get; set; }

    /// <summary>
    /// How many times the role has been granted, counting the grant this answer
    /// reports when <see cref="Holds"/> is true. It rises by one on each
    /// <c>host.claim</c> that grants the role, including to the holder returning
    /// after a reload, never on a heartbeat, and keeps rising across a game
    /// restart. A screen hosting a remote station reads it to tell the newest
    /// host from an older one that is still answering.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public long Generation { get; set; }
}

/// <summary>
/// The answer to <c>host.station.check</c>: whether a station's credential is
/// one the host approved.
/// </summary>
/// <category>Command results</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class HostStationCheckReply
{
    /// <summary>Whether the credential belongs to an approved station.</summary>
    [SitrepUnit(Units.Flag)]
    public bool Approved { get; set; }

    /// <summary>The station's id, or an empty string when it is not approved.</summary>
    [SitrepUnit(Units.Id)]
    public string StationId { get; set; } = "";

    /// <summary>The name the station was approved under, or an empty string when it is not approved.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";
}

/// <summary>
/// Take or keep the host role, keep it, give it up, or mint a new join code.
/// Arguments to <c>host.claim</c>, <c>host.heartbeat</c>, <c>host.release</c>
/// and <c>host.code.regenerate</c>: the token the screen keeps for itself.
///
/// <para>The token is one per browser tab. It survives a reload and is not
/// copied by a duplicated tab, so the mod can tell a reload, which takes the
/// role straight back inside the grace, from a second tab, which is refused.
/// It is a secret between the tab and the mod and is never published.</para>
///
/// <para><c>host.claim</c> and <c>host.heartbeat</c> answer with a
/// <see cref="HostRoleReply"/>. <c>host.release</c> frees the role at once and
/// <c>host.code.regenerate</c> replaces the join code; both are refused for a
/// token that does not hold the role. Never delayed by signal delay.</para>
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("host.claim", Result = typeof(HostRoleReply), Delay = DelayRole.TrueNow, Summary = "Ask for the host role.")]
[SitrepCommand("host.heartbeat", Result = typeof(HostRoleReply), Delay = DelayRole.TrueNow, Summary = "Tell the mod the hosting screen is still there.")]
[SitrepCommand("host.release", Delay = DelayRole.TrueNow, Summary = "Give the host role up at once.")]
[SitrepCommand("host.code.regenerate", Delay = DelayRole.TrueNow, Summary = "Replace the join code with a new one.")]
public class HostTokenArgs
{
    /// <summary>The token the screen keeps for itself.</summary>
    [SitrepUnit(Units.Id)]
    public string Token { get; set; } = "";
}

/// <summary>
/// Approve a remote station by the credential it presents. Arguments to
/// <c>host.station.approve</c>: the holder's token, and the station's
/// credential and name. Approving a credential already approved renames the
/// station. Refused for a token that does not hold the role. Never delayed by
/// signal delay.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("host.station.approve", Delay = DelayRole.TrueNow, Summary = "Approve a remote station.")]
public class HostApproveStationArgs
{
    /// <summary>The token of the screen that holds the role.</summary>
    [SitrepUnit(Units.Id)]
    public string Token { get; set; } = "";

    /// <summary>The secret the station presents to the host. It is stored by the mod and never published.</summary>
    [SitrepUnit(Units.Id)]
    public string Credential { get; set; } = "";

    /// <summary>The name to show for the station.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";
}

/// <summary>
/// Revoke an approved remote station. Arguments to <c>host.station.revoke</c>:
/// the holder's token and the id of the station, from
/// <see cref="ApprovedStationState.Id"/>. Refused for a token that does not
/// hold the role. Never delayed by signal delay.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("host.station.revoke", Delay = DelayRole.TrueNow, Summary = "Revoke an approved remote station.")]
public class HostRevokeStationArgs
{
    /// <summary>The token of the screen that holds the role.</summary>
    [SitrepUnit(Units.Id)]
    public string Token { get; set; } = "";

    /// <summary>The station's id from <see cref="ApprovedStationState.Id"/>.</summary>
    [SitrepUnit(Units.Id)]
    public string StationId { get; set; } = "";
}

/// <summary>
/// Ask whether a credential is one the host approved. Arguments to
/// <c>host.station.check</c>, answered with a <see cref="HostStationCheckReply"/>:
/// the holder's token and the credential a station presented. The host calls it
/// when a remote station connects, since the credentials are not published.
/// Refused for a token that does not hold the role. Never delayed by signal delay.
/// </summary>
/// <category>Command arguments</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepCommand("host.station.check", Result = typeof(HostStationCheckReply), Delay = DelayRole.TrueNow, Summary = "Ask whether a station's credential is approved.")]
public class HostCheckStationArgs
{
    /// <summary>The token of the screen that holds the role.</summary>
    [SitrepUnit(Units.Id)]
    public string Token { get; set; } = "";

    /// <summary>The credential the station presented.</summary>
    [SitrepUnit(Units.Id)]
    public string Credential { get; set; } = "";
}

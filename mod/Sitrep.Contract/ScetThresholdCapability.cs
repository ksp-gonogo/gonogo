using System;
using System.Collections.Generic;

namespace Sitrep.Contract;

// ─────────────────────────────────────────────────────────────────────────────
// Contributing a SCET threshold SOURCE, as a shared Kernel capability.
//
// WHAT WAS MISSING. A SCET threshold is the only alarm that can stop the warp on
// the tick its condition matches: it is evaluated inside the simulation, off the
// snapshot, upstream of the reveal gate. Everything a client could do instead
// polls a reading that is already a light-time old and acts a poll interval
// late, so for anything that must halt the clock at a particular moment the SCET
// alarm is not the better option, it is the only one.
//
// Which Topics one may be armed against was a static dictionary in
// Sitrep.Host.Alarms.ScetThresholdSources, an assembly no Uplink may reference,
// with no add or register method on it. So a mod that models its own quantity
// could publish it on its own channel, watch an operator read it on screen, and
// still had no way to let that operator stop a warp on it. The arm refused the
// Topic by name.
//
// WHY THE SET STAYS DECLARED RATHER THAN DISCOVERED. The obvious alternative to
// both the table and this seam is to tap whatever the channel loop is already
// emitting, which would make every Topic in the tree addressable for free.
// ChannelEngine.ProcessTick skips any Topic nothing is currently subscribed to,
// so a threshold read that way fires or does not fire depending on which widgets
// the operator happened to leave open. A contributed source is therefore a
// BUILDER handed over once at registration, called on demand per evaluation
// whether or not anybody is watching the Topic, never a value observed in
// traffic. That is the same property the built-in table has and the reason it is
// written out by hand.
//
// SHARED, not exclusive: two installed mods can each have a quantity worth
// stopping a warp for, and there is nothing to elect between them. No vanilla
// either: a stock install contributes nothing and should activate nothing.
//
// Closure is the snapshot type and a delegate over it, both already here.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>The capability id providers register against.</summary>
public static class ScetThresholdCapability
{
    public const string Id = "scetThresholdSources";
}

/// <summary>
/// One Topic a SCET threshold may be armed against, and how the simulation
/// resolves it to a payload.
/// </summary>
public sealed class ScetThresholdSource
{
    /// <summary>
    /// The Topic, spelled as the wire spells one (<c>"rp1.projects"</c>).
    ///
    /// <para>A Topic core already knows is NOT overridden: the built-in table is
    /// consulted first and a contributed entry naming one of its Topics is
    /// ignored. Core's own reading of a core Topic cannot be replaced by an
    /// installed mod, because an operator reading an altitude off the screen has
    /// to be able to arm on the number they are looking at.</para>
    /// </summary>
    public string Topic { get; set; } = "";

    /// <summary>
    /// Builds the Topic's wire payload from one tick's snapshot, as a plain
    /// dictionary tree the threshold's dotted field path is walked over.
    ///
    /// <para><b>Stamp the payload's <c>meta.source</c>.</b> The reading is
    /// accepted only when that stamp equals the subject the alarm was armed
    /// against, in the <c>"vessel:&lt;guid&gt;"</c> / <c>"game"</c> vocabulary
    /// <see cref="ScetAlarm.Subject"/> uses. A payload that does not say who it
    /// is about is not an answer to a question that names a craft, and an
    /// unstamped one is refused on every tick rather than rejected at arm time,
    /// so it reads to an operator as an alarm that simply never comes due.</para>
    ///
    /// <para><b>Pure, and off the snapshot only.</b> It runs on the capture,
    /// inside the tick the alarm is decided in, so it must not touch the game's
    /// API, block, or keep state between calls. Anything it cannot answer this
    /// tick is <c>null</c>, which reads as "not now" and never fires.</para>
    /// </summary>
    public Func<KspSnapshot?, object?> Build { get; set; } = null!;
}

/// <summary>
/// One mod's contribution to what a SCET threshold may be armed against.
///
/// <para><b>The set is fixed at registration.</b> <see cref="Sources"/> is asked
/// on demand and must answer the same entries every time, because the whole
/// point of a declared table is that whether an alarm can fire does not depend
/// on anything happening at the moment it is asked. A provider whose set varied
/// would let an arm be accepted and then become unreadable, which is the one
/// outcome the arm's up-front refusal exists to prevent.</para>
/// </summary>
public interface IScetThresholdSources : ISitrepProvider
{
    /// <summary>
    /// Every Topic this provider offers. Empty is a legitimate answer for a mod
    /// that finds nothing to model on this install, and is the right one: an
    /// entry whose <see cref="ScetThresholdSource.Build"/> is null is ignored.
    /// </summary>
    IReadOnlyList<ScetThresholdSource> Sources();
}

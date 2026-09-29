using System;
using System.Collections.Generic;

namespace Sitrep.Contract;

/*
 * Contributing a SCET threshold SOURCE, as a shared Kernel capability.
 *
 * A SCET threshold is the only alarm that can stop the warp on the tick its
 * condition matches: it is evaluated inside the simulation, off the snapshot,
 * upstream of the reveal gate. Anything a client could do instead polls a
 * reading that is already a light-time old and acts a poll interval late.
 *
 * The set of Topics stays DECLARED rather than discovered from traffic:
 * ChannelEngine.ProcessTick skips any Topic nothing is subscribed to, so a
 * threshold read off the channel loop would fire or not depending on which
 * widgets the operator left open. A contributed source is therefore a BUILDER
 * handed over once at registration and called on demand per evaluation,
 * whether or not anybody is watching the Topic.
 *
 * SHARED, not exclusive: two installed mods can each have a quantity worth
 * stopping a warp for, and there is nothing to elect between them. No vanilla
 * either: a stock install contributes nothing and activates nothing.
 */

/// <summary>
/// The shared capability an Uplink registers an <see cref="IScetThresholdSources"/>
/// against, to let an operator set a SCET threshold alarm on a Topic of its own.
/// </summary>
/// <category>Uplink API</category>
public static class ScetThresholdCapability
{
    /// <summary>The capability id, <c>"scetThresholdSources"</c>.</summary>
    public const string Id = "scetThresholdSources";
}

/// <summary>
/// One Topic a SCET threshold may be set on, and how the simulation resolves
/// it to a payload.
/// </summary>
/// <category>Uplink API</category>
public sealed class ScetThresholdSource
{
    /// <summary>
    /// The Topic, spelled as the wire spells one (<c>"example.projects"</c>).
    ///
    /// <para>A Topic core already knows is NOT overridden: the built-in table is
    /// consulted first and a contributed entry naming one of its Topics is
    /// ignored. Core's own reading of a core Topic cannot be replaced by an
    /// installed mod, because an operator reading an altitude off the screen has
    /// to be able to set a threshold on the number they are looking at.</para>
    /// </summary>
    public string Topic { get; set; } = "";

    /// <summary>
    /// Builds the Topic's wire payload from one tick's snapshot, as a plain
    /// dictionary tree the threshold's dotted field path is walked over.
    ///
    /// <para><b>Stamp the payload's <c>meta.source</c>.</b> The reading is
    /// accepted only when that stamp equals the subject the alarm was set on,
    /// in the <c>"vessel:&lt;guid&gt;"</c> / <c>"game"</c> vocabulary
    /// <see cref="ScetAlarm.Subject"/> uses. An unstamped payload is refused on
    /// every tick rather than rejected when the alarm is set, so it reads to an
    /// operator as an alarm that simply never comes due.</para>
    ///
    /// <para><b>Pure, and off the snapshot only.</b> It runs on the capture,
    /// inside the tick the alarm is decided in, so it must not touch the game's
    /// API, block, or keep state between calls. Anything it cannot build this
    /// tick is <c>null</c>, which reads as "not now" and never fires.</para>
    /// </summary>
    public Func<KspSnapshot?, object?> Build { get; set; } = null!;
}

/// <summary>
/// One mod's contribution to what a SCET threshold may be set on.
///
/// <para><b>The set is fixed at registration.</b> <see cref="Sources"/> is asked
/// on demand and must return the same entries every time, so whether an alarm
/// can fire does not depend on anything happening at the moment it is asked. A
/// provider whose set varied would let an alarm be accepted and then become
/// unreadable, which is what the up-front refusal of an unknown Topic
/// prevents.</para>
/// </summary>
/// <category>Uplink API</category>
public interface IScetThresholdSources : ISitrepProvider
{
    /// <summary>
    /// Every Topic this provider offers. Empty is legitimate for a mod that finds
    /// nothing to model on this install. An entry whose
    /// <see cref="ScetThresholdSource.Build"/> is null is ignored.
    /// </summary>
    /// <returns>The provider's sources, the same set on every call.</returns>
    IReadOnlyList<ScetThresholdSource> Sources();
}

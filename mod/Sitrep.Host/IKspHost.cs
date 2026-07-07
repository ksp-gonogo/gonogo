using System;
using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// The mod's ONLY window into the running game. Implemented in-game by
    /// <c>Gonogo.KSP</c>'s <c>KspHost</c> (Task 4 — wraps
    /// <c>FlightGlobals</c>/<c>CelestialBody</c>/<c>GameEvents</c>), or
    /// headlessly by Task 2's <c>ReplayKspHost</c> (replaying a recorded
    /// <see cref="RecordedSession"/>). Every member returns primitives/POCOs
    /// only — a KSP/Unity reference type must NEVER escape through this
    /// interface. That boundary is what keeps Sitrep.Host (and everything it
    /// feeds — the recorder, the System-View provider, and their tests)
    /// headless-testable without the game running.
    /// </summary>
    public interface IKspHost
    {
        /// <summary>Current universal time (KSP's UT clock), in seconds.</summary>
        double NowUt();

        /// <summary>
        /// A raw, schema-free snapshot of whatever the active providers care
        /// about right now (body/vessel/orbital state, ...). Deliberately
        /// untyped at this layer — <c>SystemViewProvider</c> (Task 3) and
        /// future providers interpret <see cref="KspSnapshot.Values"/>;
        /// <see cref="IKspHost"/> itself doesn't know what's inside.
        /// </summary>
        KspSnapshot Sample();

        /// <summary>
        /// Fires for scene-load / flight-ready / vessel-change /
        /// game-state-load (quickload) transitions — the KSP lifecycle
        /// events a recording needs alongside periodic <see cref="Sample"/>
        /// calls to reconstruct what happened during a session.
        /// </summary>
        event Action<KspLifecycleEvent> Lifecycle;
    }

    /// <summary>
    /// Primitives-only snapshot returned by <see cref="IKspHost.Sample"/>.
    /// Raw and schema-free by design (see the M5b plan's record-format
    /// spec): new providers add keys to <see cref="Values"/> without any
    /// change here, and a recording stays valid across provider changes
    /// because the replay side never needs to understand the keys, only
    /// carry them.
    /// </summary>
    public sealed class KspSnapshot
    {
        public double Ut { get; set; }

        public Dictionary<string, object?> Values { get; set; } = new Dictionary<string, object?>();

        // NOTE: a KspSnapshot handed to ChannelEngine.Tick MUST be treated as
        // immutable once Sample() returns it. ChannelEngine hands the SAME
        // instance to every registered ISnapshotSampler and every
        // AddChannelSource mapper for that tick — a sampler/mapper that
        // mutates Values in place would corrupt what every OTHER
        // sampler/mapper sees for the same tick, and (worse) could race with
        // whatever the caller does with its own reference after Tick()
        // returns, since Tick() only enqueues a job — the Courier thread
        // reads this snapshot asynchronously, on its own schedule.
    }

    /// <summary>
    /// One lifecycle transition delivered via <see cref="IKspHost.Lifecycle"/>.
    /// <see cref="Kind"/> is one of "scene-load", "flight-ready",
    /// "vessel-change", "game-state-load" (quickload) — see the plan's
    /// record-format spec. <see cref="Args"/> carries transition-specific
    /// detail (e.g. the new scene name), raw and schema-free like
    /// <see cref="KspSnapshot.Values"/>.
    /// </summary>
    public sealed class KspLifecycleEvent
    {
        public double Ut { get; set; }

        public string Kind { get; set; } = "";

        public Dictionary<string, object?> Args { get; set; } = new Dictionary<string, object?>();
    }
}

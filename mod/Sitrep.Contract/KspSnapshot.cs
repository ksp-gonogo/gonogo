using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// Primitives-only snapshot returned by <c>Sitrep.Host.IKspHost.Sample</c>.
    /// Raw and schema-free by design (see the M5b plan's record-format
    /// spec): new providers add keys to <see cref="Values"/> without any
    /// change here, and a recording stays valid across provider changes
    /// because the replay side never needs to understand the keys, only
    /// carry them.
    ///
    /// Lives in <c>Sitrep.Contract</c> (moved from <c>Sitrep.Host</c> during
    /// the Uplink-foundation review's fix round) rather than the engine
    /// assembly it was originally authored in: <c>IUplinkHost.AddSampler</c>
    /// hands an <c>ISnapshotSampler</c> a <see cref="KspSnapshot"/> directly,
    /// so a third-party Uplink implementing that interface needs the type
    /// visible from the ONE assembly it references — see
    /// <c>ISitrepUplink</c>'s own doc comment for the full carve-out
    /// rationale.
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
}

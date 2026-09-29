using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// One tick's primitives-only sample of game state, handed to every
    /// <see cref="ISnapshotSampler"/> and channel mapper an Uplink registers.
    /// Raw and schema-free: a sampler adds keys to <see cref="Values"/> without
    /// any change to this type, and a recording stays valid across such
    /// changes because replay only carries the keys.
    ///
    /// <para>Treat a snapshot as immutable. The same instance goes to every
    /// sampler and mapper for the tick, and is read on another thread after
    /// the tick returns, so mutating <see cref="Values"/> corrupts what the
    /// others see and races with that read.</para>
    /// <internal>Returned by <c>Sitrep.Host.IKspHost.Sample</c>. Declared here
    /// rather than in Sitrep.Host because <c>IUplinkHost.AddSampler</c> hands it
    /// to a third-party Uplink, which references only this assembly.</internal>
    /// </summary>
    /// <category>Channels and emission</category>
    public sealed class KspSnapshot
    {
        /// <summary>The game time the snapshot was taken at, in seconds of universal time (KSP's <c>Planetarium.GetUniversalTime()</c>).</summary>
        public double Ut { get; set; }

        /// <summary>The sampled values, keyed by group name. Each value is a primitive, a string, a list, or a nested <c>Dictionary&lt;string, object?&gt;</c> of the same. Never null.</summary>
        public Dictionary<string, object?> Values { get; set; } = new Dictionary<string, object?>();

        // A snapshot handed to ChannelEngine.Tick is shared by every sampler and mapper and read later on the Courier thread, so it must not be mutated once Sample() returns it.
    }
}

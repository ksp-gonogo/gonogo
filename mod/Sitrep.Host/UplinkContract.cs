using System;
using System.Collections.Generic;
using Sitrep.Core;

namespace Sitrep.Host
{
    /// <summary>
    /// Which outbox lane a channel's samples ride, per
    /// <c>local_docs/telemetry-mod/uplink-sdk-contract-design.md</c> §1.1.
    /// <see cref="LossyLatest"/> is the <see cref="ChannelEngine"/>'s default:
    /// the outbox coalesces to the freshest sample per topic (the shape
    /// <c>GonogoBodiesServer</c>'s <c>GonogoOutbox._latestByTopic</c> already
    /// implemented). <see cref="ReliableOrdered"/> rides the outbox's FIFO
    /// reliable lane instead — every sample is delivered, in order, never
    /// coalesced away (kOS terminal output is the load-bearing example the
    /// design doc names: a dropped keystroke is wrong in a way a dropped
    /// telemetry tick isn't).
    /// </summary>
    public enum Delivery
    {
        LossyLatest,
        ReliableOrdered,
    }

    /// <summary>
    /// One channel an uplink declares in its <see cref="UplinkManifest"/>
    /// — the wire-visible metadata <see cref="ChannelEngine.AddChannelSource"/>
    /// looks up by <see cref="Topic"/> when an uplink calls it during
    /// <see cref="ISitrepUplink.Register"/>. Declaring a channel here
    /// BEFORE registering its mapper is the manifest-first rule the design
    /// doc's §1.1 table describes: the manifest is the source of truth for
    /// <see cref="Delivery"/> and <see cref="Emission"/>, not the call site.
    /// </summary>
    public sealed class ChannelDeclaration
    {
        public string Topic { get; set; } = "";
        public Delivery Delivery { get; set; } = Delivery.LossyLatest;
        public EmissionPolicy Emission { get; set; } = null!;
    }

    /// <summary>
    /// One command an uplink declares. <see cref="Delayed"/> defaults to
    /// <c>true</c> (a normal vessel command rides the Courier's light-time
    /// delay); ground-infrastructure commands (negotiation, archive file
    /// ops) set it <c>false</c> so <see cref="ChannelEngine.DispatchCommand"/>
    /// bypasses the Courier entirely — see the design doc §4.3's kerbcast
    /// negotiate discussion for why this flag exists.
    /// </summary>
    public sealed class CommandDeclaration
    {
        public string Command { get; set; } = "";
        public bool Delayed { get; set; } = true;
    }

    /// <summary>
    /// The manifest an <see cref="ISitrepUplink"/> exposes — one
    /// registry-unique <see cref="Id"/>, one shared semver <see cref="Version"/>,
    /// and every channel/command it owns. See the design doc §1.1: this is
    /// generated from the C# side in the full contract; here it's simply the
    /// authored source of truth the engine reads at <see cref="ISitrepUplink.Register"/>
    /// time.
    /// </summary>
    public sealed class UplinkManifest
    {
        public string Id { get; set; } = "";
        public string Version { get; set; } = "";
        public IReadOnlyList<ChannelDeclaration> Channels { get; set; } = Array.Empty<ChannelDeclaration>();
        public IReadOnlyList<CommandDeclaration> Commands { get; set; } = Array.Empty<CommandDeclaration>();
    }

    /// <summary>
    /// Fail-soft status for one registered uplink — see the design doc
    /// §1.4 handshake shape. An uplink that throws (or explicitly calls
    /// <see cref="IUplinkHost.SetAvailability"/>) during
    /// <see cref="ISitrepUplink.Register"/> is marked unavailable rather
    /// than crashing the whole engine; every OTHER already/later-registered
    /// uplink is unaffected.
    /// </summary>
    public readonly struct Availability
    {
        public bool IsAvailable { get; }
        public string? Reason { get; }

        private Availability(bool isAvailable, string? reason)
        {
            IsAvailable = isAvailable;
            Reason = reason;
        }

        public static readonly Availability Available = new Availability(true, null);

        public static Availability Unavailable(string reason) => new Availability(false, reason);
    }

    /// <summary>
    /// Contributes raw fragments into a <see cref="KspSnapshot"/> each sample
    /// tick — the C# port of the design doc's <c>ISnapshotSampler</c> (§1.2).
    /// Registered via <see cref="IUplinkHost.AddSampler"/>. Not needed by
    /// <c>system.bodies</c> today (<c>KspHost.Sample</c> already populates
    /// the "bodies" key unconditionally) — this exists so a FUTURE uplink
    /// whose data isn't already on the snapshot has somewhere to hook in
    /// without the engine knowing anything KSP-specific.
    /// </summary>
    public interface ISnapshotSampler
    {
        void Sample(KspSnapshot snapshot);
    }

    /// <summary>
    /// Push-style publisher for event-driven / in-process channel sources
    /// (kOS callbacks, GameEvents) — the counterpart to the pull-style
    /// <see cref="IUplinkHost.AddChannelSource"/> mapper. Obtained via
    /// <see cref="IUplinkHost.Publisher"/>; <see cref="Publish"/> is safe
    /// to call from the main thread only (it hands off to the engine's own
    /// job queue, same as <see cref="ChannelEngine.Tick"/>).
    /// </summary>
    public interface IChannelPublisher
    {
        void Publish(object? payload, double ut);
    }

    /// <summary>
    /// What <see cref="ChannelEngine"/> hands an <see cref="ISitrepUplink"/>
    /// during <see cref="ISitrepUplink.Register"/> — see the design doc
    /// §1.2. Uplinks register PURE pieces here; they never touch the
    /// transport, the Courier, or threading directly — the engine runs
    /// everything registered through this interface.
    /// </summary>
    public interface IUplinkHost
    {
        double NowUt();

        /// <summary>Contribute a sampler that augments the snapshot handed to <see cref="ChannelEngine.Tick"/>. See <see cref="ISnapshotSampler"/>.</summary>
        void AddSampler(ISnapshotSampler sampler);

        /// <summary>
        /// Pull-style channel source: a KSP-free mapper, snapshot -&gt; typed
        /// payload, for a topic the calling uplink already declared in
        /// its <see cref="UplinkManifest.Channels"/>. Exactly
        /// <c>SystemViewProvider.BuildSystemBodies</c>'s shape — the engine
        /// change-gates the result and records it into the Courier.
        /// </summary>
        void AddChannelSource(string topic, Func<KspSnapshot?, object?> map);

        /// <summary>Push-style channel source — see <see cref="IChannelPublisher"/>.</summary>
        IChannelPublisher Publisher(string topic);

        /// <summary>
        /// Registers the handler for a command the calling uplink already
        /// declared in its <see cref="UplinkManifest.Commands"/>. Whether
        /// this rides the Courier's delay is decided by that declaration's
        /// <see cref="CommandDeclaration.Delayed"/> flag, not by this call.
        /// </summary>
        void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler);

        /// <summary>The C# port of <c>mod/sitrep-kernel</c>'s capability/provider registry (see <see cref="Kernel"/>).</summary>
        Kernel Kernel { get; }

        /// <summary>Fail-soft: flag the CURRENTLY-registering uplink as unavailable (see <see cref="Availability"/>).</summary>
        void SetAvailability(Availability availability);

        /// <summary>
        /// Force an unconditional keyframe on <paramref name="topic"/>'s
        /// NEXT <c>ChannelEmitter.Decide</c> call — the same mechanism a
        /// genuine 0→1 subscribe transition already uses (see
        /// <c>ChannelEmitter.NotifySubscribed</c>). The load-bearing use
        /// case is a subject-provenance epoch (see
        /// <see cref="VesselEpochSampler"/>): when the thing a channel
        /// describes changes identity mid-stream, the NEXT sample must be
        /// an unconditional keyframe, not something a deadband/cadence gate
        /// can suppress or delay. MUST be called only from within a
        /// registered <see cref="ISnapshotSampler.Sample"/> or a command
        /// handler — both of which the engine already runs exclusively on
        /// its Courier thread; calling this from arbitrary main-thread code
        /// would race the emitter's per-channel state with no
        /// synchronization.
        /// </summary>
        void ForceKeyframe(string topic);

        /// <summary>
        /// Clears the "has this channel ever emitted a non-null value"
        /// birth-guard (see <c>ChannelEngine</c>'s <c>_born</c> field doc
        /// comment) for EXACTLY the given <paramref name="topics"/>, WITHOUT
        /// touching the emitter's force-keyframe state (compare
        /// <see cref="ForceKeyframe"/>, which this is meant to be called
        /// ALONGSIDE, not instead of). The M2 subject-scoped-birth seam: a
        /// subject switch (see <see cref="VesselEpochSampler"/>) calls this
        /// for every topic it owns so a channel the NEW subject has never
        /// populated goes back to "not yet a subject" — rather than
        /// inheriting the PREVIOUS subject's birth state and emitting a
        /// spurious tombstone for data the new subject simply never had.
        /// MUST be called only from within a registered
        /// <see cref="ISnapshotSampler.Sample"/> or a command handler — same
        /// Courier-thread-only rule as <see cref="ForceKeyframe"/>.
        /// </summary>
        void ResetChannelBirth(IEnumerable<string> topics);
    }

    /// <summary>
    /// One self-contained uplink — the C# half of the design doc's
    /// two-half contract (§1.1). Ships in GameData; registers PURE pieces
    /// (channel sources, command handlers, capability providers) against an
    /// <see cref="IUplinkHost"/> and never touches transport/threading
    /// itself. <c>system.bodies</c>'s retrofit
    /// (<c>Gonogo.KSP.SystemUplink</c>) is the reference implementation —
    /// see the design doc §6.1.
    /// </summary>
    public interface ISitrepUplink
    {
        UplinkManifest Manifest { get; }

        /// <summary>
        /// Called once, on the main thread, by <see cref="ChannelEngine.RegisterUplink"/>.
        /// Throwing here (or calling <see cref="IUplinkHost.SetAvailability"/>
        /// with an unavailable status) fail-softs THIS uplink only — every
        /// other registered uplink is unaffected.
        /// </summary>
        void Register(IUplinkHost host);
    }
}

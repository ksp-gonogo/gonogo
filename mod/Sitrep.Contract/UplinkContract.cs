using System;
using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// Which outbox lane a channel's samples ride, per
    /// <c>local_docs/telemetry-mod/uplink-sdk-contract-design.md</c> §1.1.
    /// <see cref="LossyLatest"/> is the <see cref="Sitrep.Host.ChannelEngine"/>'s default:
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
    /// A channel's delay disposition — Minor-bump addition backing/replacing
    /// the hardcoded topic-name-keyed delay routing that used to live only
    /// client-side (<c>packages/sitrep-client/src/</c>). See
    /// <c>local_docs/telemetry-mod/delay-architecture-resolution.md</c> §3
    /// for the settled rule this enum encodes per-channel instead of by
    /// convention: everything is <see cref="Delayed"/> (rides the Courier's
    /// light-time delay clock) unless it's a ground-side fact with no
    /// analogue in flight (e.g. <c>scansat.available</c> — is the SCANsat
    /// assembly even present — which is <see cref="TrueNow"/>, delivered
    /// immediately, bypassing the delay clock entirely).
    /// </summary>
    public enum DelayRole
    {
        Delayed,
        TrueNow,
    }

    /// <summary>
    /// One channel an uplink declares in its <see cref="UplinkManifest"/>
    /// — the wire-visible metadata <see cref="Sitrep.Host.ChannelEngine.AddChannelSource"/>
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

        /// <summary>
        /// Defaults to <see cref="DelayRole.Delayed"/> — mirrors
        /// <see cref="CommandDeclaration.Delayed"/>'s own default-true
        /// precedent, and is the contract-conservative choice: nothing in
        /// <see cref="Sitrep.Host.ChannelEngine"/> branches on this value
        /// today (it is purely declarative, feeding the SDK/client's future
        /// delay routing), so EVERY existing bundled channel's host-observable
        /// behavior is unchanged regardless of what this defaults to — see
        /// the ContractDelayDispositionTests round-trip test and the
        /// contract-dynamic-delay-report.md for the "no behavior change"
        /// proof. Every bundled channel (vessel/system/career/science/parts)
        /// nonetheless sets this EXPLICITLY at its declaration site rather
        /// than relying on the default, so the disposition is provable by
        /// reading the declaration, not inferred from silence.
        /// </summary>
        public DelayRole Delay { get; set; } = DelayRole.Delayed;

        /// <summary>
        /// Opt-in for a channel that is LEGITIMATELY empty from its very
        /// first tick (e.g. <c>vessel.target</c> with no target selected,
        /// <c>vessel.dock</c> with no docking port aligned, <c>vessel.crew</c>
        /// with no crew aboard) — a real, present subject whose value can
        /// simply be null, as opposed to "no subject yet" (main menu, before
        /// <c>FlightGlobals</c> is ready). Defaults to <c>false</c>, which
        /// preserves the pre-existing behavior: <see cref="Sitrep.Host.ChannelEngine.ProcessTick"/>'s
        /// birth-gate skips a null mapper result for a channel that has
        /// never emitted a real value, so the client never learns the
        /// channel is absent and shows "SYNCING" forever. Setting this
        /// <c>true</c> makes the engine fall through to
        /// <c>ChannelEmitter.Decide</c> even from birth, emitting a
        /// confirmed-empty tombstone (null payload) on the first tick so
        /// the client shows "NO DATA" instead.
        /// </summary>
        public bool AbsenceIsData { get; set; } = false;
    }

    /// <summary>
    /// One command an uplink declares. <see cref="Delayed"/> defaults to
    /// <c>true</c> (a normal vessel command rides the Courier's light-time
    /// delay); ground-infrastructure commands (negotiation, archive file
    /// ops) set it <c>false</c> so <see cref="Sitrep.Host.ChannelEngine.DispatchCommand"/>
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
    /// job queue, same as <see cref="Sitrep.Host.ChannelEngine.Tick"/>).
    /// </summary>
    public interface IChannelPublisher
    {
        void Publish(object? payload, double ut);
    }

    /// <summary>
    /// A registered dynamic namespace's emitter factory — returned by
    /// <see cref="IUplinkHost.RegisterDynamicNamespace"/>. Generalizes the
    /// fixed single-topic <see cref="IUplinkHost.Publisher"/> to a
    /// runtime-computed sub-topic under a declared prefix (e.g.
    /// <c>scansat.coverage.</c> + <c>"Kerbin.AltimetryLoRes"</c> =
    /// <c>scansat.coverage.Kerbin.AltimetryLoRes</c>) — the mechanism U1's
    /// GonogoScansatUplink report flagged as missing (see
    /// <c>.superpowers/sdd/u1-scansat-uplink-report.md</c>'s "Known,
    /// disclosed gap"). Each concrete <c>prefix + subTopic</c> gets its own
    /// independent <see cref="Sitrep.Host.ChannelEmitter"/>
    /// keyframe-on-change/lossy-latest-value state, exactly as though it had
    /// been declared as an ordinary fixed <see cref="ChannelDeclaration"/> —
    /// the ENGINE materializes that declaration (cloned from the
    /// <see cref="ChannelDeclaration"/> template passed to
    /// <see cref="IUplinkHost.RegisterDynamicNamespace"/>) the first time a
    /// concrete sub-topic is published or subscribed, so subscribers can
    /// target a concrete dynamic topic string exactly as they would a fixed
    /// one — no protocol change on the wire.
    /// </summary>
    public interface IDynamicChannelSource
    {
        /// <summary>Publisher for one concrete sub-topic (<c>prefix + subTopic</c>) under this dynamic namespace.</summary>
        IChannelPublisher Publisher(string subTopic);

        /// <summary>
        /// Registers <paramref name="callback"/> to run on the COURIER
        /// thread every time ANY concrete sub-topic under this namespace's
        /// prefix sees an individual, PER-SESSION subscribe transition —
        /// one call per <c>ProcessSubscribe</c>, regardless of whether the
        /// topic's aggregate subscriber count actually changed (a second
        /// viewer joining an already-subscribed topic, or a resubscribe
        /// faster than a polling consumer's own cadence, both still fire
        /// it). This is the thread-safe seam a consumer that needs to react
        /// to "a specific viewer just subscribed" — e.g. seeding a full
        /// repaint baseline for a fresh terminal viewer — should use
        /// INSTEAD of polling a subscriber count from another thread; it
        /// deliberately does not expose (and its caller must never read)
        /// the engine's Courier-thread-only <c>_subscriptions</c> registry.
        ///
        /// <para>Call only during the owning uplink's
        /// <see cref="ISitrepUplink.Register"/>, before the engine starts —
        /// same registration-time-only discipline as
        /// <see cref="IUplinkHost.AddSampler"/> /
        /// <see cref="IUplinkHost.AddChannelSource"/>. The callback itself
        /// runs on the Courier thread (never the registering thread) and
        /// must be safe to call from there; an exception it throws is
        /// caught and logged by the engine so it can never wedge the
        /// Courier thread, but the callback will, in effect, silently
        /// no-op for that invocation.</para>
        /// </summary>
        void OnSubscribed(Action<string> callback);
    }

    /// <summary>
    /// What <see cref="Sitrep.Host.ChannelEngine"/> hands an <see cref="ISitrepUplink"/>
    /// during <see cref="ISitrepUplink.Register"/> — see the design doc
    /// §1.2. Uplinks register PURE pieces here; they never touch the
    /// transport, the Courier, or threading directly — the engine runs
    /// everything registered through this interface.
    /// </summary>
    public interface IUplinkHost
    {
        double NowUt();

        /// <summary>Contribute a sampler that augments the snapshot handed to <see cref="Sitrep.Host.ChannelEngine.Tick"/>. See <see cref="ISnapshotSampler"/>.</summary>
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
        /// A <b>capture-on-main / handle-on-Courier</b> source — the
        /// threading-safe seam for an Uplink that must read live KSP/Unity
        /// (or another mod's) APIs that are NOT already on the shared
        /// <see cref="KspSnapshot"/>. Unity APIs are main-thread-only; every
        /// other registration point on this interface either runs off the
        /// main thread (<see cref="AddChannelSource"/>'s mapper and
        /// <see cref="ISnapshotSampler.Sample"/> both run on the engine's
        /// Courier thread) or is fed pre-built snapshot data — so before this
        /// existed a third-party Uplink had no way to read a live API safely,
        /// and doing it from a Courier-thread mapper/sampler is a crash /
        /// garbage-data risk.
        ///
        /// <para><paramref name="captureOnMainThread"/> runs on the SAME
        /// thread and at the SAME cadence the <see cref="KspSnapshot"/> is
        /// built — the Unity main thread, inside <c>GonogoAddon.FixedUpdate</c>
        /// in production (a test driver calls it on whatever thread invokes
        /// <c>ChannelEngine.Tick</c>). It is handed that tick's snapshot (for
        /// <see cref="KspSnapshot.Ut"/> and any already-sampled data) and
        /// returns an OPAQUE payload — plain, self-contained data, NO live
        /// KSP/Unity object references — which the engine carries across to
        /// the Courier thread.</para>
        ///
        /// <para><paramref name="handleOnCourier"/> then runs on the Courier
        /// thread with exactly that captured payload, and does all the
        /// off-thread work: change-gating, packing, and publishing to
        /// channels obtained via <see cref="Publisher"/> /
        /// <see cref="RegisterDynamicNamespace"/>. It MUST NOT touch any
        /// KSP/Unity API — that is the whole reason this seam exists; read
        /// everything KSP-facing in <paramref name="captureOnMainThread"/>
        /// and pass it forward as data.</para>
        ///
        /// <para>Fail-soft, mirroring <see cref="AddSampler"/> /
        /// <see cref="AddChannelSource"/>: a capture OR handle that throws
        /// takes only its own registration's owning Uplink inert (from the
        /// next tick onward) — every other source, and the rest of THIS tick,
        /// continues.</para>
        /// </summary>
        void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier);

        /// <summary>
        /// Subscription-gated overload of <see cref="AddSampledSource(Func{KspSnapshot?, object?}, Action{object?})"/>
        /// — identical capture-on-main / handle-on-Courier semantics, plus
        /// <paramref name="subscriptionTopicPrefixes"/>: the set of channel-topic
        /// prefixes this source PRODUCES (e.g. <c>"scansat.coverage."</c>). When
        /// given, the engine SKIPS <paramref name="captureOnMainThread"/> entirely
        /// on any tick where NO currently-subscribed topic starts with any of these
        /// prefixes — so a source that does expensive main-thread work (grid copies,
        /// stock-API reads) burns nothing while no client is looking. Pass the
        /// prefix(es) an <see cref="RegisterDynamicNamespace"/> owns, and/or the exact
        /// topics a <see cref="Publisher"/> targets (an exact topic is its own prefix).
        ///
        /// <para>The gate is a pure early-out, never a correctness change: a late
        /// subscriber still gets the current value the ordinary way (the emitter's
        /// keyframe-on-subscribe + the Courier archive's catch-up), because the very
        /// next capture after a 0-&gt;1 subscription runs again. Omitting this overload
        /// (or passing no prefixes) preserves the original always-capture behaviour.</para>
        /// </summary>
        void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier, params string[] subscriptionTopicPrefixes);

        /// <summary>
        /// Point-in-time query: is at least one currently-subscribed channel
        /// topic prefixed by <paramref name="topicPrefix"/> (ordinal
        /// <c>StartsWith</c>)? This is the same subscription-awareness the
        /// gated <see cref="AddSampledSource(Func{KspSnapshot?, object?}, Action{object?}, string[])"/>
        /// overload applies internally, exposed for an Uplink whose expensive
        /// capture is NOT driven by the engine's sampled-source loop but by an
        /// external callback it cannot gate declaratively — e.g. the kOS
        /// Uplink's <c>ScreenBuffer.Print</c> Harmony postfix, which fires on
        /// EVERY kerboscript <c>PRINT</c> and must short-circuit to nothing
        /// while no <c>kos.compute.*</c> subscriber exists.
        ///
        /// <para>Reads the engine's thread-safe subscribed-topics mirror, so it
        /// is safe to call from the KSP main thread (where the postfix runs) as
        /// well as the Courier thread. Like the sampled-source gate it is a pure
        /// early-out hint, never a correctness gate: a late subscriber still
        /// gets the current value the ordinary way (keyframe-on-subscribe +
        /// archive catch-up).</para>
        /// </summary>
        bool IsAnyTopicSubscribed(string topicPrefix);

        /// <summary>
        /// Declares a dynamic namespace: a <paramref name="prefix"/> the
        /// calling uplink owns, plus a <paramref name="template"/>
        /// <see cref="ChannelDeclaration"/> (its <see cref="ChannelDeclaration.Topic"/>
        /// is ignored — every materialized sub-topic gets its own) whose
        /// <see cref="ChannelDeclaration.Delivery"/>/<see cref="ChannelDeclaration.Emission"/>/
        /// <see cref="ChannelDeclaration.Delay"/> apply to every concrete
        /// <c>prefix + subTopic</c> the returned <see cref="IDynamicChannelSource"/>
        /// is asked to publish. Unlike a fixed <see cref="ChannelDeclaration"/>,
        /// nothing under this prefix needs to be individually pre-declared
        /// in <see cref="UplinkManifest.Channels"/> — see
        /// <see cref="IDynamicChannelSource"/>'s doc comment for the
        /// per-concrete-topic keyframe/lossy semantics this preserves.
        /// </summary>
        IDynamicChannelSource RegisterDynamicNamespace(string prefix, ChannelDeclaration template);

        /// <summary>
        /// Registers the handler for a command the calling uplink already
        /// declared in its <see cref="UplinkManifest.Commands"/>. Whether
        /// this rides the Courier's delay is decided by that declaration's
        /// <see cref="CommandDeclaration.Delayed"/> flag, not by this call.
        /// </summary>
        void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler);

        /// <summary>
        /// Advertise the AUTHORITATIVE <c>comms.delay</c> one-way signal delay to
        /// the engine's server-side reveal gate — the choke point that makes
        /// <see cref="DelayRole.Delayed"/> channels actually withheld on the host
        /// (spec-streaming-delay-model §4 / §7.3 Step 2). <paramref name="computeOnMainThread"/>
        /// is evaluated on the SAME thread and cadence as
        /// <see cref="AddSampledSource(Func{KspSnapshot?, object?}, Action{object?})"/>'s
        /// capture (the Unity main thread in production), so it may safely read
        /// the live elected comms backend, and it runs EVERY tick regardless of
        /// what any client has subscribed — that subscription-independence is the
        /// whole point.
        ///
        /// <para><b>Why this exists as a first-class seam:</b> the bundled
        /// comms uplink publishes <c>comms.delay</c> through a
        /// <see cref="Publisher"/> fed by a capture-on-main /
        /// handle-on-Courier <see cref="AddSampledSource"/> (live KSP reads must
        /// stay on the main thread). That is NOT the pull-style
        /// <see cref="AddChannelSource"/> shape the engine's per-tick delay
        /// refresh could read, and the publish path is subscription-gated — so
        /// with the production registration the reveal gate never learned the
        /// delay and delivered Delayed channels live. This seam hands the gate
        /// the delay directly, computed server-side, subscription-independent.</para>
        ///
        /// <para>Fail-soft, mirroring the other registration points: a
        /// <paramref name="computeOnMainThread"/> that throws takes only its
        /// owning uplink inert (from the next tick onward); a <c>null</c> result
        /// (or a <see cref="CommsDelaySource.None"/> / non-positive value) leaves
        /// the last-known delay untouched and never reveals a Delayed channel
        /// earlier than the known horizon. Registering no source at all keeps
        /// today's behaviour: with no delay authority every channel is revealed
        /// live.</para>
        /// </summary>
        void SetSignalDelaySource(Func<KspSnapshot?, CommsDelay?> computeOnMainThread);

        /// <summary>
        /// Advertise the AUTHORITATIVE CONNECTED/DISCONNECTED control-link state
        /// to the engine's server-side reveal gate — the freeze-on-disconnect
        /// half of the enforcement <see cref="SetSignalDelaySource"/> started
        /// (spec-streaming-delay-model). <paramref name="computeOnMainThread"/>
        /// is evaluated on the SAME thread and cadence as
        /// <see cref="SetSignalDelaySource"/> (the Unity main thread in
        /// production, every tick, subscription-independently), so it may safely
        /// read the elected comms backend's connectivity.
        ///
        /// <para><b>Why distinct from delay magnitude:</b> a down link produces a
        /// <see cref="CommsDelaySource.None"/> / zero delay that is
        /// INDISTINGUISHABLE from a genuine connected, in-LOS, zero-distance
        /// link. Delay 0 alone must still reveal live; only a real DISCONNECTED
        /// state freezes. When disconnected the gate withholds every
        /// <see cref="DelayRole.Delayed"/> channel (nothing new delivered =
        /// frozen at last-known) while <see cref="DelayRole.TrueNow"/> channels
        /// (comms.delay / comms.connectivity / time.* / system.bodies) keep
        /// flowing, so the operator sees the outage live; on reconnect the
        /// withheld backlog is dropped and delivery resumes from the reconnect
        /// moment.</para>
        ///
        /// <para>Fail-soft, mirroring <see cref="SetSignalDelaySource"/>: a
        /// throwing source takes only its owning uplink inert and reverts the
        /// gate to CONNECTED; a <c>null</c> result leaves the last-known state
        /// untouched; registering no source at all keeps today's behaviour (the
        /// gate treats the link as always CONNECTED — never worse than the
        /// pre-freeze LAN path).</para>
        /// </summary>
        void SetConnectivitySource(Func<KspSnapshot?, bool?> computeOnMainThread);

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
        /// <see cref="Sitrep.Host.VesselEpochSampler"/>): when the thing a channel
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
        /// subject switch (see <see cref="Sitrep.Host.VesselEpochSampler"/>) calls this
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
    ///
    /// <para><b>Lives in <c>Sitrep.Contract</c>, not <c>Sitrep.Host</c>
    /// (moved here in the Uplink-foundation review's fix round):</b> this
    /// interface, <see cref="UplinkManifest"/>, <see cref="IUplinkHost"/>,
    /// and everything else <see cref="Register"/>'s signature transitively
    /// needs (<see cref="ChannelDeclaration"/>, <see cref="CommandDeclaration"/>,
    /// <see cref="Delivery"/>, <see cref="Availability"/>,
    /// <see cref="ISnapshotSampler"/>, <see cref="IChannelPublisher"/>,
    /// <see cref="Sitrep.Contract.KspSnapshot"/>, <see cref="Kernel"/>, and
    /// <see cref="EmissionPolicy"/>) are the COMPLETE set a third-party
    /// Uplink needs to implement this interface and compile against
    /// <c>Sitrep.Contract</c> ALONE — no reference to <c>Sitrep.Host</c>
    /// (the engine: <c>ChannelEngine</c>, discovery, transport) is ever
    /// required. That's the whole point of the split: <c>Sitrep.Contract</c>
    /// is the planned MIT/BSD carve-out, and an Uplink author's compile-time
    /// surface must not leak engine internals. <c>Sitrep.Host</c> keeps
    /// everything ELSE — the engine that CONSUMES this interface
    /// (<c>ChannelEngine.RegisterUplink</c>/<c>RegisterDiscoveredUplink</c>)
    /// and the assembly-scan discovery that finds implementations of it
    /// (<c>UplinkDiscovery</c>) both still live there; only the SHAPE an
    /// Uplink author programs against moved.</para>
    /// </summary>
    public interface ISitrepUplink
    {
        UplinkManifest Manifest { get; }

        /// <summary>
        /// Called once, on the main thread, by <see cref="Sitrep.Host.ChannelEngine.RegisterUplink"/>.
        /// Throwing here (or calling <see cref="IUplinkHost.SetAvailability"/>
        /// with an unavailable status) fail-softs THIS uplink only — every
        /// other registered uplink is unaffected.
        /// </summary>
        void Register(IUplinkHost host);
    }

    /// <summary>
    /// OPTIONAL companion to <see cref="ISitrepUplink"/> that lets an uplink
    /// declare its capability descriptors in a discovery pass that runs BEFORE
    /// any uplink's <see cref="ISitrepUplink.Register"/> — the two-pass fix for
    /// the capability-vs-provider registration-order hazard.
    ///
    /// <para><b>The problem this closes:</b> <see cref="Kernel.RegisterProvider"/>
    /// throws if the capability it targets has not been registered yet, and
    /// assembly-scan discovery (<c>AppDomain.GetAssemblies()</c> /
    /// <c>GetTypes()</c>) fixes NO order between uplinks. So an uplink that
    /// registers a <c>"comms"</c> PROVIDER (e.g. RealAntennas) could run before
    /// the uplink that owns the <c>"comms"</c> CAPABILITY — the provider
    /// registration would throw, be swallowed, and the provider would silently
    /// never take part in the election even though it loaded.</para>
    ///
    /// <para><b>The contract:</b> an uplink that owns a capability declares it
    /// here (via <see cref="Kernel.RegisterCapability"/>) instead of in
    /// <see cref="ISitrepUplink.Register"/>. The host runs
    /// <see cref="DeclareCapabilities"/> for EVERY discovered uplink first, so
    /// by the time any <see cref="ISitrepUplink.Register"/> runs its
    /// <see cref="Kernel.RegisterProvider"/> call, the target capability is
    /// guaranteed present regardless of discovery order. PROVIDERS still
    /// register in <see cref="ISitrepUplink.Register"/> as before — only
    /// capability DECLARATIONS move to this earlier pass. Implementing this
    /// interface is optional: an uplink that registers no capability of its own
    /// (every provider-only or channel-only uplink) does not need it.</para>
    ///
    /// <para>Not shape-gated: this is an SPI interface on the Uplink-facing
    /// surface, not a <c>[SitrepContract]</c> wire type, so adding it is an
    /// additive Minor change that does not bump <see cref="ContractVersion"/>.</para>
    /// </summary>
    public interface IUplinkCapabilityDeclarer
    {
        /// <summary>
        /// Register this uplink's capability descriptor(s) on
        /// <paramref name="kernel"/>. Runs once, on the main thread, in the
        /// pre-<see cref="ISitrepUplink.Register"/> discovery pass. Throwing here
        /// fail-softs THIS uplink only (its <see cref="ISitrepUplink.Register"/>
        /// is then skipped); every other uplink is unaffected.
        /// </summary>
        void DeclareCapabilities(Kernel kernel);
    }

    /// <summary>
    /// Coarse self-reported health for one <see cref="ISitrepUplink"/> — see
    /// <see cref="IUplinkHealthReporter"/>.
    /// </summary>
    public enum UplinkHealthState
    {
        Healthy,
        Degraded,
        Unavailable,
    }

    /// <summary>
    /// One <see cref="IUplinkHealthReporter.Health"/> result — a coarse
    /// <see cref="State"/> plus an OPTIONAL uplink-authored <see cref="Detail"/>
    /// string explaining what "ready" means for THIS uplink (e.g. "no active
    /// CPU selected" for kOS, "no comms backend elected" for comms). The
    /// engine never fabricates or parses <see cref="Detail"/> — it is opaque,
    /// display-only text the uplink itself writes.
    /// </summary>
    public readonly struct UplinkHealth
    {
        public UplinkHealthState State { get; }
        public string? Detail { get; }

        public UplinkHealth(UplinkHealthState state, string? detail = null)
        {
            State = state;
            Detail = detail;
        }
    }

    /// <summary>
    /// OPTIONAL companion to <see cref="ISitrepUplink"/> that lets an uplink
    /// SELF-REPORT its health, instead of the client inferring readiness from
    /// topic staleness (the design this closes off — see
    /// <c>local_docs/telemetry-mod/uplink-health-design.md</c>: only the
    /// uplink itself knows what "ready" means for it — kOS needs an active
    /// CPU selected, comms needs a backend elected, a channel-only uplink
    /// might just mean "registered without error"). The engine aggregates
    /// every registered uplink's <see cref="Health"/> (falling back to plain
    /// <see cref="Availability"/> for an uplink that doesn't implement this)
    /// into the built-in <c>system.uplinks</c> channel — see
    /// <see cref="Sitrep.Host.ChannelEngine"/>'s doc comment on that channel.
    ///
    /// <para>Implementing this interface is optional: the 14 built-in
    /// Uplinks that predate it need NO change — this is an additive Minor
    /// change, not a contract break. An uplink that implements it is
    /// responsible for keeping <see cref="Health"/> fast and non-blocking
    /// (it is polled every <c>system.uplinks</c> sample, on the Courier/tick
    /// thread — see the call site) and fail-soft in its OWN right where
    /// possible; the engine wraps the call in a try/catch regardless (a throw
    /// here is reported as <see cref="UplinkHealthState.Degraded"/> with the
    /// exception message as <see cref="UplinkHealth.Detail"/>, and does NOT
    /// affect the uplink's <see cref="Availability"/> or disable its other
    /// channels/commands — this is a read, not a registration step).</para>
    /// </summary>
    public interface IUplinkHealthReporter
    {
        /// <summary>
        /// Returns this uplink's current health. Called on the tick/Courier
        /// thread while building <c>system.uplinks</c>; must be fail-soft
        /// (no throw expected, though the engine tolerates one — see this
        /// interface's doc comment) and cheap (no blocking I/O, no expensive
        /// computation — a simple state check like "is a CPU selected" or "is
        /// a backend elected").
        /// </summary>
        UplinkHealth Health();
    }
}

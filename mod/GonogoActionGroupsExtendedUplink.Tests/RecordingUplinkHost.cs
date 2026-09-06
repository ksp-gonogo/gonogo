using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.ActionGroupsExtendedUplink.Tests
{
    /// <summary>
    /// A host this uplink can be registered into and TICKED, written here rather
    /// than borrowed, because everything an Uplink's test project may reference is
    /// everything its author can install: <c>Sitrep.Contract</c>, and that is all
    /// this file names. <c>docs/uplink-isolation.md</c> ("Testing a NEW Uplink") is
    /// why this is written per-Uplink rather than reached for from a shared harness,
    /// and names the two sibling projects that answered the constraint the same way.
    ///
    /// <para><b>Its <see cref="Kernel"/> is a REAL one</b>, with the action-groups
    /// capability already declared on it. That is the order the engine guarantees:
    /// every capability is declared in a pass that completes before any Uplink's
    /// <c>Register</c> runs, so a registration can never race ahead of its
    /// declaration, and registering into an undeclared capability throws. A recorded
    /// list of registrations could not answer the question that matters here anyway,
    /// which is what the election then RESOLVES.</para>
    ///
    /// <para><b>Why ticking is here at all.</b> A capability fed by a
    /// subscription-gated capture is skipped on every tick where nothing under its
    /// prefixes is subscribed, so it goes stale and stays stale with no exception and
    /// no log line. This uplink takes no captures, so nothing about its answer can
    /// depend on a tick: <see cref="DriveTicks"/> exists so that stops being an
    /// assumption and starts being something a test drives, and so the day somebody
    /// feeds the backend from a gated reading it fails here rather than on an
    /// operator's rig. The gate rule below is <c>ChannelEngine.AnyTopicPrefixSubscribed</c>
    /// mirrored by hand, and this sentence is the coupling: if the engine's rule
    /// changes, this changes with it.</para>
    /// </summary>
    internal sealed class RecordingUplinkHost : IUplinkHost
    {
        private string[] _subscribedTopics = Array.Empty<string>();

        /// <summary>
        /// A real kernel with the action-groups capability declared exactly as core
        /// declares it (<c>Sitrep.Host.ActionGroups.ActionGroupsElection.RegisterCapability</c>,
        /// reached through <c>VesselUplink.DeclareCapabilities</c>): exclusive, not
        /// spine-critical, with a stock vanilla. The id is the contract's own, so the
        /// spelling here and the spelling this uplink registers against cannot drift.
        /// </summary>
        public RecordingUplinkHost(Func<ProviderContext, IActionGroupsBackend> vanillaFactory)
        {
            Kernel = new Kernel();
            Kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = ActionGroupsCapability.Id,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = ctx => vanillaFactory(ctx),
            });
        }

        public Kernel Kernel { get; }

        /// <summary>What the uplink last declared about itself, or null if it never did.</summary>
        public Availability? Availability { get; private set; }

        /// <summary>Every capture/handle pair registered, with its declared prefixes.</summary>
        public List<SampledSourceRecord> SampledSources { get; } = new List<SampledSourceRecord>();

        public List<ISnapshotSampler> Samplers { get; } = new List<ISnapshotSampler>();

        /// <summary>
        /// Runs the election, which the engine does once every Uplink has registered
        /// and before any tick. A capability queried before this resolves to nothing,
        /// which is a fact about the ORDER rather than about the registration.
        /// </summary>
        public void Resolve() => Kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });

        /// <summary>The elected action-groups backend, or null if none resolved.</summary>
        public IActionGroupsBackend? ElectedBackend() =>
            Kernel.Query<IActionGroupsBackend>(ActionGroupsCapability.Id);

        /// <summary>
        /// One engine tick, with <paramref name="subscribedTopics"/> standing for what
        /// clients currently hold. Gated sources whose prefixes nothing matches are
        /// skipped, exactly as the engine skips them; samplers run unconditionally,
        /// exactly as the engine runs them.
        /// </summary>
        public void DriveTick(KspSnapshot? snapshot, params string[] subscribedTopics)
        {
            _subscribedTopics = subscribedTopics ?? Array.Empty<string>();
            try
            {
                foreach (var source in SampledSources)
                {
                    if (!Reached(source, _subscribedTopics))
                    {
                        continue;
                    }
                    source.Handle(source.Capture(snapshot));
                }

                if (snapshot != null)
                {
                    foreach (var sampler in Samplers)
                    {
                        sampler.Sample(snapshot);
                    }
                }
            }
            finally
            {
                _subscribedTopics = Array.Empty<string>();
            }
        }

        /// <summary><paramref name="count"/> ticks under the same subscriptions.</summary>
        public void DriveTicks(int count, KspSnapshot? snapshot, params string[] subscribedTopics)
        {
            for (var i = 0; i < count; i++)
            {
                DriveTick(snapshot, subscribedTopics);
            }
        }

        private static bool Reached(SampledSourceRecord source, string[] subscribedTopics)
        {
            if (source.Prefixes.Count == 0)
            {
                return true;
            }
            foreach (var topic in subscribedTopics)
            {
                foreach (var prefix in source.Prefixes)
                {
                    if (topic.StartsWith(prefix, StringComparison.Ordinal))
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        /// <summary>One registered capture-on-main / handle-on-Courier pair.</summary>
        internal sealed class SampledSourceRecord
        {
            internal SampledSourceRecord(
                Func<KspSnapshot?, object?> capture,
                Action<object?> handle,
                IReadOnlyList<string> prefixes)
            {
                Capture = capture;
                Handle = handle;
                Prefixes = prefixes;
            }

            public Func<KspSnapshot?, object?> Capture { get; }

            public Action<object?> Handle { get; }

            /// <summary>The declared subscription prefixes; empty means ungated.</summary>
            public IReadOnlyList<string> Prefixes { get; }
        }

        public void AddSampledSource(
            Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier) =>
            SampledSources.Add(new SampledSourceRecord(
                captureOnMainThread, handleOnCourier, Array.Empty<string>()));

        public void AddSampledSource(
            Func<KspSnapshot?, object?> captureOnMainThread,
            Action<object?> handleOnCourier,
            params string[] subscriptionTopicPrefixes) =>
            SampledSources.Add(new SampledSourceRecord(
                captureOnMainThread, handleOnCourier, subscriptionTopicPrefixes));

        public void AddSampler(ISnapshotSampler sampler) => Samplers.Add(sampler);

        public void SetAvailability(Availability availability) => Availability = availability;

        /// <summary>
        /// Answered against the SAME set <see cref="DriveTick"/> gates on, so a handle
        /// deciding whether to publish sees exactly what the capture gate saw. Outside
        /// a tick nothing is subscribed, which is the honest answer at registration time.
        /// </summary>
        public bool IsAnyTopicSubscribed(string topicPrefix)
        {
            foreach (var topic in _subscribedTopics)
            {
                if (topic.StartsWith(topicPrefix, StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// Everything below throws rather than answering.
        ///
        /// <para>A host that quietly accepted every call would pass its callers'
        /// assertions while the Uplink did something else entirely on the way past.
        /// Throwing means the recorded set is the WHOLE set: this uplink declares no
        /// channels, no commands and no delay of its own, and if that stops being
        /// true the tests fail and say which seam it started using.</para>
        /// </summary>
        private static NotSupportedException NotExpected(string what) =>
            new NotSupportedException(
                "ActionGroupsExtendedUplink.Register is not expected to call " + what
                + "; if that changed, the recording above no longer describes what it does");

        public double NowUt() => throw NotExpected("NowUt");

        public void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler) =>
            throw NotExpected("AddCommandHandler");

        public void AddVantageCommandHandler<TArgs, TResult>(
            string command, Func<TArgs, string, TResult> handler) =>
            throw NotExpected("AddVantageCommandHandler");

        public IChannelPublisher Publisher(string topic) => throw NotExpected("Publisher");

        public void AddChannelSource(string topic, Func<KspSnapshot?, object?> map) =>
            throw NotExpected("AddChannelSource");

        public IDynamicChannelSource RegisterDynamicNamespace(
            string prefix, ChannelDeclaration template) =>
            throw NotExpected("RegisterDynamicNamespace");

        public void AddGateEvaluator(ICommandGateEvaluator evaluator) =>
            throw NotExpected("AddGateEvaluator");

        public void AddCommandRequirement(string command, CommandRequirement requirement) =>
            throw NotExpected("AddCommandRequirement");

        public void SetSignalDelaySource(Func<KspSnapshot?, CommsDelay?> computeOnMainThread) =>
            throw NotExpected("SetSignalDelaySource");

        public void SetVesselDelay(string vesselId, double oneWaySeconds) =>
            throw NotExpected("SetVesselDelay");

        public void SetAuthorityDelay(string centreId, string vesselId, double oneWaySeconds) =>
            throw NotExpected("SetAuthorityDelay");

        public void SetCentreDelay(string fromCentreId, string toCentreId, double oneWaySeconds) =>
            throw NotExpected("SetCentreDelay");

        public void SetVesselConnectivity(string vesselId, bool connected) =>
            throw NotExpected("SetVesselConnectivity");

        public void SetConnectivitySource(Func<KspSnapshot?, bool?> computeOnMainThread) =>
            throw NotExpected("SetConnectivitySource");

        public void SetPathBreakSource(Func<KspSnapshot?, double, PathBreak?> computeOnMainThread) =>
            throw NotExpected("SetPathBreakSource");

        public void ForceKeyframe(string topic) => throw NotExpected("ForceKeyframe");

        public void ResetChannelBirth(IEnumerable<string> topics) =>
            throw NotExpected("ResetChannelBirth");
    }
}

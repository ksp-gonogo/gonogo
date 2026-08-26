using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// A host an Uplink can be registered into and TICKED, so a test can ask what
    /// the Uplink answers under the subscriptions a client actually holds.
    ///
    /// <para><b>Why ticking is the whole point.</b> A capability fed by a
    /// subscription-gated capture is skipped on every tick where nothing under its
    /// prefixes is subscribed, so it goes stale and stays stale with no exception
    /// and no log line. A registration-shape assertion cannot see that: the source
    /// is registered either way. Driving ticks under a named set of subscriptions
    /// can, which is what <see cref="DriveTick"/> is for.</para>
    ///
    /// <para><b>The gate rule is mirrored, not shared.</b> A source with no declared
    /// prefixes always captures; one with prefixes captures only when some
    /// subscribed topic starts with one of them, ordinal. That is
    /// <c>ChannelEngine.AnyTopicPrefixSubscribed</c>, pinned on the engine side by
    /// its own tests. The two are coupled by hand and this sentence is the coupling:
    /// if the engine's rule changes, this changes with it.</para>
    ///
    /// <para>Its <see cref="Kernel"/> comes from the caller so that capabilities are
    /// declared the way core declares them, through the real election, rather than
    /// through a copy of core's descriptor that drifts from it.</para>
    /// </summary>
    public sealed class StarvationProbeHost : IUplinkHost
    {
        private string[] _subscribedTopics = Array.Empty<string>();

        public StarvationProbeHost(Kernel kernel)
        {
            Kernel = kernel ?? throw new ArgumentNullException(nameof(kernel));
        }

        public Kernel Kernel { get; }

        /// <summary>Every capture/handle pair registered, with its declared prefixes.</summary>
        public List<SampledSource> SampledSources { get; } = new List<SampledSource>();

        /// <summary>Every pull-style channel source, by topic.</summary>
        public Dictionary<string, Func<KspSnapshot?, object?>> ChannelSources { get; } =
            new Dictionary<string, Func<KspSnapshot?, object?>>(StringComparer.Ordinal);

        public List<ISnapshotSampler> Samplers { get; } = new List<ISnapshotSampler>();

        public List<string> CommandsRegistered { get; } = new List<string>();

        /// <summary>Every payload published, in order, with the topic it went to.</summary>
        public List<(string Topic, object? Payload)> Published { get; } =
            new List<(string, object?)>();

        public Availability? Availability { get; private set; }

        /// <summary>What was published to <paramref name="topic"/>, in order.</summary>
        public List<object?> PublishedTo(string topic) =>
            Published.Where(p => string.Equals(p.Topic, topic, StringComparison.Ordinal))
                .Select(p => p.Payload)
                .ToList();

        /// <summary>
        /// Runs the election, which the engine does once every Uplink has registered
        /// and before any tick. A capability queried before this resolves to
        /// nothing, which is a fact about the ORDER rather than about the
        /// registration.
        /// </summary>
        public void Resolve() =>
            Kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });

        /// <summary>
        /// One engine tick, with <paramref name="subscribedTopics"/> standing for
        /// what clients currently hold. Gated sources whose prefixes nothing matches
        /// are skipped, exactly as the engine skips them; samplers run
        /// unconditionally, exactly as the engine runs them.
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

        private static bool Reached(SampledSource source, string[] subscribedTopics)
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
        public sealed class SampledSource
        {
            internal SampledSource(
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

            /// <summary>Whether the engine skips this while nothing under its prefixes is subscribed.</summary>
            public bool Gated => Prefixes.Count > 0;

            /// <summary>The capture's method name, so a test can name the source it means.</summary>
            public string CaptureName => Capture.Method.Name;
        }

        public void AddSampledSource(
            Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier) =>
            SampledSources.Add(new SampledSource(
                captureOnMainThread, handleOnCourier, Array.Empty<string>()));

        public void AddSampledSource(
            Func<KspSnapshot?, object?> captureOnMainThread,
            Action<object?> handleOnCourier,
            params string[] subscriptionTopicPrefixes) =>
            SampledSources.Add(new SampledSource(
                captureOnMainThread, handleOnCourier, subscriptionTopicPrefixes));

        public void AddSampler(ISnapshotSampler sampler) => Samplers.Add(sampler);

        public void AddChannelSource(string topic, Func<KspSnapshot?, object?> map) =>
            ChannelSources[topic] = map;

        public IChannelPublisher Publisher(string topic) => new ProbePublisher(this, topic);

        public void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler) =>
            CommandsRegistered.Add(command);

        public void AddVantageCommandHandler<TArgs, TResult>(
            string command, Func<TArgs, string, TResult> handler) =>
            CommandsRegistered.Add(command);

        public void SetAvailability(Availability availability) => Availability = availability;

        /// <summary>
        /// Answered against the SAME set <see cref="DriveTick"/> gates on, so a
        /// handle deciding whether to publish sees exactly what the capture gate
        /// saw. Outside a tick nothing is subscribed, which is the honest answer at
        /// registration time.
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

        public double NowUt() => 0.0;

        public IDynamicChannelSource RegisterDynamicNamespace(
            string prefix, ChannelDeclaration template) => new ProbeNamespace(this, prefix);

        public void AddGateEvaluator(ICommandGateEvaluator evaluator)
        {
        }

        public void AddCommandRequirement(string command, CommandRequirement requirement)
        {
        }

        public void SetSignalDelaySource(Func<KspSnapshot?, CommsDelay?> computeOnMainThread)
        {
        }

        public void SetVesselDelay(string vesselId, double oneWaySeconds)
        {
        }

        public void SetAuthorityDelay(string centreId, string vesselId, double oneWaySeconds)
        {
        }

        public void SetCentreDelay(string fromCentreId, string toCentreId, double oneWaySeconds)
        {
        }

        public void SetVesselConnectivity(string vesselId, bool connected)
        {
        }

        public void SetConnectivitySource(Func<KspSnapshot?, bool?> computeOnMainThread)
        {
        }

        public void ForceKeyframe(string topic)
        {
        }

        public void ResetChannelBirth(IEnumerable<string> topics)
        {
        }

        private sealed class ProbePublisher : IChannelPublisher
        {
            private readonly StarvationProbeHost _host;
            private readonly string _topic;

            internal ProbePublisher(StarvationProbeHost host, string topic)
            {
                _host = host;
                _topic = topic;
            }

            public void Publish(object? payload) => _host.Published.Add((_topic, payload));

            public void Publish(object? payload, double atUt) => Publish(payload);
        }

        private sealed class ProbeNamespace : IDynamicChannelSource
        {
            private readonly StarvationProbeHost _host;
            private readonly string _prefix;

            internal ProbeNamespace(StarvationProbeHost host, string prefix)
            {
                _host = host;
                _prefix = prefix;
            }

            public IChannelPublisher Publisher(string subTopic) =>
                new ProbePublisher(_host, _prefix + subTopic);

            public void OnSubscribed(Action<string> callback)
            {
            }
        }
    }
}

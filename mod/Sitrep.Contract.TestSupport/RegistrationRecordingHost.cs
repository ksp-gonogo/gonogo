// A host that records what the Uplink asked it for, and can be told to refuse.
//
// The refusal is the point. Every other test here asks what the Uplink DID; this
// one has to ask what it does when a registration FAILS, because the defect it
// guards is that a failure part-way through the block silently ends the block.
// Nothing that only records can express that question.
using System;
using System.Collections.Generic;


namespace Sitrep.Contract.TestSupport
{
    internal sealed class RegistrationRecordingHost : IUplinkHost
    {
        public List<string> HandlersRegistered { get; } = new List<string>();

        public List<string> GateEvaluatorsRegistered { get; } = new List<string>();

        /// <summary>
        /// Throw on the first command handler offered, as the real engine does for
        /// a command with no declaration.
        /// </summary>
        public bool RefuseFirstHandler { get; set; }

        private bool _refused;

        public Kernel Kernel { get; } = new Kernel();

        public double NowUt() => 0.0;

        public void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler)
        {
            if (RefuseFirstHandler && !_refused)
            {
                _refused = true;
                throw new InvalidOperationException(
                    $"AddCommandHandler(\"{command}\") has no matching CommandDeclaration");
            }
            HandlersRegistered.Add(command);
        }

        public void AddVantageCommandHandler<TArgs, TResult>(
            string command, Func<TArgs, string?, TResult> handler) => HandlersRegistered.Add(command);

        public void AddGateEvaluator(ICommandGateEvaluator evaluator) =>
            GateEvaluatorsRegistered.Add(evaluator.GetType().Name);

        public List<string> PublishersTaken { get; } = new List<string>();

        public IChannelPublisher Publisher(string topic)
        {
            PublishersTaken.Add(topic);
            return new NullPublisher();
        }

        public void AddSampler(ISnapshotSampler sampler) { }

        public void AddChannelSource(string topic, Func<KspSnapshot?, object?> map) { }

        public void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier) { }

        public void AddSampledSource(
            Func<KspSnapshot?, object?> captureOnMainThread,
            Action<object?> handleOnCourier,
            params string[] subscriptionTopicPrefixes)
        { }

        public bool IsAnyTopicSubscribed(string topicPrefix) => true;

        public IDynamicChannelSource RegisterDynamicNamespace(string prefix, ChannelDeclaration template) =>
            new NullDynamicSource();

        public void AddCommandRequirement(string command, CommandRequirement requirement) { }

        public void SetSignalDelaySource(Func<KspSnapshot?, CommsDelay?> computeOnMainThread) { }

        public void SetVesselDelay(string vesselId, double oneWaySeconds) { }

        public void SetAuthorityDelay(string centreId, string vesselId, double oneWaySeconds) { }

        public void SetCentreDelay(string fromCentreId, string toCentreId, double oneWaySeconds) { }

        public void SetVesselConnectivity(string vesselId, bool connected) { }

        public void SetConnectivitySource(Func<KspSnapshot?, bool?> computeOnMainThread) { }

        public void SetAvailability(Availability availability) { }

        public void ForceKeyframe(string topic) { }

        public void ResetChannelBirth(IEnumerable<string> topics) { }

        private sealed class NullPublisher : IChannelPublisher
        {
            public void Publish(object? value, double ut) { }
        }

        private sealed class NullDynamicSource : IDynamicChannelSource
        {
            public IChannelPublisher Publisher(string subTopic) => new NullPublisher();

            public void OnSubscribed(Action<string> callback) { }
        }
    }
}

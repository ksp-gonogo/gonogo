// A host that answers the clock and accepts everything else.
//
// A capture running on a tick with no snapshot has to get its instant from
// somewhere, and the only seam an Uplink has is IUplinkHost.NowUt. An Uplink test
// project references no KSP assemblies, so Planetarium.GetUniversalTime() does not
// even compile there, and every Uplink test that drives a capture by hand ran with
// no host registered at all: the seam was unreachable, and twelve captures fell
// back to 0.0, stamping a reading at year 1 day 1 as though the game had just
// started.
//
// The UT is caller-supplied and has no default, because a double answering the
// epoch cannot tell a test that consulted the clock from one that substituted it,
// and that is the single distinction these captures turn on.
using System;
using System.Collections.Generic;

namespace Sitrep.Contract.TestSupport
{
    public sealed class ClockedUplinkHost : IUplinkHost
    {
        private readonly double _nowUt;

        public ClockedUplinkHost(double nowUt)
        {
            _nowUt = nowUt;
        }

        public Kernel Kernel { get; } = new Kernel();

        public double NowUt() => _nowUt;

        /// <summary>Every topic an Uplink took a publisher for, in the order it asked.</summary>
        public List<string> PublishersTaken { get; } = new List<string>();

        /// <summary>
        /// Every sample an Uplink published, in order, with the stamp it chose.
        ///
        /// <para>Recorded rather than discarded because the stamp is the whole
        /// question here, and because "this handle publishes NOTHING" is only
        /// assertable against a publisher that would have noticed.</para>
        /// </summary>
        public List<PublishedSample> Published { get; } = new List<PublishedSample>();

        public IChannelPublisher Publisher(string topic)
        {
            PublishersTaken.Add(topic);
            return new RecordingPublisher(this, topic);
        }

        /// <summary>
        /// True, so a Courier-thread handle that gates on a subscription publishes
        /// rather than going quiet. A test driving a handle by hand is asking what it
        /// publishes, and an answer of false answers a different question.
        /// </summary>
        public bool IsAnyTopicSubscribed(string topicPrefix) => true;

        public void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler) { }

        public void AddVantageCommandHandler<TArgs, TResult>(
            string command, Func<TArgs, string, TResult> handler)
        { }

        public void SetAvailability(Availability availability) { }

        public void AddSampler(ISnapshotSampler sampler) { }

        public void AddChannelSource(string topic, Func<KspSnapshot?, object?> map) { }

        public void AddSampledSource(
            Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier)
        { }

        public void AddSampledSource(
            Func<KspSnapshot?, object?> captureOnMainThread,
            Action<object?> handleOnCourier,
            params string[] subscriptionTopicPrefixes)
        { }

        public IDynamicChannelSource RegisterDynamicNamespace(
            string prefix, ChannelDeclaration template) => new RecordingDynamicSource(this, prefix);

        public void AddGateEvaluator(ICommandGateEvaluator evaluator) { }

        public void AddCommandRequirement(string command, CommandRequirement requirement) { }

        public void SetSignalDelaySource(Func<KspSnapshot?, CommsDelay?> computeOnMainThread) { }

        public void SetVesselDelay(string vesselId, double oneWaySeconds) { }

        public void SetAuthorityDelay(string centreId, string vesselId, double oneWaySeconds) { }

        public void SetCentreDelay(string fromCentreId, string toCentreId, double oneWaySeconds) { }

        public void SetHomeCommandDelay(string centreId, double oneWaySeconds) { }

        public void SetActiveVesselDelays(IReadOnlyDictionary<string, double> oneWaySecondsByCentre) { }

        public void SetVesselConnectivity(string vesselId, bool connected) { }

        public void SetConnectivitySource(Func<KspSnapshot?, bool?> computeOnMainThread) { }

        public void SetPathBreakSource(Func<KspSnapshot?, double, PathBreak?> computeOnMainThread) { }

        public void ForceKeyframe(string topic) { }

        public void ResetChannelBirth(IEnumerable<string> topics) { }

        /// <summary>One published sample: which topic, what value, stamped when.</summary>
        public sealed class PublishedSample
        {
            public PublishedSample(string topic, object? value, double ut)
            {
                Topic = topic;
                Value = value;
                Ut = ut;
            }

            public string Topic { get; }

            public object? Value { get; }

            public double Ut { get; }
        }

        private sealed class RecordingPublisher : IChannelPublisher
        {
            private readonly ClockedUplinkHost _host;
            private readonly string _topic;

            public RecordingPublisher(ClockedUplinkHost host, string topic)
            {
                _host = host;
                _topic = topic;
            }

            public void Publish(object? value, double ut) =>
                _host.Published.Add(new PublishedSample(_topic, value, ut));
        }

        private sealed class RecordingDynamicSource : IDynamicChannelSource
        {
            private readonly ClockedUplinkHost _host;
            private readonly string _prefix;

            public RecordingDynamicSource(ClockedUplinkHost host, string prefix)
            {
                _host = host;
                _prefix = prefix;
            }

            public IChannelPublisher Publisher(string subTopic) =>
                new RecordingPublisher(_host, _prefix + subTopic);

            public void OnSubscribed(Action<string> callback) { }
        }
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using Gonogo.KSP.CommandCentres;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Gonogo.KSP.Tests.CommandCentres
{
    /// <summary>
    /// The second argument to <see cref="IChannelPublisher.Publish"/> is a
    /// universe time, and the roster publish used to be handed the NUMBER OF
    /// COMMAND CENTRES instead.
    ///
    /// <para>Nothing caught it because the engine only ever clamps a stamp that
    /// is AHEAD of the clock: a count is far below current UT, so it sailed
    /// through and the sample was recorded as stamped in the deep past, with
    /// <c>validAt</c> on the wire equal to a command-centre count. The
    /// assertions below are therefore on the STAMP rather than on the payload,
    /// which is the half that had no coverage at all.</para>
    /// </summary>
    public class CommandCentreRosterStampTests
    {
        [Fact]
        public void TheRosterIsStampedWithTheCaptureUt()
        {
            var host = new PublishRecordingHost();
            var uplink = Uplink(host, "ksc", "ground:woomerang", "vessel:abc");

            uplink.PublishRosterOnCourier(uplink.CaptureRosterOnMain(new KspSnapshot { Ut = 1_050_000.0 }));

            var (_, ut) = Assert.Single(host.Recorder.Published);
            Assert.Equal(1_050_000.0, ut);
        }

        /// <summary>
        /// The defect stated as a property: a stamp is a time, so it cannot
        /// depend on how many centres happen to exist. Both passes read the same
        /// clock, so both must publish the same stamp; under the count bug they
        /// differ by three.
        /// </summary>
        [Fact]
        public void TheStampDoesNotMoveWithTheNumberOfCentres()
        {
            var emptyHost = new PublishRecordingHost();
            var empty = Uplink(emptyHost);
            var crowdedHost = new PublishRecordingHost();
            var crowded = Uplink(crowdedHost, "ksc", "ground:woomerang", "vessel:abc");

            var snapshot = new KspSnapshot { Ut = 1_050_000.0 };
            empty.PublishRosterOnCourier(empty.CaptureRosterOnMain(snapshot));
            crowded.PublishRosterOnCourier(crowded.CaptureRosterOnMain(snapshot));

            Assert.Equal(
                Assert.Single(emptyHost.Recorder.Published).Ut,
                Assert.Single(crowdedHost.Recorder.Published).Ut);
        }

        /// <summary>
        /// A capture taken before the first snapshot has no time to quote. Zero
        /// is the same "no reading yet" the ledger capture beside it uses, and
        /// the point of asserting it is that it stays a deliberate floor rather
        /// than drifting back into a count.
        /// </summary>
        [Fact]
        public void AnUnsnapshottedCaptureStampsZeroRatherThanACount()
        {
            var host = new PublishRecordingHost();
            var uplink = Uplink(host, "ksc", "ground:woomerang", "vessel:abc");

            uplink.PublishRosterOnCourier(uplink.CaptureRosterOnMain(null));

            Assert.Equal(0.0, Assert.Single(host.Recorder.Published).Ut);
        }

        private static CommandCentreDelayUplink Uplink(PublishRecordingHost host, params string[] centreIds)
        {
            var registry = new CommandCentreRegistry();
            registry.RegisterSource(new FixedCentreSource(centreIds));
            var uplink = new CommandCentreDelayUplink(registry);
            uplink.Register(host);
            return uplink;
        }

        private sealed class FixedCentreSource : ICommandCentreSource
        {
            private readonly IReadOnlyList<ICommandCentre> _centres;

            public FixedCentreSource(IEnumerable<string> ids) =>
                _centres = ids.Select(id => (ICommandCentre)new FixedCentre(id)).ToList();

            public string ProviderId => "test";

            public IEnumerable<ICommandCentre> Enumerate() => _centres;
        }

        private sealed class FixedCentre : ICommandCentre
        {
            public FixedCentre(string id) => Id = id;

            public string Id { get; }

            public string DisplayName => Id;

            public CommandCentreKind Kind => CommandCentreKind.GroundStation;

            public int? BodyIndex => 1;

            public bool IsActiveNow() => true;
        }

        /// <summary>
        /// Records every publish with its stamp. Everything an
        /// <see cref="IUplinkHost"/> owes that this file does not exercise
        /// throws, so a capture that starts reaching for one fails loudly rather
        /// than reading a guessed default.
        /// </summary>
        private sealed class PublishRecordingHost : IUplinkHost
        {
            public RecordingPublisher Recorder { get; } = new RecordingPublisher();

            public IChannelPublisher Publisher(string topic) =>
                topic == CommandCentreDelayUplink.RosterTopic ? Recorder : new NullPublisher();

            public void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier) { }

            public void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier, params string[] subscriptionTopicPrefixes) { }

            public Kernel Kernel { get; } = new Kernel();

            public double NowUt() => 0.0;
            public void AddSampler(ISnapshotSampler sampler) => throw new NotSupportedException();
            public void AddChannelSource(string topic, Func<KspSnapshot?, object?> map) => throw new NotSupportedException();
            public bool IsAnyTopicSubscribed(string topicPrefix) => throw new NotSupportedException();
            public IDynamicChannelSource RegisterDynamicNamespace(string prefix, ChannelDeclaration template) => throw new NotSupportedException();
            public void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler) => throw new NotSupportedException();
            public void AddVantageCommandHandler<TArgs, TResult>(string command, Func<TArgs, string, TResult> handler) => throw new NotSupportedException();
            public void AddGateEvaluator(ICommandGateEvaluator evaluator) => throw new NotSupportedException();
            public void AddCommandRequirement(string command, CommandRequirement requirement) => throw new NotSupportedException();
            public void SetSignalDelaySource(Func<KspSnapshot?, CommsDelay?> computeOnMainThread) => throw new NotSupportedException();
            public void SetPathBreakSource(Func<KspSnapshot?, double, PathBreak?> computeOnMainThread) => throw new NotSupportedException();
            public void SetVesselDelay(string vesselId, double oneWaySeconds) => throw new NotSupportedException();
            public void SetAuthorityDelay(string centreId, string vesselId, double oneWaySeconds) => throw new NotSupportedException();
            public void SetCentreDelay(string fromCentreId, string toCentreId, double oneWaySeconds) => throw new NotSupportedException();
            public void SetVesselConnectivity(string vesselId, bool connected) => throw new NotSupportedException();
            public void SetConnectivitySource(Func<KspSnapshot?, bool?> computeOnMainThread) => throw new NotSupportedException();
            public void SetAvailability(Availability availability) => throw new NotSupportedException();
            public void ForceKeyframe(string topic) => throw new NotSupportedException();
            public void ResetChannelBirth(IEnumerable<string> topics) => throw new NotSupportedException();
        }

        private sealed class RecordingPublisher : IChannelPublisher
        {
            public List<(object? Payload, double Ut)> Published { get; } = new List<(object?, double)>();

            public void Publish(object? payload, double ut) => Published.Add((payload, ut));
        }

        private sealed class NullPublisher : IChannelPublisher
        {
            public void Publish(object? payload, double ut)
            {
            }
        }
    }
}

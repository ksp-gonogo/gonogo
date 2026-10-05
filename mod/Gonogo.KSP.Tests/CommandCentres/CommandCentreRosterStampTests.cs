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
    /// Which centre the roster this uplink reads marks as home. The roster is
    /// sent to each command centre by the contact plan source; the marking is
    /// still decided here, from the home-command claimant's answer.
    /// </summary>
    public class CommandCentreRosterStampTests
    {
        /// <summary>
        /// The roster publishes the home-command claimant's answer rather than working
        /// home out again: exactly the named centre carries the flag, wherever it is listed.
        /// </summary>
        [Fact]
        public void TheCentreTheClaimantNamesIsTheOnlyOneMarkedHome()
        {
            var host = new PublishRecordingHost();
            var uplink = Uplink(
                host,
                HomeCommand.Identified("ground:Kerbal Space Center"),
                "ground:woomerang", "ground:Kerbal Space Center", "vessel:abc");

            var roster = uplink.RosterNow();
            Assert.Equal(new[] { "ground:Kerbal Space Center" }, roster.Where(e => e.IsHome).Select(e => e.Id));
            Assert.DoesNotContain(roster, e => e.IsHomeFallback);
        }

        /// <summary>
        /// Not identified still publishes a home: the centre a fresh connection starts at,
        /// the first ground station by id, carries the flag, and <see cref="CommandCentreEntry.IsHomeFallback"/>
        /// says it stands in rather than being the claimant's answer.
        /// </summary>
        [Fact]
        public void WhenNoHomeIsIdentified_TheFirstGroundStationByIdIsMarkedHomeAsAFallback()
        {
            var host = new PublishRecordingHost();
            var uplink = Uplink(
                host,
                HomeCommand.NotIdentified,
                "vessel:abc", "ground:DSS 43 - Canberra", "ground:DSS 14 - Goldstone");

            var roster = uplink.RosterNow();
            var home = Assert.Single(roster, e => e.IsHome);
            Assert.Equal("ground:DSS 14 - Goldstone", home.Id);
            Assert.True(home.IsHomeFallback);
            Assert.Equal(new[] { home.Id }, roster.Where(e => e.IsHomeFallback).Select(e => e.Id));
        }

        /// <summary>
        /// A named home that is not among the active centres falls back exactly as an
        /// unnamed one does, so the roster never marks a centre it does not list.
        /// </summary>
        [Fact]
        public void WhenTheNamedHomeIsNotActive_TheFallbackIsMarkedHome()
        {
            var host = new PublishRecordingHost();
            var uplink = Uplink(
                host,
                HomeCommand.Identified("ground:Kerbal Space Center"),
                "ground:woomerang", "ground:Baikerbanur");

            var roster = uplink.RosterNow();
            var home = Assert.Single(roster, e => e.IsHome);
            Assert.Equal("ground:Baikerbanur", home.Id);
            Assert.True(home.IsHomeFallback);
        }

        /// <summary>A roster with no ground station has nowhere to stand in, so nothing is marked home.</summary>
        [Fact]
        public void WithNoGroundStation_NoCentreIsMarkedHome()
        {
            var host = new PublishRecordingHost();
            var uplink = Uplink(host, HomeCommand.NotIdentified, "vessel:abc");

            var roster = uplink.RosterNow();
            Assert.DoesNotContain(roster, e => e.IsHome || e.IsHomeFallback);
        }

        /// <summary>
        /// With no home identified a ground station stands in for it, and the
        /// stand-in is home for the ledger too: it is timed by the craft's own
        /// path to the ground, 39 seconds here, and not by the route to its
        /// own dish, 509 seconds by way of a far relay while the craft talks
        /// to another station. It gets no row of its own for the active craft,
        /// as an identified home gets none.
        /// </summary>
        [Fact]
        public void TheStationStandingInForHomeIsTimedAsHomeIsAndNotByTheRouteToItsOwnDish()
        {
            var centres = new ICommandCentre[] { new FixedCentre("ground:Baikerbanur"), new FixedCentre("ground:Crater Rim") };

            var ledger = CommandCentreDelayUplink.BuildLedger(
                centres,
                HomeCommand.NotIdentified,
                new[] { "m1" },
                "m1",
                (centre, guid, isHome) => isHome ? 39.0 : 509.0,
                (from, to) => null,
                centre => null,
                centre => null);

            var fleet = Assert.Single(ledger.Rows, r => r.Vantage == "ground:Baikerbanur" && r.Node == "fleet.m1");
            Assert.Equal(39.0, fleet.Seconds);
            Assert.DoesNotContain(ledger.Rows, r => r.Vantage == "ground:Baikerbanur" && r.Node == Sitrep.Host.ChannelEngine.NodeId);
        }

        private static CommandCentreDelayUplink Uplink(PublishRecordingHost host, params string[] centreIds) =>
            Uplink(host, HomeCommand.NotIdentified, centreIds);

        private static CommandCentreDelayUplink Uplink(PublishRecordingHost host, HomeCommand home, params string[] centreIds)
        {
            var registry = new CommandCentreRegistry();
            registry.RegisterSource(new FixedCentreSource(centreIds));
            var uplink = new CommandCentreDelayUplink(registry, () => home);
            uplink.Register(host);
            return uplink;
        }

        private sealed class FixedCentreSource : ICommandCentreSource
        {
            private IReadOnlyList<ICommandCentre> _centres;

            public FixedCentreSource(IEnumerable<string> ids) => Set(ids.ToArray());

            public void Set(params string[] ids) =>
                _centres = ids.Select(id => (ICommandCentre)new FixedCentre(id)).ToList();

            public string ProviderId => "test";

            public IEnumerable<ICommandCentre> Enumerate() => _centres;
        }

        private sealed class FixedCentre : ICommandCentre
        {
            public FixedCentre(string id) => Id = id;

            public string Id { get; }

            public string DisplayName => Id;

            public CommandCentreKind Kind =>
                Id.StartsWith("vessel:", StringComparison.Ordinal) ? CommandCentreKind.CrewedVessel : CommandCentreKind.GroundStation;

            public int? BodyIndex => 1;

            public double? Latitude => null;

            public double? Longitude => null;

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

            public RecordingPublisher UnreachableRecorder { get; } = new RecordingPublisher();

            public IChannelPublisher Publisher(string topic) =>
                topic == CommandCentreDelayUplink.RosterTopic ? Recorder
                : topic == CommandCentreDelayUplink.UnreachableTopic ? UnreachableRecorder
                : new NullPublisher();

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
            public void SetPathBreakSource(Func<KspSnapshot?, double, IReadOnlyList<PathBreak>?> computeOnMainThread) => throw new NotSupportedException();

            public IDisposable RegisterDelayModifier(double factor, string reason) => throw new NotSupportedException();
            public void SetVesselDelay(string vesselId, double oneWaySeconds) => throw new NotSupportedException();
            public void SetCentreDelay(string fromCentreId, string toCentreId, double oneWaySeconds) => throw new NotSupportedException();
            public void SetHomeCommandDelay(string centreId, double oneWaySeconds) => throw new NotSupportedException();
            public void SetActiveVesselDelays(IReadOnlyDictionary<string, double> oneWaySecondsByCentre) => throw new NotSupportedException();
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

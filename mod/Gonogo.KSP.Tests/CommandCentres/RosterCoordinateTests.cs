using System;
using System.Collections.Generic;
using CommNet;
using Gonogo.KSP.CommandCentres;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using UnityEngine;
using Xunit;

namespace Gonogo.KSP.Tests.CommandCentres
{
    /// <summary>
    /// <c>CommandCentreEntry.Latitude</c>/<c>Longitude</c> were declared from the
    /// start and never assigned by <c>ToRosterEntry</c>, so every entry of every kind
    /// carried null forever. The declaration was not wrong (it always said "when
    /// surface-anchored; null for a moving vessel centre"), it was unimplemented, and
    /// a field that is always null is indistinguishable from one that is
    /// conditionally null, which is why it went unnoticed.
    ///
    /// <para>So the anchored assertion is the load-bearing one. A test that only
    /// checked the null branch would have passed against the broken code, since
    /// broken meant "null everywhere". Both branches are asserted in the same test
    /// for that reason: the pair is the claim, neither half alone is.</para>
    ///
    /// <para>These run against the mapper, which reads only the registry, not
    /// <c>FlightGlobals</c>. The two SOURCES that decide anchoredness need
    /// <c>CommNetHome</c> and <c>Vessel</c> and are not compiled into this project,
    /// so their landed-versus-orbiting rule is build-verified only.</para>
    /// </summary>
    public class RosterCoordinateTests
    {
        [Fact]
        public void AnAnchoredCentreReportsCoordinatesAndAMovingOneReportsNull()
        {
            var roster = PublishRoster(
                Centre("ksc", CommandCentreKind.GroundStation, latitude: -0.0972, longitude: -74.5577),
                Centre("vessel:abc", CommandCentreKind.CrewedVessel, latitude: null, longitude: null));

            var ksc = Assert.Single(roster, e => e.Id == "ksc");
            Assert.NotNull(ksc.Latitude);
            Assert.NotNull(ksc.Longitude);
            Assert.Equal(-0.0972, ksc.Latitude!.Value, 6);
            Assert.Equal(-74.5577, ksc.Longitude!.Value, 6);

            var vessel = Assert.Single(roster, e => e.Id == "vessel:abc");
            Assert.Null(vessel.Latitude);
            Assert.Null(vessel.Longitude);
        }

        /// <summary>
        /// A landed crewed vessel is surface-anchored, so the rule is about the
        /// craft's situation and not about its <c>Kind</c>. Asserted separately
        /// because keying the mapper off <c>Kind</c> would satisfy the test above
        /// while being wrong.
        /// </summary>
        [Fact]
        public void ACrewedVesselCentreThatIsAnchoredStillReportsCoordinates()
        {
            var roster = PublishRoster(
                Centre("vessel:landed", CommandCentreKind.CrewedVessel, latitude: 12.5, longitude: -45.25));

            var landed = Assert.Single(roster);
            Assert.Equal(12.5, landed.Latitude!.Value, 6);
            Assert.Equal(-45.25, landed.Longitude!.Value, 6);
        }

        [Theory]
        // Already inside the range: untouched, including both boundaries.
        [InlineData(0.0, 0.0)]
        [InlineData(180.0, 180.0)]
        [InlineData(-179.9, -179.9)]
        // GetLongitude can hand back a 0..360 reading; the east half must fold.
        [InlineData(270.0, -90.0)]
        [InlineData(359.5, -0.5)]
        [InlineData(360.0, 0.0)]
        // Multiple turns, either direction.
        [InlineData(720.0 + 45.0, 45.0)]
        [InlineData(-190.0, 170.0)]
        [InlineData(-360.0 - 90.0, -90.0)]
        public void LongitudeWrapsIntoTheConventionEveryOtherGeographicValueUses(double raw, double expected)
        {
            Assert.Equal(expected, SurfaceCoordinates.NormaliseLongitudeDeg(raw), 9);
        }

        /// <summary>
        /// A non-finite reading is passed through rather than wrapped into a
        /// plausible-looking number: <c>TryFrom</c> rejects it, and a silent 0.0 here
        /// would be a coordinate off the coast of Africa presented as a fact.
        /// </summary>
        [Theory]
        [InlineData(double.NaN)]
        [InlineData(double.PositiveInfinity)]
        public void ANonFiniteLongitudeIsNotWrappedIntoAPlausibleNumber(double raw)
        {
            var wrapped = SurfaceCoordinates.NormaliseLongitudeDeg(raw);
            Assert.True(double.IsNaN(wrapped) || double.IsInfinity(wrapped));
        }

        private static KspCommandCentre Centre(
            string id,
            CommandCentreKind kind,
            double? latitude,
            double? longitude) =>
            new KspCommandCentre(
                id,
                id,
                kind,
                bodyIndex: 1,
                node: new CommNode(),
                position: new Vector3d(0.0, 0.0, 0.0),
                active: true,
                latitude: latitude,
                longitude: longitude);

        /// <summary>
        /// Drive the uplink's real capture/publish pair over a registry holding
        /// <paramref name="centres"/>, and return what actually reached the channel.
        /// </summary>
        private static List<CommandCentreEntry> PublishRoster(params ICommandCentre[] centres)
        {
            var registry = new CommandCentreRegistry();
            registry.RegisterSource(new StaticSource(centres));

            var host = new CapturingUplinkHost();
            var uplink = new CommandCentreDelayUplink(registry);
            uplink.Register(host);
            uplink.PublishRosterOnCourier(uplink.CaptureRosterOnMain(null));

            return Assert.IsType<List<CommandCentreEntry>>(host.RosterPublisher.LastPayload);
        }

        private sealed class StaticSource : ICommandCentreSource
        {
            private readonly IReadOnlyList<ICommandCentre> _centres;

            public StaticSource(IReadOnlyList<ICommandCentre> centres) => _centres = centres;

            public string SourceId => "static-test";

            public IEnumerable<ICommandCentre> Enumerate() => _centres;
        }

        private sealed class CapturingUplinkHost : IUplinkHost
        {
            public RecordingPublisher RosterPublisher { get; } = new RecordingPublisher();

            public IChannelPublisher Publisher(string topic) =>
                topic == CommandCentreDelayUplink.RosterTopic ? RosterPublisher : new RecordingPublisher();

            public void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier)
            {
            }

            public void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier, params string[] subscriptionTopicPrefixes)
            {
            }

            public Kernel Kernel { get; } = new Kernel();

            public double NowUt() => 0.0;
            public void AddSampler(ISnapshotSampler sampler) => throw new NotSupportedException();
            public void AddChannelSource(string topic, Func<KspSnapshot?, object?> map) => throw new NotSupportedException();
            public bool IsAnyTopicSubscribed(string topicPrefix) => throw new NotSupportedException();
            public IDynamicChannelSource RegisterDynamicNamespace(string prefix, ChannelDeclaration template) => throw new NotSupportedException();
            public void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler) => throw new NotSupportedException();
            public void AddGateEvaluator(ICommandGateEvaluator evaluator) => throw new NotSupportedException();
            public void SetSignalDelaySource(Func<KspSnapshot?, CommsDelay?> computeOnMainThread) => throw new NotSupportedException();
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
            public object? LastPayload { get; private set; }

            public void Publish(object? payload, double ut) => LastPayload = payload;
        }
    }
}

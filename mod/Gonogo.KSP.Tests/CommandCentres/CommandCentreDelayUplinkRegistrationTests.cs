using System;
using System.Collections.Generic;
using System.Linq;
using Gonogo.KSP.CommandCentres;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Gonogo.KSP.Tests.CommandCentres
{
    /// <summary>
    /// The command-centre uplink does two unrelated jobs off one capture: it
    /// writes the (vantage, node) command-delay ledger, and it publishes the
    /// <c>commandCentre.roster</c> topic. They must not share a subscription
    /// gate. The ledger is engine state that command dispatch and currency
    /// spends read back, so gating it made a career outcome depend on which
    /// browser tab happened to be open; the roster is an ordinary channel and
    /// gating it is free.
    ///
    /// <para>These assertions are on the REGISTRATION, not on a capture: the
    /// capture half reads <c>FlightGlobals</c> and only exists inside a running
    /// game. <c>Sitrep.Host.Tests.SampledSourceTests</c> covers the other half
    /// of the claim, that an ungated source's ledger writes actually land with
    /// nothing subscribed.</para>
    /// </summary>
    public class CommandCentreDelayUplinkRegistrationTests
    {
        [Fact]
        public void TheDelayLedgerSourceIsRegisteredUngated()
        {
            var host = new RecordingUplinkHost();
            var uplink = new CommandCentreDelayUplink(new CommandCentreRegistry());

            uplink.Register(host);

            var ledger = Assert.Single(host.SampledSources.Where(
                s => s.Handle.Equals((Action<object?>)uplink.ApplyLedgerOnCourier)));
            Assert.Empty(ledger.Prefixes);
        }

        [Fact]
        public void TheRosterSourceIsGatedOnItsOwnTopicNotTheFleetNamespace()
        {
            var host = new RecordingUplinkHost();
            var uplink = new CommandCentreDelayUplink(new CommandCentreRegistry());

            uplink.Register(host);

            var roster = Assert.Single(host.SampledSources.Where(
                s => s.Handle.Equals((Action<object?>)uplink.PublishRosterOnCourier)));
            Assert.Equal(new[] { CommandCentreDelayUplink.RosterTopic }, roster.Prefixes);
        }

        /// <summary>
        /// The regression this file exists for, stated directly: nothing this
        /// uplink registers may hang off a fleet-topic subscription. The roster
        /// and the ledger both used to.
        /// </summary>
        [Fact]
        public void NothingIsGatedOnTheFleetNamespace()
        {
            var host = new RecordingUplinkHost();
            var uplink = new CommandCentreDelayUplink(new CommandCentreRegistry());

            uplink.Register(host);

            Assert.Equal(2, host.SampledSources.Count);
            Assert.DoesNotContain(
                host.SampledSources,
                s => s.Prefixes.Contains(ChannelEngine.FleetNodePrefix));
        }

        /// <summary>
        /// Records what an uplink registers. Every member an
        /// <see cref="IUplinkHost"/> owes that these tests do not exercise
        /// throws, so a registration that starts depending on one is a loud
        /// failure rather than a silently-guessed default.
        /// </summary>
        private sealed class RecordingUplinkHost : IUplinkHost
        {
            public List<(Func<KspSnapshot?, object?> Capture, Action<object?> Handle, string[] Prefixes)> SampledSources { get; }
                = new List<(Func<KspSnapshot?, object?>, Action<object?>, string[])>();

            public void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier) =>
                SampledSources.Add((captureOnMainThread, handleOnCourier, Array.Empty<string>()));

            public void AddSampledSource(Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier, params string[] subscriptionTopicPrefixes) =>
                SampledSources.Add((captureOnMainThread, handleOnCourier, subscriptionTopicPrefixes));

            public IChannelPublisher Publisher(string topic) => new NullPublisher();

            public Kernel Kernel { get; } = new Kernel();

            public double NowUt() => 0.0;
            public void AddSampler(ISnapshotSampler sampler) => throw new NotSupportedException();
            public void AddChannelSource(string topic, Func<KspSnapshot?, object?> map) => throw new NotSupportedException();
            public bool IsAnyTopicSubscribed(string topicPrefix) => throw new NotSupportedException();
            public IDynamicChannelSource RegisterDynamicNamespace(string prefix, ChannelDeclaration template) => throw new NotSupportedException();
            public void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler) => throw new NotSupportedException();
            public void AddVantageCommandHandler<TArgs, TResult>(string command, Func<TArgs, string, TResult> handler) => throw new NotSupportedException();
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

            private sealed class NullPublisher : IChannelPublisher
            {
                public void Publish(object? payload, double ut)
                {
                }
            }
        }
    }
}

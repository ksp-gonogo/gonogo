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
        /// Who can command is the home command's fact, so the roster is held
        /// there and each vantage learns a change after its own delay home.
        ///
        /// <para>The practical split, and the reason it is declared this way
        /// rather than left instant: a ground centre's delay home is effectively
        /// zero, so an operator keeps the live centre picker they have always
        /// had, while a vessel vantage reads the roster at its own light-time.
        /// A craft cannot know a new centre came online before word reaches it,
        /// and publishing the list instantly told it so.</para>
        ///
        /// <para><c>HeldAtHome</c> is what makes that one declaration rather
        /// than two behaviours: the channel records under the home command's
        /// node, and <c>DelayTo(vantage, home)</c> does the rest. The engine's
        /// own coverage of that routing is
        /// <c>Sitrep.Host.IntegrationTests.HomeCommandLedgerDelayTests</c>;
        /// what this pins is that the roster asks for it.</para>
        /// </summary>
        [Fact]
        public void TheRosterIsHeldAtTheHomeCommandRatherThanPublishedInstantly()
        {
            var uplink = new CommandCentreDelayUplink(new CommandCentreRegistry());

            var roster = Assert.Single(
                uplink.Manifest.Channels.Where(c => c.Topic == CommandCentreDelayUplink.RosterTopic));

            Assert.True(roster.HeldAtHome);
            // Delayed, not TrueNow: the two are mutually exclusive by
            // construction (declaring both refuses the uplink), and TrueNow is
            // what this topic used to be.
            Assert.Equal(DelayRole.Delayed, roster.Delay);
        }

        /// <summary>
        /// Nothing this uplink registers may hang off a fleet-topic
        /// subscription.
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
        /// The active craft's rows reach the engine as ONE set per pass, and an empty set
        /// still goes out, since that is how a centre that stopped being the active craft
        /// loses its zero. None of them leaks into the fleet hook as a guid of "system".
        /// </summary>
        [Fact]
        public void TheActiveCraftRowsAreHandedOverAsOneSetEveryPass()
        {
            var host = new RecordingUplinkHost();
            var uplink = new CommandCentreDelayUplink(new CommandCentreRegistry());
            uplink.Register(host);

            uplink.ApplyLedgerOnCourier(Capture(
                ("vessel:G", ChannelEngine.NodeId, 0.0),
                ("ground:gs1", ChannelEngine.NodeId, 3.0),
                ("ground:gs1", AuthorityMatrixPass.FleetNode("G"), 3.0)));
            uplink.ApplyLedgerOnCourier(Capture());

            Assert.Equal(2, host.ActiveVesselDelays.Count);
            Assert.Equal(
                new Dictionary<string, double> { ["vessel:G"] = 0.0, ["ground:gs1"] = 3.0 },
                host.ActiveVesselDelays[0]);
            Assert.Empty(host.ActiveVesselDelays[1]);
            Assert.Equal(new[] { ("ground:gs1", "G", 3.0) }, host.AuthorityDelays);
        }

        private static CommandCentreDelayUplink.LedgerCapture Capture(params (string Vantage, string Node, double Seconds)[] rows) =>
            new CommandCentreDelayUplink.LedgerCapture
            {
                Rows = rows
                    .Select(r => new CommandCentreDelayUplink.AuthorityRow { Vantage = r.Vantage, Node = r.Node, Seconds = r.Seconds })
                    .ToList(),
            };

        /// <summary>
        /// Records what an uplink registers. Every member an
        /// <see cref="IUplinkHost"/> owes that these tests do not exercise
        /// throws, so a registration that starts depending on one is a loud
        /// failure rather than a silently-guessed default.
        /// </summary>
        private sealed class RecordingUplinkHost : IUplinkHost
        {

        public void SetPathBreakSource(Func<KspSnapshot?, double, IReadOnlyList<PathBreak>?> computeOnMainThread) { }
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

            public void AddCommandRequirement(string command, CommandRequirement requirement) => throw new NotSupportedException();
            public void SetSignalDelaySource(Func<KspSnapshot?, CommsDelay?> computeOnMainThread) => throw new NotSupportedException();
            public void SetVesselDelay(string vesselId, double oneWaySeconds) => throw new NotSupportedException();
            public List<(string, string, double)> AuthorityDelays { get; } = new List<(string, string, double)>();
            public List<Dictionary<string, double>> ActiveVesselDelays { get; } = new List<Dictionary<string, double>>();

            public void SetAuthorityDelay(string centreId, string vesselId, double oneWaySeconds) =>
                AuthorityDelays.Add((centreId, vesselId, oneWaySeconds));
            public void SetCentreDelay(string fromCentreId, string toCentreId, double oneWaySeconds) => throw new NotSupportedException();
            public void SetHomeCommandDelay(string centreId, double oneWaySeconds) => throw new NotSupportedException();
            public void SetActiveVesselDelays(IReadOnlyDictionary<string, double> oneWaySecondsByCentre) =>
                ActiveVesselDelays.Add(new Dictionary<string, double>(oneWaySecondsByCentre));
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

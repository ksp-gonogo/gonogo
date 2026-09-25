using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

using static Sitrep.Host.IntegrationTests.WsTestHarness;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// A break belongs to the craft whose route it was on, over the raw wire.
    ///
    /// <para>Two subjects stream at the same four-second light-time, the active
    /// craft on <see cref="ConnectivityHorizonTestUplink.DelayedTopic"/> and a
    /// fleet vessel on its own orbit topic, and then stop sending, so all that
    /// is left is the tail already in flight. At UT 6 a relay two light-seconds
    /// out stops carrying on ONE of the two routes. That route loses the one
    /// sample short of the relay; the other route's tail lands in full. Each
    /// case is the other's control: the same fixture and the same instant, with
    /// only the named node changed.</para>
    /// </summary>
    public class FleetPathBreakTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;

        private const string Vessel = "far";
        private const string ActiveTopic = ConnectivityHorizonTestUplink.DelayedTopic;
        private static readonly string FleetTopic = ChannelEngine.FleetNodePrefix + Vessel + ".orbit";

        /// <summary>
        /// Both subjects at a four-second light-time. Each sends a sample per
        /// tick while <paramref name="sending"/> and nothing after, so nothing
        /// new joins the tail: the active craft holds its last reading, which
        /// the change gate does not resend, and the fleet vessel's roster stops
        /// arriving, leaving its light-time and link at their last values.
        /// </summary>
        private static KspSnapshot Tick(double ut, bool sending, double? breakOut = null, string? breakNode = null)
        {
            var values = new Dictionary<string, object?>
            {
                ["connected"] = true,
                ["delay"] = 4.0,
                ["delayed"] = 10.0 + Math.Min(ut, 5.0),
            };
            if (sending)
            {
                values["vessels"] = new List<object?>
                {
                    new Dictionary<string, object?>
                    {
                        ["id"] = Vessel,
                        ["delay"] = 4.0,
                        ["orbit"] = new Dictionary<string, object?>
                        {
                            ["sma"] = 700000.0,
                            ["ecc"] = 0.0,
                            ["inc"] = 0.0,
                            ["meanAnomalyAtEpoch"] = 0.0,
                            ["epoch"] = ut,
                            ["mu"] = 3.5316000e12,
                            ["referenceBody"] = "Kerbin",
                        },
                    },
                };
            }
            if (breakOut.HasValue)
            {
                values["breakOut"] = breakOut.Value;
                values["breakNode"] = breakNode;
            }
            return new KspSnapshot { Ut = ut, Values = values };
        }

        /// <summary>
        /// Samples from UT 1 to 5 on both routes, a break on
        /// <paramref name="brokenNode"/> at UT 6, and every ValidAt each topic
        /// delivered from UT 6 to UT 12.
        /// </summary>
        private static async Task<(List<double> Active, List<double> Fleet)> RunAsync(string brokenNode)
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new ConnectivityHorizonTestUplink());
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, ActiveTopic, Timeout);
                await SubscribeAsync(client, FleetTopic, Timeout);

                for (var ut = 0.0; ut <= 5.0; ut += 1.0)
                {
                    engine.TickAndWait(ut, Tick(ut, sending: true), Timeout);
                }
                await DrainAllStreamDataAsync(client, Quiet);

                var active = new List<double>();
                var fleet = new List<double>();
                for (var ut = 6.0; ut <= 12.0; ut += 1.0)
                {
                    var snapshot = ut == 6.0
                        ? Tick(ut, sending: false, breakOut: 2.0, breakNode: brokenNode)
                        : Tick(ut, sending: false);
                    engine.TickAndWait(ut, snapshot, Timeout);
                    var frames = await DrainAllStreamDataAsync(client, Quiet);
                    active.AddRange(frames.Where(f => f.Topic == ActiveTopic).Select(f => f.Meta.ValidAt));
                    fleet.AddRange(frames.Where(f => f.Topic == FleetTopic).Select(f => f.Meta.ValidAt));
                }
                return (active, fleet);
            }
            finally
            {
                engine.Stop();
            }
        }

        /// <summary>
        /// The relay dies under the fleet vessel, not the craft on screen. The
        /// fleet tail stops at the relay: its UT 5 sample, still short of it,
        /// never arrives. The active craft's tail is untouched.
        /// </summary>
        [Fact]
        public async Task ABreakOnAFleetVesselsRouteStopsThatVesselAndNoOther()
        {
            var (active, fleet) = await RunAsync(ChannelEngine.FleetNodePrefix + Vessel);

            Assert.Equal(new[] { 2.0, 3.0, 4.0 }, fleet);
            Assert.Equal(new[] { 2.0, 3.0, 4.0, 5.0 }, active);
        }

        /// <summary>
        /// The same break on the active craft's route: the loss moves with it.
        /// </summary>
        [Fact]
        public async Task ABreakOnTheActiveCraftsRouteLeavesTheFleetAlone()
        {
            var (active, fleet) = await RunAsync(ChannelEngine.NodeId);

            Assert.Equal(new[] { 2.0, 3.0, 4.0 }, active);
            Assert.Equal(new[] { 2.0, 3.0, 4.0, 5.0 }, fleet);
        }
    }
}

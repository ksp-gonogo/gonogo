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
    /// A kerbal outside a craft is heard over the link of the craft being reported, so a
    /// stock kerbal with no antenna of its own still reports its suit.
    /// </summary>
    public class EvaKerbalLinkTests
    {
        private static readonly TimeSpan Timeout = TestBudgets.Op;
        private static readonly TimeSpan Quiet = TestBudgets.Quiet;
        private const string Kerbal = "kkkkkkkk-0000-0000-0000-000000000000";
        private const string Topic = "eva.kerbal." + Kerbal + ".state";

        private static KspSnapshot Snap(double ut) => new KspSnapshot
        {
            Ut = ut,
            Values = new Dictionary<string, object?>
            {
                ["evaCrew"] = new List<object?>
                {
                    new Dictionary<string, object?>
                    {
                        ["kerbalVesselId"] = Kerbal,
                        ["parentVesselId"] = "parent",
                        ["name"] = "Jebediah Kerman",
                        ["propellantAmount"] = 3.5,
                    },
                },
            },
        };

        [Fact]
        public async Task AKerbalWithNoAntennaOfItsOwnStillReportsItsSuit()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new EvaKerbalTestUplink());
            engine.Start();
            try
            {
                await using var client = await TestClient.ConnectAsync(engine.BoundPort, Timeout);
                await SubscribeAsync(client, Topic, Timeout);

                engine.TickAndWait(1.0, Snap(1.0), Timeout);
                engine.TickAndWait(2.0, Snap(2.0), Timeout);

                var frames = (await DrainAllStreamDataAsync(client, Quiet)).Where(f => f.Topic == Topic).ToList();
                Assert.Contains(frames, f => f.Payload != null);
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}

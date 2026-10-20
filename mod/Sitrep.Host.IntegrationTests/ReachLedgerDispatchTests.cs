using System.Collections.Generic;
using Xunit;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// The engine judges a command to a craft by the rule that decides who hears
    /// the craft: a crewed centre reaches its own craft, and no other centre
    /// reaches a craft whose link is down.
    /// </summary>
    public class ReachLedgerDispatchTests
    {
        private const string Craft = "own";
        private static readonly string Node = ChannelEngine.FleetNodePrefix + Craft;

        [Fact]
        public void ACrewedCentreCanSendToItsOwnCraftWhoseLinkHomeIsDown()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            engine.RegisterUplink(new FleetDelayTestUplink());
            engine.Start();
            try
            {
                engine.TickAndWait(0.0, FleetDelayTests.ConnFixture(0.0, (Craft, false)), TestBudgets.Op);
                engine.TickAndWait(1.0, FleetDelayTests.ConnFixture(1.0, (Craft, false)), TestBudgets.Op);

                Assert.True(engine.CanSend("vessel:" + Craft, Node));
                Assert.False(engine.CanSend("ground:far", Node));
            }
            finally
            {
                engine.Stop();
            }
        }
    }
}

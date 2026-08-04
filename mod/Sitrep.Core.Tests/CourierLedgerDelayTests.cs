using System.Collections.Generic;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// Locks the invariant the ledger migration (Plan 1) relies on: once the
    /// network default carries the signal delay, the Courier/Archive apply that
    /// delay EXACTLY ONCE (no double-delay, no zero-delay) for an ordinary
    /// topic recorded straight through the reveal gate.
    /// </summary>
    public class CourierLedgerDelayTests
    {
        private const string Node = "system";
        private const string Vantage = "KSC";

        [Fact]
        public void LedgerAppliesDefaultDelayExactlyOnce()
        {
            var clock = new ManualClock();
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(4.0); // the "signal delay"
            var courier = new Courier(clock, network);

            var delivered = new List<object?>();
            courier.SubscribeStream(Node, "vessel.orbit", Vantage, d => delivered.Add(d.Payload));

            // Recorded straight through (the gate applied 0), validAt = 0.
            courier.Record(Node, "vessel.orbit", 100.0, 0);

            clock.AdvanceTo(3.0);
            Assert.Empty(delivered); // withheld before the horizon (not zero-delay)

            clock.AdvanceTo(4.0);
            // Delivered once, at validAt + 4 (not 8 = gate+ledger double-delay).
            Assert.Equal(new List<object?> { 100.0 }, delivered);
        }

        [Fact]
        public void CommandRoundTripUsesTheLedgerDelayToWhenNoExplicitOverride()
        {
            var clock = new ManualClock();
            var network = new StubNetwork(delay: 0);
            network.SetDefaultDelay(3.0); // signal delay 3 -> round-trip 6
            var courier = new Courier(clock, network);
            courier.SetCommandHandler((command, args, node) => "ok");

            var results = new List<object?>();
            // No explicit uplinkDelaySeconds: the Courier falls back to
            // DelayTo(vantage, node), the Task-4 command-delay shape.
            courier.DispatchCommand(Node, "r1", "deploy", null, Vantage, r => results.Add(r.Result));

            clock.AdvanceTo(5.0);
            Assert.Empty(results); // confirm arrives at t0 + up + down = 6
            clock.AdvanceTo(6.0);
            Assert.Equal(new List<object?> { "ok" }, results);
            Assert.Equal(6.0, courier.RoundTripEta(Node, Vantage));
        }
    }
}

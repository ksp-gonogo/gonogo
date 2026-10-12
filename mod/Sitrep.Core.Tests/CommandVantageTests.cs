using System.Collections.Generic;
using Sitrep.Core;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A command arrives from somewhere, and for some commands that matters. The
    /// vantage was carried on the pending command all along and dropped at the
    /// handler boundary, so a handler could only ever answer from the game's own
    /// state, which is every vantage's future.
    /// </summary>
    public class CommandVantageTests
    {
        [Fact]
        public void AHandlerIsToldWhichCommandCentreSentTheCommand()
        {
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);
            var seen = new List<string>();
            courier.SetCommandHandler((command, args, node, vantage) =>
            {
                seen.Add(vantage);
                return null;
            });

            courier.DispatchCommand("n", "r1", "some.command", null, "MissionControl", _ => { });
            clock.AdvanceTo(10_000);

            Assert.Equal(new[] { "MissionControl" }, seen);
        }

        [Fact]
        public void TwoVantagesSendingTheSameCommandAreDistinguishable()
        {
            // The property the whole thing exists for: identical payloads, different
            // senders, and a handler that can tell. Without it, "where does this
            // craft go" has one answer for everyone, which is the answer only the
            // game is entitled to.
            var clock = new ManualClock();
            var network = new StubNetwork();
            var courier = new Courier(clock, network);
            var seen = new List<string>();
            courier.SetCommandHandler((command, args, node, vantage) =>
            {
                seen.Add(vantage);
                return null;
            });

            courier.DispatchCommand("n", "r1", "same.command", null, "KSC", _ => { });
            courier.DispatchCommand("n", "r2", "same.command", null, "Deep Space 1", _ => { });
            clock.AdvanceTo(10_000);

            Assert.Contains("KSC", seen);
            Assert.Contains("Deep Space 1", seen);
        }
    }
}

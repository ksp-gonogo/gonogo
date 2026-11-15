using System.Linq;
using Xunit;
using Xunit.Abstractions;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// A command centre whose plan shows the whole route open sends a command
    /// as one flight to the craft. When the game has no such path the flight
    /// is lost, and the copy is sent again after a wait that doubles with
    /// each loss, however short the signal delay is. In low orbit the delay
    /// is a few milliseconds, so a copy sent again as soon as its loss was
    /// known would be sent hundreds of times for every second of game time.
    /// </summary>
    public class LostEndToEndFlightTests
    {
        private const string Home = DeliveryScript.Home;
        private const string Relay = DeliveryScript.Relay;
        private const string Craft = DeliveryScript.Craft;

        private readonly ITestOutputHelper _output;

        public LostEndToEndFlightTests(ITestOutputHelper output) => _output = output;

        /// <summary>
        /// The plan opens the relay's link home from UT 100 to 900 and the game
        /// never does; the last look at the game before a tick to UT 1000 is at
        /// UT 10. The command leaves at 100 and each lost copy waits twice as
        /// long as the one before: ten flights in the 800 seconds, whether the
        /// signal delay is that of low orbit or none at all.
        /// </summary>
        [Theory]
        [InlineData(0.002, 0.0005)]
        [InlineData(0.0, 0.0)]
        public void ACommandLostOverTwoHopsIsSentAgainOnADoublingWait(double homeLightSeconds, double nearLightSeconds)
        {
            var script = new DeliveryScript
            {
                HomeLightSeconds = homeLightSeconds,
                NearLightSeconds = nearLightSeconds,
                LinkLag = DeliveryScript.Horizon,
                CallbackLimit = 100_000,
            };
            script.Windows[(Relay, Home)] = new() { (100.0, 900.0) };
            script.Windows[(Craft, Relay)] = new() { (0.0, DeliveryScript.Horizon) };
            for (var ut = 1.0; ut <= 10.0; ut += 1.0)
            {
                script.Ticks.Add(ut);
            }
            script.Ticks.Add(1000.0);
            script.Commands.Add(5.0);

            var log = script.Run(wakesOnDishTurnWaits: false);

            var lost = log.Where(line => line.StartsWith("report LostOnLanding")).ToList();
            _output.WriteLine(script.CallbacksFired + " clock callbacks, " + lost.Count + " copies lost");
            Assert.Equal(10, lost.Count);
            Assert.Equal(31, script.CallbacksFired);
        }

        /// <summary>
        /// Scripted flights at the signal delay of low orbit and at none, each
        /// with stretches of warp: none fires more clock callbacks than the
        /// same flight could at delays of seconds.
        /// </summary>
        [Theory]
        [InlineData(0.002, 0.000001)]
        [InlineData(0.0, 0.0)]
        public void NoScriptedFlightAtShortDelaysWorksThroughAWarpInStepsOfItsSignalDelay(double homeLightSeconds, double nearLightSeconds)
        {
            var worst = 0L;
            for (var seed = 0; seed < 60; seed++)
            {
                foreach (var retargets in new[] { false, true })
                {
                    var script = DeliveryScript.From(seed, retargets);
                    script.HomeLightSeconds = homeLightSeconds;
                    script.NearLightSeconds = nearLightSeconds;
                    script.CallbackLimit = 20_000;
                    script.Run(wakesOnDishTurnWaits: false);
                    worst = System.Math.Max(worst, script.CallbacksFired);
                }
            }
            _output.WriteLine("the busiest flight fired " + worst + " clock callbacks");
        }
    }
}

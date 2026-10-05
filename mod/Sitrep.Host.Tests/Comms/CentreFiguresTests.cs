using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Contacts;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class CentreFiguresTests
    {
        private const double Step = 10.0;
        private const double Horizon = 3600.0;
        private const double C = SignalDelay.SpeedOfLightMetersPerSecond;

        private static PairPlan Pair(string a, string b, double lightSeconds, params ContactWindow[] windows) =>
            new PairPlan(a, b, Horizon, windows, 0.0, Step, Enumerable.Repeat(lightSeconds * C, (int)(Horizon / Step) + 1).ToArray());

        private static ContactWindow Always() => new ContactWindow(null, null);

        private static CommandCentreEntry Entry(string id) => new CommandCentreEntry { Id = id, DisplayName = id, Active = true };

        private static readonly string[] Stations = { "ground:ksc", "ground:forward" };

        /// <summary>The crewed craft is two light-seconds from the forward station and out of the home station's sight; the probe is three from the crewed craft.</summary>
        private static readonly ContactPlan Plan = new ContactPlan(
            0.0,
            Horizon,
            Step,
            new[]
            {
                Pair("ground:forward", "vessel:crewed", 2.0, Always()),
                Pair("ground:ksc", "vessel:crewed", 2.0, new ContactWindow(1000.0, null)),
                Pair("vessel:crewed", "vessel:probe", 3.0, Always()),
            },
            0,
            0);

        private static readonly CommandCentreEntry[] Roster = { Entry("ground:ksc"), Entry("ground:forward"), Entry("vessel:crewed") };

        private static double? Seconds(CommandCentreSeparation separation, string from, string to) =>
            separation.Pairs.SingleOrDefault(p => p.From == from && p.To == to)?.OneWaySeconds;

        [Fact]
        public void EveryCentreIsNoDistanceFromItself()
        {
            var separation = CentreFigures.Separation(Roster, null, "ground:ksc", Stations, 10.0, 1.0);

            Assert.Equal(3, separation.Pairs.Count);
            Assert.All(separation.Pairs, p => Assert.Equal(p.From, p.To));
            Assert.All(separation.Pairs, p => Assert.Equal(0.0, p.OneWaySeconds));
        }

        [Fact]
        public void APairIsQuotedTheLightTimeOfTheRouteThePlanHasOpenNow()
        {
            var separation = CentreFigures.Separation(Roster, Plan, null, null, 10.0, 1.0);

            Assert.Equal(2.0, Seconds(separation, "ground:forward", "vessel:crewed")!.Value, 6);
            Assert.Equal(2.0, Seconds(separation, "vessel:crewed", "ground:forward")!.Value, 6);
            Assert.Null(Seconds(separation, "ground:ksc", "vessel:crewed"));
            Assert.Null(Seconds(separation, "ground:ksc", "ground:forward"));
        }

        [Fact]
        public void HomeIsAsFarFromACraftAsItsNearestGroundStationIs()
        {
            var separation = CentreFigures.Separation(Roster, Plan, "ground:ksc", Stations, 10.0, 1.0);

            Assert.Equal(2.0, Seconds(separation, "ground:ksc", "vessel:crewed")!.Value, 6);
            Assert.Equal(2.0, Seconds(separation, "vessel:crewed", "ground:ksc")!.Value, 6);
            Assert.Equal(0.0, Seconds(separation, "ground:ksc", "ground:forward")!.Value, 6);
        }

        [Fact]
        public void TheFiguresAreAtTheSpeedTheGameIsSetToModel()
        {
            var separation = CentreFigures.Separation(Roster, Plan, null, null, 10.0, 60.0);

            Assert.Equal(120.0, Seconds(separation, "ground:forward", "vessel:crewed")!.Value, 6);
        }

        [Fact]
        public void EachCentreIsQuotedItsOwnDelayToTheActiveCraftAndHomeIsNeverListed()
        {
            var delays = CentreFigures.ActiveVesselDelays(Roster, Plan, "vessel:probe", "ground:ksc", Stations, 10.0, 1.0);

            Assert.Equal(new[] { "ground:forward", "vessel:crewed" }, delays.Centres.Select(c => c.Id).ToArray());
            Assert.Equal(5.0, delays.Centres.Single(c => c.Id == "ground:forward").OneWaySeconds, 6);
            Assert.Equal(3.0, delays.Centres.Single(c => c.Id == "vessel:crewed").OneWaySeconds, 6);
        }

        [Fact]
        public void TheCentreThatIsTheActiveCraftIsNoDistanceFromItAndOneWithNoRouteIsNotListed()
        {
            var delays = CentreFigures.ActiveVesselDelays(Roster, null, "vessel:crewed", "ground:ksc", Stations, 10.0, 1.0);

            var own = Assert.Single(delays.Centres);
            Assert.Equal("vessel:crewed", own.Id);
            Assert.Equal(0.0, own.OneWaySeconds);
        }

        [Fact]
        public void WithNoActiveCraftNoCentreHasADelayToQuote()
        {
            Assert.Empty(CentreFigures.ActiveVesselDelays(Roster, Plan, null, "ground:ksc", Stations, 10.0, 1.0).Centres);
        }

        [Fact]
        public void ACentreThatLeftARosterIsRememberedWithTheLastTimeItWasOnItAndForgottenWhenItReturns()
        {
            var memory = new RosterMemory();
            memory.Observe(Roster, 100.0);
            Assert.Empty(memory.Unreachable());

            memory.Observe(new[] { Entry("ground:ksc"), Entry("ground:forward") }, 200.0);
            var gone = Assert.Single(memory.Unreachable());
            Assert.Equal("vessel:crewed", gone.Id);
            Assert.Equal("vessel:crewed", gone.DisplayName);
            Assert.Equal(100.0, gone.LastReachableUt);

            memory.Observe(new[] { Entry("ground:ksc"), Entry("ground:forward") }, 300.0);
            Assert.Equal(100.0, Assert.Single(memory.Unreachable()).LastReachableUt);

            memory.Observe(Roster, 400.0);
            Assert.Empty(memory.Unreachable());
        }

        [Fact]
        public void ACentreThatWasNeverOnARosterIsNotRemembered()
        {
            var memory = new RosterMemory();
            memory.Observe(new[] { Entry("ground:ksc") }, 100.0);

            Assert.Empty(memory.Unreachable());
        }
    }
}

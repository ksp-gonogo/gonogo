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
        public void ACentreIsQuotedTheRouteAsItWasWhenTheSignalItHearsNowLeftNotAsItIsNow()
        {
            var growing = new ContactPlan(
                0.0,
                Horizon,
                Step,
                new[]
                {
                    new PairPlan(
                        "ground:forward", "vessel:crewed", Horizon, new[] { Always() }, 0.0, Step,
                        Enumerable.Range(0, (int)(Horizon / Step) + 1).Select(i => (100.0 + 0.1 * i * Step) * C).ToArray()),
                },
                0,
                0);
            var now = 1000.0;

            var delays = CentreFigures.ActiveVesselDelays(Roster, growing, "vessel:crewed", "ground:ksc", Stations, now, 1.0);

            var heard = delays.Centres.Single(c => c.Id == "ground:forward").OneWaySeconds;
            var leftAt = now - heard;
            Assert.Equal(now, leftAt + CentreFigures.Between("vessel:crewed", "ground:forward", growing, "ground:ksc", Stations, leftAt, 1.0)!.Value, 1);
            var sentNow = CentreFigures.Between("vessel:crewed", "ground:forward", growing, "ground:ksc", Stations, now, 1.0)!.Value;
            Assert.True(sentNow - heard > 10.0, "the centre was quoted the delay of a signal sent now, which it cannot have heard yet");
        }

        [Fact]
        public void ACentreWhosePlanStartsAfterWhenTheSignalLeftIsQuotedTheRouteAtThePlansStart()
        {
            var late = new ContactPlan(
                900.0,
                Horizon,
                Step,
                new[]
                {
                    new PairPlan(
                        "ground:forward", "vessel:crewed", Horizon, new[] { Always() }, 900.0, Step,
                        Enumerable.Range(0, (int)(Horizon / Step) + 1).Select(i => (100.0 + 0.1 * i * Step) * C).ToArray()),
                },
                0,
                0);

            var delays = CentreFigures.ActiveVesselDelays(Roster, late, "vessel:crewed", "ground:ksc", Stations, 1000.0, 1.0);

            Assert.Single(delays.Centres, c => c.Id == "ground:forward");
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
        public void ACentreSaysWhyItLeftOnlyWhenTheGameOrItsOwnWordDoes()
        {
            var memory = new RosterMemory();
            memory.Observe(Roster, 100.0);

            memory.Observe(new[] { Entry("ground:ksc") }, 200.0);
            var station = memory.Unreachable().Single(e => e.Id == "ground:forward");
            var vessel = memory.Unreachable().Single(e => e.Id == "vessel:crewed");
            Assert.Equal(UnreachableReason.NoLongerExists, station.Reason);
            Assert.Null(vessel.Reason);

            memory.Observe(new[] { Entry("ground:ksc") }, 300.0, new[] { CraftState.WithoutARadio("vessel:crewed", 250.0, null) });
            Assert.Equal(UnreachableReason.NoLongerCentre, memory.Unreachable().Single(e => e.Id == "vessel:crewed").Reason);

            memory.Observe(new[] { Entry("ground:ksc") }, 400.0, new[] { CraftState.Gone("vessel:crewed", 350.0) });
            Assert.Equal(UnreachableReason.NoLongerExists, memory.Unreachable().Single(e => e.Id == "vessel:crewed").Reason);
        }

        [Fact]
        public void ACentreThatWasNeverOnARosterIsNotRemembered()
        {
            var memory = new RosterMemory();
            memory.Observe(new[] { Entry("ground:ksc") }, 100.0);

            Assert.Empty(memory.Unreachable());
        }

        /// <summary>The figure between two nodes asked on its own, which is what each entry of a whole table has to be.</summary>
        private static double? AloneAsHeardBy(string from, string to, ContactPlan plan, string? home, string[] antennas, double ut, double lightFactor)
        {
            var seconds = CentreFigures.Between(from, to, plan, home, antennas, ut, lightFactor);
            for (var pass = 0; seconds != null && pass < 6; pass++)
            {
                var settled = CentreFigures.Between(from, to, plan, home, antennas, System.Math.Max(plan.FromUt, ut - seconds.Value), lightFactor);
                if (settled == null || System.Math.Abs(settled.Value - seconds.Value) < 0.001)
                {
                    return settled;
                }
                seconds = settled;
            }
            return seconds;
        }

        [Fact]
        public void EveryFigureOfAWholeTableIsTheFigureAskedForThatPairAlone()
        {
            var random = new System.Random(1996);
            var nodes = new[] { "ground:ksc", "ground:forward", "ground:far", "vessel:crewed", "vessel:relay", "vessel:probe", "vessel:other" };
            var stations = new[] { "ground:ksc", "ground:forward", "ground:far" };
            var roster = nodes.Take(5).Select(Entry).ToArray();
            var compared = 0;
            for (var round = 0; round < 80; round++)
            {
                var pairs = new System.Collections.Generic.List<PairPlan>();
                for (var i = 0; i < nodes.Length; i++)
                {
                    for (var j = i + 1; j < nodes.Length; j++)
                    {
                        if ((i < 3 && j < 3) || random.Next(3) == 0)
                        {
                            continue;
                        }
                        var open = random.Next(2) == 0 ? (double?)null : random.NextDouble() * Horizon / 2.0;
                        var close = random.Next(2) == 0 ? (double?)null : (open ?? 0.0) + (random.NextDouble() * Horizon / 2.0);
                        var near = 1e7 + (random.NextDouble() * 3e9);
                        var drift = (random.NextDouble() - 0.5) * 1e6;
                        var separation = Enumerable.Range(0, (int)(Horizon / Step) + 1).Select(g => System.Math.Max(1.0, near + (drift * g))).ToArray();
                        pairs.Add(new PairPlan(nodes[i], nodes[j], Horizon, new[] { new ContactWindow(open, close) }, 0.0, Step, separation));
                    }
                }
                var plan = new ContactPlan(0.0, Horizon, Step, pairs, 0, 0);
                var home = random.Next(4) == 0 ? null : "ground:ksc";
                var lightFactor = random.Next(4) == 0 ? 0.5 : 1.0;
                var ut = random.NextDouble() * Horizon;

                var separationTable = CentreFigures.Separation(roster, plan, home, stations, ut, lightFactor);
                foreach (var from in roster)
                {
                    foreach (var to in roster)
                    {
                        var alone = CentreFigures.Between(from.Id, to.Id, plan, home, stations, ut, lightFactor);
                        Assert.Equal(alone, Seconds(separationTable, from.Id!, to.Id!));
                        compared++;
                    }
                }

                var delays = CentreFigures.ActiveVesselDelays(roster, plan, "vessel:probe", home, stations, ut, lightFactor);
                foreach (var centre in roster)
                {
                    var listed = delays.Centres.SingleOrDefault(c => c.Id == centre.Id)?.OneWaySeconds;
                    var alone = centre.Id == home ? null : AloneAsHeardBy("vessel:probe", centre.Id!, plan, home, stations, ut, lightFactor);
                    Assert.Equal(alone, listed);
                }
            }
            Assert.True(compared > 1_500, "only " + compared + " compared");
        }
    }
}

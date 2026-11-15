using System;
using System.Collections.Generic;
using Sitrep.Propagation.Contacts;
using Xunit;

namespace Sitrep.Propagation.Tests.Contacts
{
    /// <summary>
    /// One search from a set of sources answers for every set of destinations
    /// exactly as a search for those destinations alone does: the same route,
    /// hop for hop, or none where that finds none.
    /// </summary>
    public class EarliestArrivalsTests
    {
        private const double Step = 10.0;

        private static readonly string[] Nodes =
        {
            "ground:a", "ground:b", "ground:c", "vessel:d", "vessel:e", "vessel:f", "vessel:g", "vessel:h", "vessel:lost",
        };

        /// <summary>A plan whose pairs drift apart and together and are in contact over a few windows each, some never.</summary>
        private static ContactPlan RandomPlan(Random random, double horizon)
        {
            var points = (int)(horizon / Step) + 1;
            var pairs = new List<PairPlan>();
            for (var i = 0; i < Nodes.Length; i++)
            {
                for (var j = i + 1; j < Nodes.Length; j++)
                {
                    if (Nodes[i] == "vessel:lost" || Nodes[j] == "vessel:lost" || random.Next(4) == 0)
                    {
                        continue;
                    }
                    var windows = new List<ContactWindow>();
                    var at = random.Next(3) == 0 ? (double?)null : random.NextDouble() * horizon / 3.0;
                    while (windows.Count < 4)
                    {
                        var close = (at ?? 0.0) + (random.NextDouble() * horizon / 3.0);
                        var stillOpen = close >= horizon || random.Next(8) == 0;
                        windows.Add(new ContactWindow(at, stillOpen ? (double?)null : close));
                        if (stillOpen)
                        {
                            break;
                        }
                        at = close + (random.NextDouble() * horizon / 4.0);
                        if (at >= horizon)
                        {
                            break;
                        }
                    }
                    // Whole light-seconds on some pairs, so routes of equal arrival are common and the tie-breaks are used.
                    var near = random.Next(3) == 0 ? PairPlan.SpeedOfLight * random.Next(1, 4) : 1e6 + (random.NextDouble() * 4e9);
                    var drift = random.Next(3) == 0 ? 0.0 : (random.NextDouble() - 0.5) * 2e5;
                    var separation = new double[points];
                    for (var g = 0; g < points; g++)
                    {
                        separation[g] = Math.Max(1.0, near + (drift * g));
                    }
                    pairs.Add(new PairPlan(Nodes[i], Nodes[j], horizon, windows, 0.0, Step, separation));
                }
            }
            return new ContactPlan(0.0, horizon, Step, pairs, 0, 0);
        }

        private static List<string> Some(Random random, int most)
        {
            var chosen = new List<string>();
            var count = 1 + random.Next(most);
            while (chosen.Count < count)
            {
                var node = random.Next(12) == 0 ? "vessel:unheard-of" : Nodes[random.Next(Nodes.Length)];
                if (!chosen.Contains(node))
                {
                    chosen.Add(node);
                }
            }
            return chosen;
        }

        private static string Describe(ContactRoute? route)
        {
            if (route == null)
            {
                return "none";
            }
            var text = route.Source + ">" + route.Destination + "@" + route.SentUt.ToString("R");
            foreach (var hop in route.Hops)
            {
                text += " | " + hop.From + ">" + hop.To + " " + hop.DepartUt.ToString("R") + " " + hop.ArriveUt.ToString("R") + " " + hop.WindowCloseUt.ToString("R")
                    + " " + hop.DistanceMeters.ToString("R") + " " + hop.FromDish + " " + hop.ToDish + " " + hop.RetargetDish + " " + hop.TurnUt.ToString("R");
            }
            return text;
        }

        [Fact]
        public void EveryDestinationSetIsAnsweredAsASearchForItAloneAnswers()
        {
            var random = new Random(1996);
            var found = 0;
            for (var round = 0; round < 150; round++)
            {
                var horizon = 1800.0 + (random.Next(4) * 900.0);
                var plan = RandomPlan(random, horizon);
                var lightFactor = random.Next(4) == 0 ? 0.0 : random.Next(3) == 0 ? 0.25 : 1.0;
                for (var ask = 0; ask < 12; ask++)
                {
                    var sources = Some(random, 3);
                    var sentUt = random.NextDouble() * horizon;
                    double? deadline = random.Next(5) == 0 ? sentUt + (random.NextDouble() * horizon / 2.0) : (double?)null;
                    var all = ContactRouter.EarliestArrivalsFrom(plan, sources, sentUt, deadline, lightFactor);
                    for (var to = 0; to < 10; to++)
                    {
                        var destinations = Some(random, 4);
                        var alone = ContactRouter.EarliestArrivalBetween(plan, sources, destinations, sentUt, deadline, lightFactor);
                        Assert.Equal(Describe(alone), Describe(all.To(destinations)));
                        found += alone != null && alone.Hops.Count > 0 ? 1 : 0;
                    }
                }
            }
            Assert.True(found > 2_000, "only " + found + " routes with a hop were compared");
        }

        /// <summary>
        /// A search with no retarget routing makes a hop only for a try that betters
        /// what its far node holds. One given routing that lets no node turn a dish
        /// makes every hop and then compares, and can use no turn, so the two have
        /// to find the same route.
        /// </summary>
        [Fact]
        public void TheRouteIsTheSameWhetherEveryHopTriedIsMadeOrOnlyTheOnesThatWin()
        {
            var random = new Random(52);
            var noTurns = new RetargetRouting(30.0, 60.0, onlyAtNodes: new string[0]);
            var found = 0;
            for (var round = 0; round < 150; round++)
            {
                var horizon = 1800.0 + (random.Next(4) * 900.0);
                var plan = RandomPlan(random, horizon);
                var lightFactor = random.Next(4) == 0 ? 0.0 : random.Next(3) == 0 ? 0.25 : 1.0;
                for (var ask = 0; ask < 60; ask++)
                {
                    var sources = Some(random, 3);
                    var destinations = Some(random, 4);
                    var sentUt = random.NextDouble() * horizon;
                    double? deadline = random.Next(5) == 0 ? sentUt + (random.NextDouble() * horizon / 2.0) : (double?)null;
                    var everyHop = ContactRouter.EarliestArrivalBetween(plan, sources, destinations, sentUt, deadline, lightFactor, noTurns);
                    var winners = ContactRouter.EarliestArrivalBetween(plan, sources, destinations, sentUt, deadline, lightFactor);
                    Assert.Equal(Describe(everyHop), Describe(winners));
                    found += everyHop != null && everyHop.Hops.Count > 1 ? 1 : 0;
                }
            }
            Assert.True(found > 1_000, "only " + found + " routes of more than one hop were compared");
        }
    }
}

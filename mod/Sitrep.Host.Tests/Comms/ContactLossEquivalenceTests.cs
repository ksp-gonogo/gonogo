using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Contacts;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// <see cref="ContactLoss.Next"/> and <see cref="ContactLossMemo"/> answer exactly as
    /// <see cref="ContactLossBySearch"/> does, over plans made to be awkward: windows that
    /// overlap, share an edge, sit a fraction of a millisecond apart, never open or never
    /// close, and pairs whose own horizon ends before the plan's.
    /// </summary>
    public class ContactLossEquivalenceTests
    {
        private const string Home = "ground:ksc";

        private static readonly string[] Stations = { Home, "ground:b", "ground:c" };

        private static readonly string[] Craft = { "vessel:a", "vessel:b", "vessel:c", "vessel:d", "vessel:e" };

        private static ContactPlan RandomPlan(Random random, double fromUt, double horizonUt)
        {
            var nodes = new List<string>(Stations);
            nodes.AddRange(Craft);
            var pairs = new List<PairPlan>();
            // Edges are drawn from a coarse grid as well as freely, so many windows share one exactly.
            double Edge() => random.Next(4) == 0
                ? fromUt + (random.Next(40) * (horizonUt - fromUt) / 40.0)
                : fromUt + (random.NextDouble() * (horizonUt - fromUt));
            for (var i = 0; i < nodes.Count; i++)
            {
                for (var j = i + 1; j < nodes.Count; j++)
                {
                    if (i < Stations.Length && j < Stations.Length || random.Next(3) == 0)
                    {
                        continue;
                    }
                    var windows = new List<ContactWindow>();
                    var count = random.Next(5);
                    for (var w = 0; w < count; w++)
                    {
                        var open = Edge();
                        var close = random.Next(12) == 0 ? open + (random.NextDouble() * 0.002) : open + (random.NextDouble() * (horizonUt - fromUt) / 6.0);
                        switch (random.Next(14))
                        {
                            case 0:
                                windows.Add(new ContactWindow(null, close));
                                break;
                            case 1:
                                windows.Add(new ContactWindow(open, null));
                                break;
                            case 2:
                                windows.Add(new ContactWindow(null, null));
                                break;
                            case 3:
                                // Closes before it opens: open at no instant, and its edges are still instants the plan names.
                                windows.Add(new ContactWindow(close, open));
                                break;
                            default:
                                windows.Add(new ContactWindow(open, close));
                                break;
                        }
                    }
                    var pairHorizon = random.Next(6) == 0 ? fromUt + (random.NextDouble() * (horizonUt - fromUt)) : horizonUt;
                    pairs.Add(new PairPlan(nodes[i], nodes[j], pairHorizon, windows));
                }
            }
            return new ContactPlan(fromUt, horizonUt, 10.0, pairs, 0, 0);
        }

        private static void AssertSame(CommsNextLoss expected, CommsNextLoss actual, string what)
        {
            Assert.True(expected.Basis == actual.Basis, what + ": basis " + expected.Basis + " against " + actual.Basis);
            Assert.True(Nullable.Equals(expected.Ut, actual.Ut), what + ": ut " + expected.Ut + " against " + actual.Ut);
            Assert.True(
                Nullable.Equals(expected.NextAcquisitionUt, actual.NextAcquisitionUt),
                what + ": next acquisition " + expected.NextAcquisitionUt + " against " + actual.NextAcquisitionUt);
            Assert.True(expected.CoveredToUt.Equals(actual.CoveredToUt), what + ": covered to " + expected.CoveredToUt + " against " + actual.CoveredToUt);
            Assert.True(expected.LowConfidence == actual.LowConfidence, what + ": low confidence");
        }

        /// <summary>The instants worth asking at: each edge, either side of it by less and by more than the search reads past it, and some in between.</summary>
        private static List<double> Instants(ContactPlan plan, Random random)
        {
            var instants = new List<double> { plan.FromUt - 5.0, plan.FromUt, plan.HorizonUt, plan.HorizonUt + 5.0 };
            foreach (var pair in plan.Pairs)
            {
                instants.Add(pair.HorizonUt);
                foreach (var window in pair.Windows)
                {
                    foreach (var edge in new[] { window.OpenUt, window.CloseUt })
                    {
                        if (edge is double at)
                        {
                            instants.AddRange(new[] { at, at - 0.0005, at + 0.0005, at - 0.002, at + 0.002 });
                        }
                    }
                }
            }
            for (var i = 0; i < 40; i++)
            {
                instants.Add(plan.FromUt + (random.NextDouble() * (plan.HorizonUt - plan.FromUt)));
            }
            return instants;
        }

        [Fact]
        public void TheSweepAnswersAsTheSearchDoesAtEveryInstantOfManyPlans()
        {
            var random = new Random(1996);
            var asked = 0;
            for (var round = 0; round < 60; round++)
            {
                var plan = RandomPlan(random, 1000.0, 1000.0 + 600.0 + (random.NextDouble() * 3000.0));
                var unsettled = random.Next(2) == 0 ? null : new[] { Craft[random.Next(Craft.Length)] };
                foreach (var ut in Instants(plan, random))
                {
                    var craft = Craft[random.Next(Craft.Length)];
                    // Home, which hears through every station, a station of its own, and a craft that is a centre.
                    var centre = random.Next(3) == 0 ? Craft[random.Next(Craft.Length)] : Stations[random.Next(Stations.Length)];
                    foreach (var live in new bool?[] { null, true, false })
                    {
                        var expected = ContactLossBySearch.Next(plan, craft, centre, Home, Stations, ut, unsettled, live);
                        var actual = ContactLoss.Next(plan, craft, centre, Home, Stations, ut, unsettled, live);
                        AssertSame(expected, actual, "round " + round + " ut " + ut.ToString("R") + " " + craft + " to " + centre + " live " + live);
                        asked++;
                    }
                }
            }
            Assert.True(asked > 10_000, "only " + asked + " asked");
        }

        [Fact]
        public void TheKeptAnswerIsTheSearchsAnswerOnEveryTickAsTimePassesAndThePlanChanges()
        {
            var random = new Random(2026);
            var kept = new ContactLossMemo();
            for (var round = 0; round < 25; round++)
            {
                var plan = RandomPlan(random, 500.0, 500.0 + 900.0 + (random.NextDouble() * 900.0));
                var craft = Craft[random.Next(Craft.Length)];
                var centre = random.Next(3) == 0 ? Craft[random.Next(Craft.Length)] : Stations[random.Next(Stations.Length)];
                var unsettled = random.Next(2) == 0 ? null : new[] { craft };
                bool? live = null;
                var ut = plan.FromUt - 3.0;
                while (ut < plan.HorizonUt + 3.0)
                {
                    if (random.Next(40) == 0)
                    {
                        live = random.Next(3) == 0 ? (bool?)null : random.Next(2) == 0;
                    }
                    if (random.Next(60) == 0)
                    {
                        // The game went back, as a load does.
                        ut -= random.NextDouble() * 50.0;
                    }
                    var expected = ContactLossBySearch.Next(plan, craft, centre, Home, Stations, ut, unsettled, live);
                    var actual = kept.Next(plan, craft, centre, Home, Stations, ut, unsettled, live);
                    AssertSame(expected, actual, "round " + round + " ut " + ut.ToString("R") + " " + craft + " to " + centre + " live " + live);
                    ut += random.Next(5) == 0 ? random.NextDouble() * 0.01 : 0.25 + random.NextDouble();
                }
            }
        }

        [Fact]
        public void TheKeptAnswerTurnsOverAtTheInstantAWindowCloses()
        {
            var plan = new ContactPlan(0.0, 7200.0, 10.0, new[]
            {
                new PairPlan(Home, "vessel:a", 7200.0, new[] { new ContactWindow(null, 1500.0), new ContactWindow(2000.0, 2600.0) }),
            }, 0, 0);
            var kept = new ContactLossMemo();

            var first = kept.Next(plan, "vessel:a", Home, Home, Stations, 100.0);
            var second = kept.Next(plan, "vessel:a", Home, Home, Stations, 1499.0);
            var after = kept.Next(plan, "vessel:a", Home, Home, Stations, 1500.0);

            Assert.NotSame(first, second);
            Assert.Equal(1500.0, second.Ut);
            Assert.Equal(NextLossBasis.OutOfContact, after.Basis);
            Assert.Equal(2000.0, after.NextAcquisitionUt);
        }
    }
}

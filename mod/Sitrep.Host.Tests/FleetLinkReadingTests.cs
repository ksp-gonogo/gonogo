using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The link of a craft the game is not simulating is a route solved afresh
    /// over the live graph to a home node, never the craft's own cached state,
    /// which the game refreshes only when the craft is focused on a map. A solve
    /// that ran and found nothing is a craft with no link; a solve that could not
    /// be asked is no reading.
    /// </summary>
    public class FleetLinkReadingTests
    {
        private static readonly CommsNodeHandle Ksc = CommsNodeHandle.Of(new object())!;
        private static readonly CommsNodeHandle Cape = CommsNodeHandle.Of(new object())!;

        private static IReadOnlyList<CommsRouteHop> OneHop() => new[] { new CommsRouteHop(6000.0, true) };

        [Fact]
        public void ACraftRoutedToAHomeNodeIsConnectedAndNamesTheHomeItReached()
        {
            var solve = FleetLinkReading.SolveUnloaded(new[] { Ksc, Cape }, home => ReferenceEquals(home, Cape) ? OneHop() : null);

            Assert.True(solve.Connected);
            Assert.Same(Cape, solve.Home);
            Assert.Single(solve.Hops!);
        }

        [Fact]
        public void ACraftNoHomeNodeRoutesToIsNotConnected()
        {
            var solve = FleetLinkReading.SolveUnloaded(new[] { Ksc, Cape }, _ => null);

            Assert.False(solve.Connected);
            Assert.Null(solve.Home);
        }

        [Fact]
        public void ARouteWithNothingToMeasureStillCountsAsRouted()
        {
            var solve = FleetLinkReading.SolveUnloaded(new[] { Ksc }, _ => new List<CommsRouteHop>());

            Assert.True(solve.Connected);
        }

        [Fact]
        public void NoHomeNodeToSolveToIsNoReadingAndNotADisconnection()
        {
            Assert.Null(FleetLinkReading.SolveUnloaded(Array.Empty<CommsNodeHandle>(), _ => null).Connected);
        }

        [Fact]
        public void ASolveThatThrowsIsNoReading()
        {
            var solve = FleetLinkReading.SolveUnloaded(new[] { Ksc }, _ => throw new InvalidOperationException("torn down"));

            Assert.Null(solve.Connected);
        }

        [Fact]
        public void TheFirstHomeThatRoutesEndsTheSearch()
        {
            var asked = new List<CommsNodeHandle>();

            FleetLinkReading.SolveUnloaded(new[] { Ksc, Cape }, home =>
            {
                asked.Add(home);
                return OneHop();
            });

            Assert.Equal(new[] { Ksc }, asked);
        }

        [Fact]
        public void TheCacheSolvesOncePerCraftWithinItsWindowAndAgainAfterIt()
        {
            var cache = new FleetLinkCache(windowSeconds: 5.0);
            var solves = 0;
            FleetLinkReading.LinkSolve Solve()
            {
                solves++;
                return new FleetLinkReading.LinkSolve(true, null, null);
            }

            cache.Get("a", 10.0, Solve);
            cache.Get("a", 14.9, Solve);
            cache.Get("b", 14.9, Solve);
            Assert.Equal(2, solves);

            cache.Get("a", 15.1, Solve);
            Assert.Equal(3, solves);
        }

        [Fact]
        public void TheCacheAnswersAgainWhenTheClockGoesBack()
        {
            var cache = new FleetLinkCache(windowSeconds: 5.0);
            var solves = 0;
            FleetLinkReading.LinkSolve Solve()
            {
                solves++;
                return new FleetLinkReading.LinkSolve(false, null, null);
            }

            cache.Get("a", 100.0, Solve);
            cache.Get("a", 20.0, Solve);

            Assert.Equal(2, solves);
        }
    }
}

using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// A relay chain to Eeloo, 286.49 s of signal delay from the probe to KSC.
    /// Relay 7 is destroyed at UT 350304158 and the game reroutes the probe
    /// from Relay 8 straight to the Jool relay. KSC learns of the new route
    /// from the first sample sent over it, one signal delay later.
    /// </summary>
    public class ReceivedRoutesTests
    {
        private const string Ksc = "ground:Kerbin: KSC";
        private const string Probe = "vessel:probe";
        private const double DeletedAt = 350304158.0;

        /// <summary>A route home over <paramref name="relays"/>, each hop a share of 85.89 Gm.</summary>
        private static IReadOnlyList<CommsHop> Over(params string[] relays)
        {
            var hops = new List<CommsHop>();
            var from = "probe";
            var each = 85_888_000_000.0 / (relays.Length + 1);
            foreach (var to in relays.Concat(new[] { "ksc" }))
            {
                hops.Add(new CommsHop { From = from, To = to, DistanceMeters = each });
                from = to;
            }
            return hops;
        }

        private static readonly IReadOnlyList<CommsHop> Chain = Over("r8", "r7", "r6", "r5", "r4", "r3", "r2", "r1");

        private static readonly IReadOnlyList<CommsHop> Rerouted = Over("r8", "r6", "r4", "r2", "r1");

        private static string? First(IReadOnlyList<CommsHop>? route) => route?[1].To;

        [Fact]
        public void ARerouteReachesTheCentreOneSignalDelayAfterIt()
        {
            var routes = new ReceivedRoutes();
            for (var ut = DeletedAt - 600.0; ut < DeletedAt; ut += 1.0)
            {
                routes.Note(Ksc, Probe, ut, Chain, 1.0);
            }

            Assert.Equal("r7", First(routes.Note(Ksc, Probe, DeletedAt, Rerouted, 1.0)));
            for (var ut = DeletedAt + 1.0; ut < DeletedAt + 286.0; ut += 1.0)
            {
                Assert.Equal("r7", First(routes.Note(Ksc, Probe, ut, Rerouted, 1.0)));
            }
            Assert.Equal("r6", First(routes.Note(Ksc, Probe, DeletedAt + 287.0, Rerouted, 1.0)));
        }

        [Fact]
        public void ALostRouteReachesTheCentreWithTheLastSamplesSentOverIt()
        {
            var routes = new ReceivedRoutes();
            for (var ut = DeletedAt - 600.0; ut < DeletedAt; ut += 1.0)
            {
                routes.Note(Ksc, Probe, ut, Chain, 1.0);
            }

            Assert.NotNull(routes.Note(Ksc, Probe, DeletedAt, null, 1.0));
            Assert.NotNull(routes.Note(Ksc, Probe, DeletedAt + 285.0, null, 1.0));
            Assert.Null(routes.Note(Ksc, Probe, DeletedAt + 287.0, null, 1.0));
        }

        [Fact]
        public void ARouteTheCentreHasNotYetHeardOverIsNoRoute()
        {
            var routes = new ReceivedRoutes();

            Assert.Null(routes.Note(Ksc, Probe, DeletedAt, Chain, 1.0));
            Assert.NotNull(routes.Note(Ksc, Probe, DeletedAt + 287.0, Chain, 1.0));
        }

        [Fact]
        public void WithNoDelayAppliedTheRouteIsKnownAtOnce()
        {
            var routes = new ReceivedRoutes();

            Assert.Equal("r7", First(routes.Note(Ksc, Probe, DeletedAt, Chain, 0.0)));
            Assert.Equal("r6", First(routes.Note(Ksc, Probe, DeletedAt + 1.0, Rerouted, 0.0)));
        }

        [Fact]
        public void AnotherCraftStartsWithNothingHeard()
        {
            var routes = new ReceivedRoutes();
            routes.Note(Ksc, Probe, DeletedAt, Chain, 1.0);
            Assert.NotNull(routes.Note(Ksc, Probe, DeletedAt + 287.0, Chain, 1.0));

            Assert.Null(routes.Note(Ksc, "vessel:other", DeletedAt + 288.0, Chain, 1.0));
        }
    }
}

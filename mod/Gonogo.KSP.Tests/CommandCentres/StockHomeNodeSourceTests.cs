using System.Collections.Generic;
using System.Linq;
using Gonogo.KSP.CommandCentres;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Gonogo.KSP.Tests.CommandCentres
{
    /// <summary>
    /// A save with CommNet disabled in its difficulty settings never gets a CommNet
    /// node on any home, because stock builds a home's node only once the network
    /// initialises. Its space centre is still where the save is commanded from, so
    /// it must still be a command centre, be named home, and be where a fresh
    /// connection stands.
    /// </summary>
    public class StockHomeNodeSourceTests
    {
        private const string Ksc = "ground:Kerbal Space Center";

        [Fact]
        public void TheSpaceCentreIsACentreAndHomeWithNoCommNetNodeAnywhere()
        {
            var source = new StockHomeNodeSource(() => new[]
            {
                Home(isKsc: false, "Nye Island Station"),
                Home(isKsc: true, "Kerbal Space Center"),
            });

            var centre = Assert.Single(source.Enumerate());
            Assert.Equal(Ksc, centre.Id);
            Assert.Equal(CommandCentreKind.GroundStation, centre.Kind);
            Assert.True(centre.IsActiveNow());
            Assert.Null(((KspCommandCentre)centre).Node);

            var active = source.Enumerate().ToList();
            var home = new StockHomeCommandProvider(source.HomeFacts).Identify(active);
            Assert.True(home.IsIdentified);
            Assert.Equal(Ksc, home.CentreId);

            var vantage = FreshConnectionVantage.Choose(
                active.Select(c => c.Id).ToList(),
                active.Where(c => c.Kind == CommandCentreKind.GroundStation).Select(c => c.Id),
                home);
            Assert.Equal(Ksc, vantage);
        }

        [Fact]
        public void AStationThatIsNotTheSpaceCentreWaitsForItsNode()
        {
            var source = new StockHomeNodeSource(() => new[] { Home(isKsc: false, "Nye Island Station") });

            Assert.Empty(source.Enumerate());
        }

        private static HomeReading Home(bool isKsc, string name) =>
            new HomeReading(isKsc, name, displayName: null, comm: null, body: null, position: new Vector3d(0, 0, 0));
    }
}

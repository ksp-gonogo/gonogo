using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.Tests.CommandCentres
{
    /// <summary>
    /// Which centres read the home-command ledger at zero and which at their own path
    /// home. The ledger's address is one station, but every ground station acts as
    /// home, so standing on the ground network is standing at the ledger.
    /// </summary>
    public class HomeCommandRowsTests
    {
        private static Dictionary<string, double> Rows(
            IReadOnlyList<ICommandCentre> centres,
            string? homeId,
            System.Func<ICommandCentre, double?> secondsToHome)
        {
            var rows = new Dictionary<string, double>();
            new AuthorityMatrixPass().PopulateHomeCommand(centres, homeId, secondsToHome, (id, s) => rows[id] = s);
            return rows;
        }

        [Fact]
        public void EveryGroundStationReadsTheLedgerAtZeroNotOnlyTheOneNamedHome()
        {
            var rows = Rows(
                new ICommandCentre[]
                {
                    new FakeCommandCentre("ground:Cape"),
                    new FakeCommandCentre("ground:Goldstone"),
                },
                "ground:Cape",
                _ => 99.0);

            Assert.Equal(0.0, rows["ground:Cape"]);
            Assert.Equal(0.0, rows["ground:Goldstone"]);
        }

        [Fact]
        public void ACrewedVesselReadsTheLedgerAtItsOwnPathHome()
        {
            var rows = Rows(
                new ICommandCentre[]
                {
                    new FakeCommandCentre("ground:Cape"),
                    new FakeCommandCentre("vessel:G", CommandCentreKind.CrewedVessel),
                },
                "ground:Cape",
                centre => centre.Id == "vessel:G" ? 12.5 : null);

            Assert.Equal(12.5, rows["vessel:G"]);
        }

        /// <summary>
        /// Home is whatever the roster marks home, so a claimant naming a craft makes that
        /// craft the ledger's address and it reads its own ledger at zero.
        /// </summary>
        [Fact]
        public void TheCentreNamedHomeReadsZeroWhateverItsKind()
        {
            var rows = Rows(
                new ICommandCentre[] { new FakeCommandCentre("vessel:H", CommandCentreKind.CrewedVessel) },
                "vessel:H",
                _ => 40.0);

            Assert.Equal(0.0, rows["vessel:H"]);
        }

        [Fact]
        public void ACentreWithNoMeasurablePathHomeGetsNoRow()
        {
            var rows = Rows(
                new ICommandCentre[] { new FakeCommandCentre("colony:X", CommandCentreKind.Colony) },
                null,
                _ => null);

            Assert.Empty(rows);
        }
    }
}

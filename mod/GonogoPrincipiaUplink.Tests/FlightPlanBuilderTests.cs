using System.Collections.Generic;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The pure mapper, and in particular the one thing it decides: which burns are
    /// anomalous.
    ///
    /// <para>The integrator reports a COUNT and its own render passes
    /// <c>index &gt;= count - n</c> as each burn's anomalous flag, so the flagged
    /// burns are the last n. Resolving it here means a client cannot silently
    /// disagree with the integrator about which burn is broken, which is a
    /// disagreement nothing would surface.</para>
    /// </summary>
    public class FlightPlanBuilderTests
    {
        [Theory]
        [InlineData(0, 3, 0, false)]
        [InlineData(2, 3, 0, false)]
        [InlineData(0, 3, 1, false)]
        [InlineData(1, 3, 1, false)]
        [InlineData(2, 3, 1, true)]
        [InlineData(1, 3, 2, true)]
        [InlineData(2, 3, 2, true)]
        [InlineData(0, 3, 3, true)]
        public void FlagsTheLastNBurns(int index, int burnCount, int anomalousCount, bool expected)
        {
            Assert.Equal(expected, FlightPlanBuilder.IsAnomalous(index, burnCount, anomalousCount));
        }

        /// <summary>
        /// The count comes off a reflected field, so an out-of-range value narrows
        /// rather than throwing inside a render postfix: a negative count flags
        /// nothing, an oversized one flags everything.
        /// </summary>
        [Theory]
        [InlineData(0, 3, -1, false)]
        [InlineData(2, 3, 99, true)]
        public void ClampsAnImpossibleCountInsteadOfTrustingIt(
            int index, int burnCount, int anomalousCount, bool expected)
        {
            Assert.Equal(expected, FlightPlanBuilder.IsAnomalous(index, burnCount, anomalousCount));
        }

        [Fact]
        public void CarriesTheObservationInstantOntoTheWire()
        {
            var dict = FlightPlanBuilder.Build(new FlightPlanObservation
            {
                VesselId = "guid-7",
                ObservedAtUt = 4_242.0,
                PlanExists = true,
            });

            Assert.Equal("guid-7", dict["vesselId"]);
            Assert.Equal(4_242.0, dict["observedAtUt"]);
            Assert.Equal(true, dict["planExists"]);
        }

        /// <summary>
        /// An unreadable status reaches the wire as null, not as a boolean. The
        /// contract's third state has to survive the mapper, or the client is back to
        /// choosing between "integrated" and "failed" for a plan whose status nobody
        /// could read.
        /// </summary>
        [Fact]
        public void AnUnknownIntegrationStatusStaysNullOnTheWire()
        {
            var dict = FlightPlanBuilder.Build(new FlightPlanObservation());

            Assert.Null(dict["planIntegrated"]);
            Assert.Null(dict["statusError"]);
        }

        [Fact]
        public void ResolvesEachBurnsAnomalousFlagSoNoClientHasTo()
        {
            var dict = FlightPlanBuilder.Build(new FlightPlanObservation
            {
                AnomalousBurnCount = 1,
                Burns = new List<BurnObservation>
                {
                    new BurnObservation { Index = 0, IgnitionUt = 100.0 },
                    new BurnObservation { Index = 1, IgnitionUt = 200.0 },
                },
            });

            var burns = Assert.IsType<List<object?>>(dict["burns"]);
            Assert.Equal(2, burns.Count);
            Assert.Equal(false, Row(burns, 0)["anomalous"]);
            Assert.Equal(true, Row(burns, 1)["anomalous"]);
        }

        [Fact]
        public void APlanWithNoBurnsCarriesAnEmptyListRatherThanNull()
        {
            // Only ever reached for an OBSERVED plan with no burns in it. The
            // never-observed case never gets here at all: the uplink publishes
            // nothing, so there is no payload to be empty.
            var dict = FlightPlanBuilder.Build(new FlightPlanObservation { PlanExists = true });

            Assert.Empty(Assert.IsType<List<object?>>(dict["burns"]));
        }

        private static Dictionary<string, object?> Row(List<object?> burns, int index) =>
            Assert.IsType<Dictionary<string, object?>>(burns[index]);
    }
}

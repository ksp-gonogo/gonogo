using System.Collections.Generic;
using Gonogo.KSP;
using Xunit;

namespace Gonogo.KSP.Tests.SilenceTracking
{
    /// <summary>
    /// The aggregate exists so a consumer that does not already know which
    /// vessel to ask about can read the fleet's reckoning. That only works if it
    /// says the same thing the per-vessel topic says, so these pin the two
    /// together rather than checking the aggregate against a hand-written
    /// expectation that could drift with it.
    /// </summary>
    public class FleetSilenceRosterBuilderTests
    {
        [Fact]
        public void AnEntryCarriesEverythingThePerVesselTopicCarries()
        {
            var perVessel = FleetVesselSilenceBuilder.Build(
                "Silent", 1000.0, 2000.0, "predicted-reacquisition", 1600.0, 322.0);
            var entry = FleetSilenceRosterBuilder.BuildEntry(
                "v-1", "Silent", 1000.0, 2000.0, "predicted-reacquisition", 1600.0, 322.0);

            foreach (var pair in perVessel)
            {
                Assert.True(entry.ContainsKey(pair.Key), $"aggregate entry is missing {pair.Key}");
                Assert.Equal(pair.Value, entry[pair.Key]);
            }
        }

        [Fact]
        public void AnEntryAddsTheVesselIdThePerVesselTopicGetsFromItsTopicString()
        {
            var entry = FleetSilenceRosterBuilder.BuildEntry(
                "v-1", "Nominal", null, null, null, null, null);

            Assert.Equal("v-1", entry["vesselId"]);
        }

        /// <summary>
        /// A withheld value stays withheld through the aggregate. Dropping the
        /// key instead of carrying a null would make "no prediction" and "the
        /// producer did not say" indistinguishable to a reader, which is the one
        /// distinction the whole silence contract is careful about.
        /// </summary>
        [Fact]
        public void WithheldValuesArriveAsNullsRatherThanAsAbsentKeys()
        {
            var entry = FleetSilenceRosterBuilder.BuildEntry(
                "v-1", "Silent", 1000.0, 2000.0, "no-occultation", null, null);

            Assert.True(entry.ContainsKey("predictedReacquisitionUt"));
            Assert.Null(entry["predictedReacquisitionUt"]);
        }

        [Fact]
        public void TheRosterWrapsItsEntriesTheWaySystemVesselsDoes()
        {
            var roster = FleetSilenceRosterBuilder.Build(new List<Dictionary<string, object?>>
            {
                FleetSilenceRosterBuilder.BuildEntry("v-1", "Silent", 1000.0, 2000.0, "orbital-period", null, null),
                FleetSilenceRosterBuilder.BuildEntry("v-2", "Nominal", null, null, null, null, null),
            });

            var vessels = Assert.IsAssignableFrom<IReadOnlyList<Dictionary<string, object?>>>(roster["vessels"]);
            Assert.Equal(2, vessels.Count);
            Assert.Equal("v-1", vessels[0]["vesselId"]);
            Assert.Equal("v-2", vessels[1]["vesselId"]);
        }

        /// <summary>
        /// An empty fleet is a real answer and has to be distinguishable from a
        /// topic that has not delivered. The wrapper object is what carries that:
        /// an absent payload is silence, `{ vessels: [] }` is a fleet of none.
        /// </summary>
        [Fact]
        public void AnEmptyFleetIsAnEmptyListRatherThanAnAbsentKey()
        {
            var roster = FleetSilenceRosterBuilder.Build(new List<Dictionary<string, object?>>());

            Assert.True(roster.ContainsKey("vessels"));
            var vessels = Assert.IsAssignableFrom<IReadOnlyList<Dictionary<string, object?>>>(roster["vessels"]);
            Assert.Empty(vessels);
        }
    }
}

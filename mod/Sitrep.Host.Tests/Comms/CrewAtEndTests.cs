using System.Collections.Generic;
using System.Linq;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>What the roster says of a terminated craft's crew is tallied by status and rides every record of the end.</summary>
    public class CrewAtEndTests
    {
        [Fact]
        public void TheRosterStatusesAreTalliedAsDeadAndMissingAndNothingElseIsCounted()
        {
            var crew = CrewAtEnd.Of(new[] { "Dead", "Missing", "Missing", "Available", "Assigned" });

            Assert.Equal(1, crew.Dead);
            Assert.Equal(2, crew.Missing);
        }

        [Fact]
        public void ANoCrewRosterTalliesNothing()
        {
            var crew = CrewAtEnd.Of(Enumerable.Empty<string>());

            Assert.Equal(0, crew.Dead);
            Assert.Equal(0, crew.Missing);
        }

        [Fact]
        public void TheCrewOutcomeSurvivesTheLastSightingBeingListedAsBefore()
        {
            var before = CraftSighting.Of("vessel:a", 10.0, new Dictionary<string, object?> { ["vesselId"] = "a", ["name"] = "Probe" });
            var gone = CraftSighting.Gone("vessel:a", 20.0, CraftEnd.Terminated, crew: new CrewAtEnd(1, 2)).ListedAsBefore(before);

            Assert.Equal(2, gone.EndCrew!.Missing);
            Assert.NotNull(gone.Listed);
            Assert.Equal(1, CraftSighting.Known(null, gone)!.EndCrew!.Dead);
        }

        [Fact]
        public void TheCrewOutcomeSurvivesAGoneStateBeingListedAsBefore()
        {
            var before = new Dictionary<string, object?> { ["vesselId"] = "a" };
            var state = CraftState.Gone("vessel:a", 20.0, CraftEnd.Terminated, null, new CrewAtEnd(0, 3)).ListedAsBefore(CraftState.Gone("vessel:a", 10.0, CraftEnd.Absorbed, before));

            Assert.Equal(3, state.EndCrew!.Missing);
        }

        [Fact]
        public void TheCrewOutcomeComesBackFromASave()
        {
            var listed = new Dictionary<string, object?> { ["vesselId"] = "a" };
            var encoded = HeardSnapshotCodec.Encode(new HeardSnapshot(new[]
            {
                new HeardAtCentre(
                    "ground:ksc",
                    new[] { CraftState.Gone("vessel:a", 300.0, CraftEnd.Terminated, listed, new CrewAtEnd(1, 2)) },
                    new Dictionary<string, bool>(),
                    sightings: new[] { CraftSighting.Gone("vessel:b", 310.0, CraftEnd.Terminated, listed, new CrewAtEnd(0, 4)) }),
            }));

            var centre = HeardSnapshotCodec.Decode(encoded)!.Centres.Single();

            Assert.Equal(2, centre.States.Single().EndCrew!.Missing);
            Assert.Equal(4, centre.Sightings.Single().EndCrew!.Missing);
        }

        [Fact]
        public void ASaveWithNoCrewOutcomeHasNone()
        {
            var encoded = HeardSnapshotCodec.Encode(new HeardSnapshot(new[]
            {
                new HeardAtCentre("ground:ksc", new[] { CraftState.Gone("vessel:a", 300.0, CraftEnd.Destroyed) }, new Dictionary<string, bool>()),
            }));

            Assert.Null(HeardSnapshotCodec.Decode(encoded)!.Centres.Single().States.Single().EndCrew);
        }
    }
}

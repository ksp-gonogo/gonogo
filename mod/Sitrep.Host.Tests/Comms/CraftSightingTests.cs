using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// What a centre knows of a craft from what it has heard and what it has
    /// seen: where the craft is from whichever is newer, everything else only
    /// as heard.
    /// </summary>
    public class CraftSightingTests
    {
        private static OrbitElements Orbit(double sma) => new OrbitElements(sma, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 3.5316e12);

        private static Dictionary<string, object?> Entry(int situation, int crew, double sma) => new Dictionary<string, object?>
        {
            ["vesselId"] = "a",
            ["name"] = "Alpha",
            ["vesselType"] = 3,
            ["situation"] = situation,
            ["bodyIndex"] = 1,
            ["crewCount"] = crew,
            ["commsConnected"] = true,
            ["orbit"] = new Dictionary<string, object?> { ["sma"] = sma },
        };

        private static readonly Dictionary<string, CraftLink> Links = new Dictionary<string, CraftLink> { ["ground:ksc"] = new CraftLink(1e9, null) };

        private static CraftState Heard(double ut, double sma, int crew) =>
            CraftState.Orbiting("vessel:a", ut, 1, Orbit(sma), null, null, true, Links).Named("Alpha").Listed(Entry(32, crew, sma));

        private static CraftSighting Seen(double ut, double sma, int crew = 99) =>
            CraftSighting.Of("vessel:a", ut, Entry(32, crew, sma), CraftState.Orbiting("vessel:a", ut, 1, Orbit(sma), null, null, true, Links).PlaceOnly());

        [Fact]
        public void ASightingCarriesNothingATelescopeCouldNotTell()
        {
            var seen = Seen(5.0, 700_000.0, crew: 3);

            Assert.False(seen.Listed!.ContainsKey("crewCount"));
            Assert.False(seen.Listed.ContainsKey("commsConnected"));
            Assert.Equal("Alpha", seen.Listed["name"]);
            Assert.Empty(seen.Place!.Links);
        }

        [Fact]
        public void ASightingKeepsWhereOnTheGroundACraftIsBecauseATelescopeCanSeeIt()
        {
            var listed = Entry(8, 3, 700_000.0);
            listed["landedAt"] = "Runway";
            listed["latitude"] = -0.0486;
            listed["longitude"] = -74.7244;

            var seen = CraftSighting.Of("vessel:a", 5.0, listed, null);

            Assert.Equal("Runway", seen.Listed!["landedAt"]);
            Assert.Equal(-0.0486, seen.Listed["latitude"]);
            Assert.Equal(-74.7244, seen.Listed["longitude"]);
            Assert.False(seen.Listed.ContainsKey("crewCount"));
        }

        [Fact]
        public void ANewerSightingMovesTheCraftAndChangesNothingElseAboutIt()
        {
            var entry = new CommandCentreEntry { Id = "vessel:a" };
            var heard = Heard(10.0, 700_000.0, crew: 2).AsCentre(entry);

            var known = CraftSighting.Known(heard, Seen(20.0, 900_000.0))!;

            Assert.Equal(20.0, known.CapturedUt);
            Assert.Equal(900_000.0, known.Orbit!.Value.Sma);
            Assert.Equal(900_000.0, ((Dictionary<string, object?>)known.Roster!["orbit"]!)["sma"]);
            Assert.Equal(2, known.Roster["crewCount"]);
            Assert.Equal(true, known.Roster["commsConnected"]);
            Assert.Same(heard.Links, known.Links);
            Assert.Same(entry, known.Centre);
            Assert.True(known.Plannable);
        }

        [Fact]
        public void AStateHeardAsLateAsTheSightingStandsAsItWasHeard()
        {
            var heard = Heard(20.0, 800_000.0, crew: 2);

            Assert.Same(heard, CraftSighting.Known(heard, Seen(20.0, 800_000.0)));
            Assert.Same(heard, CraftSighting.Known(heard, Seen(10.0, 700_000.0)));
            Assert.Same(heard, CraftSighting.Known(heard, null));
        }

        [Fact]
        public void ACraftOnlyEverSeenIsKnownByWhereItIsAndIsLeftOutOfEveryPlan()
        {
            var known = CraftSighting.Known(null, Seen(20.0, 900_000.0))!;

            Assert.True(known.Exists);
            Assert.False(known.Plannable);
            Assert.Null(known.ToPlanNode());
            Assert.Equal("Alpha", known.Roster!["name"]);
            Assert.Null(known.Roster["crewCount"]);
            Assert.Null(known.Roster["commsConnected"]);
            Assert.Equal(900_000.0, ((Dictionary<string, object?>)known.Roster["orbit"]!)["sma"]);
        }

        [Fact]
        public void AnObjectSeenToBeGoneIsGoneWhateverWasLastHeardOfIt()
        {
            var known = CraftSighting.Known(Heard(10.0, 700_000.0, crew: 2), CraftSighting.Gone("vessel:a", 20.0))!;

            Assert.False(known.Exists);
            Assert.Equal(20.0, known.CapturedUt);
        }

        [Fact]
        public void NothingHeardAndNothingSeenIsNothingKnown()
        {
            Assert.Null(CraftSighting.Known(null, null));
        }

        [Fact]
        public void TwoSightingsOnTheSameOrbitInTheSameSituationAreTheSamePlace()
        {
            Assert.True(CraftSighting.SamePlace(Seen(1.0, 700_000.0).Listed, Seen(2.0, 700_000.0 * (1.0 + 1e-9)).Listed));
            Assert.False(CraftSighting.SamePlace(Seen(1.0, 700_000.0).Listed, Seen(2.0, 701_000.0).Listed));
            Assert.False(CraftSighting.SamePlace(Seen(1.0, 700_000.0).Listed, CraftSighting.Of("vessel:a", 2.0, Entry(8, 0, 700_000.0)).Listed));
        }
    }
}

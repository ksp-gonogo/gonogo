using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class CraftKnowledgeTests
    {
        private static CraftState Craft(string guid, double ut, double sma, VesselType type = VesselType.Probe) =>
            CraftState.WithoutARadio("vessel:" + guid, ut, new Dictionary<string, object?>
            {
                ["vesselId"] = guid,
                ["name"] = guid.ToUpperInvariant(),
                ["vesselType"] = (int)type,
                ["situation"] = (int)Situation.Orbiting,
                ["bodyIndex"] = 1,
                ["orbit"] = new Dictionary<string, object?> { ["sma"] = sma },
            });

        private static Dictionary<string, object?> GameCraft(string guid, double distance, bool current = false) => new Dictionary<string, object?>
        {
            ["kind"] = (int)TargetKind.Vessel, ["vesselId"] = guid, ["distance"] = distance, ["isCurrent"] = current,
        };

        private static Dictionary<string, object?> Entry(CraftKnowledge knowledge, string guid, IReadOnlyList<object?>? game = null, params string[] inRange) =>
            knowledge.Entries(game, inRange).Cast<Dictionary<string, object?>>().Single(e => (string?)e["vesselId"] == guid);

        [Fact]
        public void TheNewestThingLearnedOfACraftStandsWhicheverWayItCame()
        {
            var knowledge = new CraftKnowledge();
            knowledge.Learn(Craft("b", 100.0, 700_000.0), 100.0, TargetKnowledge.CommandCentre, "KSC");
            knowledge.Learn(Craft("b", 150.0, 800_000.0), 150.0, TargetKnowledge.DirectLink, null);
            knowledge.Learn(Craft("b", 120.0, 750_000.0), 120.0, TargetKnowledge.CommandCentre, "KSC");

            var entry = Entry(knowledge, "b");

            Assert.Equal((int)TargetKnowledge.DirectLink, entry["source"]);
            Assert.Equal(150.0, entry["asOfUt"]);
            Assert.Null(entry["via"]);
            Assert.Equal(800_000.0, ((Dictionary<string, object?>)entry["orbit"]!)["sma"]);
            Assert.Equal(1, entry["orbitBodyIndex"]);
            Assert.Equal("B", entry["name"]);
        }

        [Fact]
        public void ALiveLinkThatBringsNothingNewSaysHowLateTheCraftIsKnownUnchanged()
        {
            var knowledge = new CraftKnowledge();
            knowledge.Learn(Craft("b", 100.0, 700_000.0), 100.0, TargetKnowledge.DirectLink, null);

            knowledge.HeardNothingNewTo("vessel:b", 100.0, 690.0);

            var entry = Entry(knowledge, "b");
            Assert.Equal(100.0, entry["asOfUt"]);
            Assert.Equal(690.0, entry["unchangedToUt"]);
        }

        [Fact]
        public void NewerWordOfACraftEndsWhatSilenceSaidOfTheOlder()
        {
            var knowledge = new CraftKnowledge();
            knowledge.Learn(Craft("b", 100.0, 700_000.0), 100.0, TargetKnowledge.DirectLink, null);
            knowledge.HeardNothingNewTo("vessel:b", 100.0, 690.0);

            knowledge.Learn(Craft("b", 700.0, 800_000.0), 700.0, TargetKnowledge.DirectLink, null);

            Assert.Null(Entry(knowledge, "b")["unchangedToUt"]);
        }

        [Fact]
        public void SilenceSaysNothingOfACraftKnownSomeOtherWayOrByNewerWordThanTheLinkCarried()
        {
            var knowledge = new CraftKnowledge();
            knowledge.Learn(Craft("b", 100.0, 700_000.0), 100.0, TargetKnowledge.CommandCentre, "KSC");
            knowledge.Learn(Craft("c", 300.0, 700_000.0), 300.0, TargetKnowledge.DirectLink, null);

            knowledge.HeardNothingNewTo("vessel:b", 100.0, 690.0);
            // The link's newest word of c is older than what is held, and a time before what is held says nothing.
            knowledge.HeardNothingNewTo("vessel:c", 200.0, 690.0);
            knowledge.HeardNothingNewTo("vessel:c", 300.0, 250.0);

            Assert.Null(Entry(knowledge, "b")["unchangedToUt"]);
            Assert.Null(Entry(knowledge, "c")["unchangedToUt"]);
        }

        [Fact]
        public void WhatSilenceSaidStandsWhereItStoodOnceTheLinkIsGone()
        {
            var knowledge = new CraftKnowledge();
            knowledge.Learn(Craft("b", 100.0, 700_000.0), 100.0, TargetKnowledge.DirectLink, null);
            knowledge.HeardNothingNewTo("vessel:b", 100.0, 690.0);
            knowledge.HeardNothingNewTo("vessel:b", 100.0, 400.0);

            Assert.Equal(690.0, Entry(knowledge, "b")["unchangedToUt"]);
        }

        [Fact]
        public void ARangeIsQuotedOnlyToACraftBesideThisOne()
        {
            var knowledge = new CraftKnowledge();
            knowledge.Learn(Craft("near", 10.0, 700_000.0), 10.0, TargetKnowledge.InRange, null);
            knowledge.Learn(Craft("far", 5.0, 700_000.0), 5.0, TargetKnowledge.CommandCentre, "KSC");
            var game = new object?[] { GameCraft("near", 2500.0), GameCraft("far", 9e9, current: true) };

            Assert.Equal(2500.0, Entry(knowledge, "near", game, "near")["distance"]);
            var far = Entry(knowledge, "far", game, "near");
            Assert.Null(far["distance"]);
            Assert.Equal(true, far["isCurrent"]);
            Assert.Equal("KSC", far["via"]);
        }

        [Fact]
        public void ACraftTheGameHasThatThisOneHasNotLearnedOfIsNotListed()
        {
            var knowledge = new CraftKnowledge();

            var entries = knowledge.Entries(new object?[] { GameCraft("secret", 9e9) }, new string[0]);

            Assert.Empty(entries);
        }

        [Fact]
        public void BeingToldACraftIsGoneForgetsItAndOlderNewsDoesNotBringItBack()
        {
            var knowledge = new CraftKnowledge();
            knowledge.Learn(Craft("b", 100.0, 700_000.0), 100.0, TargetKnowledge.CommandCentre, "KSC");
            knowledge.Learn(CraftState.Gone("vessel:b", 200.0), 200.0, TargetKnowledge.CommandCentre, "KSC");

            Assert.Empty(knowledge.Known);
        }

        [Fact]
        public void TheGamesOwnBodiesAndThePortsOfACraftInRangePassThroughAndAFarCraftsPortsDoNot()
        {
            var knowledge = new CraftKnowledge();
            var body = new Dictionary<string, object?> { ["kind"] = (int)TargetKind.Body, ["bodyIndex"] = 2 };
            var nearPort = new Dictionary<string, object?> { ["kind"] = (int)TargetKind.Part, ["vesselId"] = "near", ["partId"] = 7u };
            var farPort = new Dictionary<string, object?> { ["kind"] = (int)TargetKind.Part, ["vesselId"] = "far", ["partId"] = 8u };

            var entries = knowledge.Entries(new object?[] { body, nearPort, farPort }, new[] { "near" });

            Assert.Equal(new object?[] { body, nearPort }, entries);
        }

        [Fact]
        public void DebrisAndFlagsAreKnownAndNotOfferedAsTargets()
        {
            var knowledge = new CraftKnowledge();
            knowledge.Learn(Craft("junk", 1.0, 700_000.0, VesselType.Debris), 1.0, TargetKnowledge.InRange, null);

            Assert.Single(knowledge.Known);
            Assert.Empty(knowledge.Entries(null, new[] { "junk" }));
        }

        [Fact]
        public void WhatWasSaidByAnEarlierInstantCanBeAskedFor()
        {
            var said = new SaidByWhen();
            var first = Craft("b", 10.0, 700_000.0);
            var second = Craft("b", 50.0, 800_000.0);
            said.Note("vessel:b", 10.0, first);
            said.Note("vessel:b", 50.0, second);

            Assert.Null(said.AsOf("vessel:b", 9.0));
            Assert.Same(first, said.AsOf("vessel:b", 49.0));
            Assert.Same(second, said.AsOf("vessel:b", 50.0));
            Assert.Same(second, said.AsOf("vessel:b", 500.0));
            Assert.Null(said.AsOf("vessel:other", 500.0));
        }
    }
}

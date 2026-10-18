using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// What a command centre has heard is its own, and it keeps it while the
    /// game is not listing the centre.
    ///
    /// <para>A game resumed from the main menu builds its ground stations and
    /// its crewed craft over the first few ticks, so the first passes after a
    /// load see no centres, and then only some of them. A centre missing from
    /// a pass is not listened at, since there is nowhere to hear. What the save
    /// restored for it has to be there when it is listed again, where it used
    /// to be thrown away on the first pass that did not list it.</para>
    /// </summary>
    public class CentreHearingTests
    {
        private const int Kerbin = 0;
        private const string Home = "ground:home";
        private const string Crewed = "vessel:crewed";
        private const string Probe = "vessel:probe";

        private static readonly OrbitElements Orbit = new OrbitElements(700_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 3.5316e12);

        private sealed class Silent : ICraftStateHost
        {
            public int Listening { get; private set; }

            private Action Hear()
            {
                Listening++;
                return () => Listening--;
            }

            public void RecordCraftState(string vesselId, CraftState state, double ut)
            {
            }

            public void NoteCraftPresent(string vesselId, double ut)
            {
            }

            public void RecordCraftGone(string vesselId, double ut, CraftEnd end)
            {
            }

            public void RecordCraftSighting(string vesselId, CraftSighting sighting, double ut, IReadOnlyDictionary<string, double> lightSeconds)
            {
            }

            public void KeepCraftUntil(string vesselId, double untilUt)
            {
            }

            public Action HearCraftSighting(string vesselId, string centre, Action<CraftSighting> seen) => Hear();

            public Action HearCraftLink(string vesselId, string centre, Action<bool> heard) => Hear();

            public Action HearCraftReach(string vesselId, string centre, Action<CraftReach> heard) => Hear();

            public void RecordCentreReport(string vesselId, CentreReport report, double ut)
            {
            }

            public Action HearCentreReport(string vesselId, string centre, Action<CentreReport> heard) => Hear();

            public Action HearCraftForecast(string vesselId, string centre, Action<CraftForecast> heard) => Hear();

            public void RecordHomeVerdict(string vesselId, HomeVerdict verdict, double ut)
            {
            }

            public Action HearHomeVerdict(string vesselId, string centre, Action<HomeVerdict> heard) => Hear();

            public void RecordCraftRadio(string vesselId, ContactRadio radio, double ut)
            {
            }

            public Action HearCraftRadio(string vesselId, string centre, Action<ContactRadio> heard) => Hear();

            public Action HearCraftState(string vesselId, string centre, Action<CraftState> heard) => Hear();

            public void OnTimelineReset(Action reset)
            {
            }

            public Action<string>? Released { get; private set; }

            public void OnCraftReleased(Action<string> released) => Released = released;
        }

        private static HeardSnapshot Saved() => new HeardSnapshot(new[] { Knows(Home, 0.7), Knows(Crewed, 0.4) });

        private static HeardAtCentre Knows(string centre, double strength) => new HeardAtCentre(
            centre,
            new[] { CraftState.Orbiting(Probe, 100.0, Kerbin, Orbit, null, null, true, new Dictionary<string, CraftLink>()) },
            new Dictionary<string, bool> { [Probe] = true },
            new[] { new ContactRadio(Probe, true, strength, new CommsDegrade { ModelId = "m" }) { CapturedUt = 100.0 } });

        private static double? StrengthAt(CentreHearing hearing, string centre) => hearing.RadioAt(centre, Probe)?.Strength;

        /// <summary>
        /// A craft the host has let go is no longer listened for at any centre,
        /// and a later pass does not start listening for it again.
        /// </summary>
        [Fact]
        public void AReleasedCraftIsNoLongerListenedFor()
        {
            var host = new Silent();
            var hearing = new CentreHearing(host);
            hearing.Listen(new[] { Home, Crewed }, new[] { "probe" });
            Assert.Equal(16, host.Listening);

            host.Released!("probe");
            hearing.Listen(new[] { Home, Crewed }, new string[0]);

            Assert.Equal(0, host.Listening);
        }

        [Fact]
        public void WhatASaveRestoredSurvivesAPassThatListsNoCentresAndThenOnlySome()
        {
            var hearing = new CentreHearing(new Silent());
            hearing.Restore(Saved());

            hearing.Listen(new string[0], new[] { "probe" });
            hearing.Listen(new[] { Home }, new[] { "probe" });

            Assert.Single(hearing.HeardAt(Home));
            Assert.Equal(0.7, StrengthAt(hearing, Home));
            Assert.True(hearing.LinkAt(Home, Probe));

            hearing.Listen(new[] { Home, Crewed }, new[] { "probe" });

            Assert.Single(hearing.HeardAt(Crewed));
            Assert.Equal(0.4, StrengthAt(hearing, Crewed));
        }

        [Fact]
        public void ASaveWrittenWhileNoCentreIsListedStillCarriesWhatEachHadHeard()
        {
            var hearing = new CentreHearing(new Silent());
            hearing.Restore(Saved());

            hearing.Listen(new string[0], new[] { "probe" });

            var saved = hearing.Snapshot();
            Assert.Equal(new[] { Home, Crewed }.OrderBy(c => c), saved.Centres.Select(c => c.Centre).OrderBy(c => c));
            Assert.All(saved.Centres, c => Assert.Single(c.States));
        }

        [Fact]
        public void ACentreThatIsACraftTheGameNoLongerHasIsForgottenAndLeftOutOfTheNextSave()
        {
            var hearing = new CentreHearing(new Silent());
            hearing.Restore(Saved());
            hearing.Listen(new[] { Home }, new[] { "probe" });

            Assert.Equal(1, hearing.ForgetGone(new[] { "probe" }));

            Assert.Equal(new[] { Home }, hearing.Snapshot().Centres.Select(c => c.Centre));
            hearing.Listen(new[] { Home, Crewed }, new[] { "probe" });
            Assert.Empty(hearing.HeardAt(Crewed));
        }

        [Fact]
        public void ACentreThatIsACraftStillInTheGameKeepsWhatItHeardWhileItIsNotListed()
        {
            var hearing = new CentreHearing(new Silent());
            hearing.Restore(Saved());
            hearing.Listen(new[] { Home }, new[] { "probe" });

            Assert.Equal(0, hearing.ForgetGone(new[] { "probe", "crewed" }));

            hearing.Listen(new[] { Home, Crewed }, new[] { "probe" });
            Assert.Equal(0.4, StrengthAt(hearing, Crewed));
        }

        [Fact]
        public void ACentreThatIsListedOrIsNotACraftIsNeverForgotten()
        {
            var hearing = new CentreHearing(new Silent());
            hearing.Restore(Saved());
            hearing.Listen(new[] { Crewed }, new[] { "probe" });

            // Home is a ground station that is not listed, and the crewed craft is listed though the game's list does not hold it.
            Assert.Equal(0, hearing.ForgetGone(new string[0]));

            Assert.Equal(0.4, StrengthAt(hearing, Crewed));
            hearing.Listen(new[] { Home, Crewed }, new[] { "probe" });
            Assert.Equal(0.7, StrengthAt(hearing, Home));
        }

        /// <summary>The game lists craft only in flight. Word of a craft read outside it has no list entry, and must not cost a centre the one it holds.</summary>
        [Fact]
        public void NewerWordOfACraftThatCarriesNoListEntryLeavesTheCentreTheEntryItHad()
        {
            var listed = new Dictionary<string, object?> { ["vesselId"] = "probe", ["name"] = "Probe" };
            var links = new Dictionary<string, CraftLink>();
            var hearing = new CentreHearing(new Silent());
            hearing.Restore(new HeardSnapshot(new[]
            {
                new HeardAtCentre(Home, new[] { CraftState.Orbiting(Probe, 100.0, Kerbin, Orbit, null, null, true, links).Listed(listed) }, new Dictionary<string, bool>()),
            }));

            hearing.Restore(new HeardSnapshot(new[]
            {
                new HeardAtCentre(Home, new[] { CraftState.Orbiting(Probe, 200.0, Kerbin, Orbit, null, null, true, links) }, new Dictionary<string, bool>()),
            }));

            hearing.Listen(new[] { Home }, new[] { "probe" });

            var held = Assert.Single(hearing.HeardAt(Home));
            Assert.Equal(200.0, held.CapturedUt);
            Assert.Equal("Probe", held.Roster!["name"]);
        }

        private static HeardSnapshot Reached(double ut, double lastHomeUt) => new HeardSnapshot(new[]
        {
            new HeardAtCentre(
                Home,
                new[] { CraftState.Orbiting(Probe, 100.0, Kerbin, Orbit, null, null, true, new Dictionary<string, CraftLink>()) },
                new Dictionary<string, bool>(),
                reaches: new[] { new CraftReach(Probe, ut, new Dictionary<string, double> { [Home] = lastHomeUt }) }),
        });

        /// <summary>Word of who can hear a craft that left before the word a centre holds changes nothing, as with every other word of a craft.</summary>
        [Fact]
        public void OlderWordOfWhoCanHearACraftLeavesTheCentreTheNewerWordItHad()
        {
            var hearing = new CentreHearing(new Silent());
            hearing.Restore(Reached(300.0, 299.0));
            hearing.Restore(Reached(200.0, 200.0));
            hearing.Listen(new[] { Home }, new[] { "probe" });

            Assert.Equal(300.0, hearing.ReachAt(Home, Probe)!.CapturedUt);
            var contact = hearing.ContactAt(Home, Probe)!.Value;
            Assert.Equal(CentreContactState.Silent, contact.State);
            Assert.Equal(299.0, contact.LastContactUt);
        }

        [Fact]
        public void WhoCanHearACraftIsSavedWithWhatTheCentreHeard()
        {
            var hearing = new CentreHearing(new Silent());
            hearing.Restore(Reached(300.0, 300.0));
            hearing.Listen(new[] { Home }, new[] { "probe" });

            var saved = Assert.Single(Assert.Single(hearing.Snapshot().Centres).Reaches);
            Assert.True(saved.Reaches(Home));
            Assert.Equal(CentreContactState.InContact, hearing.ContactAt(Home, Probe)!.Value.State);
        }

        private const string Far = "ground:far";

        private static CraftReach ReachOf(string craft, double ut, params (string Centre, double LastUt)[] rows)
        {
            var last = new Dictionary<string, double>();
            foreach (var (centre, lastUt) in rows)
            {
                last[centre] = lastUt;
            }
            return new CraftReach(craft, ut, last);
        }

        private static CentreReport Report(double ut, CentreContactState state, double? last) =>
            new CentreReport(Crewed, ut, new Dictionary<string, CentreContact> { [Probe] = new CentreContact(state, last) });

        /// <summary>
        /// The home centre: silent with the probe itself, in contact with the crewed
        /// centre, holding the reports given, and a far ground station that heard
        /// the probe as <paramref name="farOnProbe"/> says.
        /// </summary>
        private static CentreHearing HomeHearing(bool homeHearsCrewed, CraftReach? farOnProbe, params CentreReport[] reports)
        {
            var hearing = new CentreHearing(new Silent());
            var homeReaches = new List<CraftReach>
            {
                ReachOf(Probe, 500.0, (Home, 400.0)),
                homeHearsCrewed ? ReachOf(Crewed, 500.0, (Home, 500.0)) : ReachOf(Crewed, 500.0, (Home, 450.0)),
            };
            var centres = new List<HeardAtCentre>
            {
                new HeardAtCentre(Home, new CraftState[0], new Dictionary<string, bool>(), reaches: homeReaches, reports: reports),
            };
            if (farOnProbe != null)
            {
                centres.Add(new HeardAtCentre(Far, new CraftState[0], new Dictionary<string, bool>(), reaches: new[] { farOnProbe }));
            }
            hearing.Restore(new HeardSnapshot(centres));
            hearing.Listen(new[] { Home, Far }, new[] { "probe", "crewed" });
            return hearing;
        }

        [Fact]
        public void HomeIsInContactWithACraftAGroundStationHearsThoughItCannotItself()
        {
            var hearing = HomeHearing(true, ReachOf(Probe, 500.0, (Far, 500.0)));

            Assert.Equal(CentreContactState.InContact, hearing.HomeContactAt(Home, new[] { Home, Far }, Probe)!.Value.State);
            Assert.Equal(CentreContactState.Silent, hearing.ContactAt(Home, Probe)!.Value.State);
        }

        [Fact]
        public void HomeIsInContactWithACraftACrewedCentreReportsItHears()
        {
            var hearing = HomeHearing(true, null, Report(480.0, CentreContactState.InContact, 480.0));

            Assert.Equal(CentreContactState.InContact, hearing.HomeContactAt(Home, new[] { Home, Far }, Probe)!.Value.State);
        }

        /// <summary>A crewed centre the ground has lost may still be hearing the craft, but home knows only that it was when it last reported.</summary>
        [Fact]
        public void ACrewedCentreTheGroundHasLostLeavesHomeSilentSinceItsLastReport()
        {
            var hearing = HomeHearing(false, null, Report(440.0, CentreContactState.InContact, 440.0));

            var contact = hearing.HomeContactAt(Home, new[] { Home, Far }, Probe)!.Value;
            Assert.Equal(CentreContactState.Silent, contact.State);
            Assert.Equal(440.0, contact.LastContactUt);
        }

        [Fact]
        public void AnOlderReportFromTheSameCentreChangesNothingAndReportsAreSaved()
        {
            var hearing = HomeHearing(true, null, Report(480.0, CentreContactState.Silent, 470.0));
            hearing.Restore(new HeardSnapshot(new[]
            {
                new HeardAtCentre(Home, new CraftState[0], new Dictionary<string, bool>(), reports: new[] { Report(300.0, CentreContactState.InContact, 300.0) }),
            }));

            var contact = hearing.HomeContactAt(Home, new[] { Home, Far }, Probe)!.Value;
            Assert.Equal(CentreContactState.Silent, contact.State);
            Assert.Equal(470.0, contact.LastContactUt);
            var saved = Assert.Single(hearing.Snapshot().Centres.Single(c => c.Centre == Home).Reports);
            Assert.Equal(480.0, saved.CapturedUt);
        }

        [Fact]
        public void ACentreThatIsNotListedIsNotListenedAt()
        {
            var host = new Silent();
            var hearing = new CentreHearing(host);
            hearing.Listen(new[] { Home }, new[] { "probe" });
            Assert.True(host.Listening > 0);

            hearing.Listen(new string[0], new string[0]);

            Assert.Equal(0, host.Listening);
        }

        [Fact]
        public void ANewTimelineForgetsWhatEveryCentreHadHeardListedOrNot()
        {
            var hearing = new CentreHearing(new Silent());
            hearing.Restore(Saved());
            hearing.Listen(new string[0], new[] { "probe" });

            hearing.Reset();
            hearing.Listen(new[] { Home }, new[] { "probe" });

            Assert.Empty(hearing.HeardAt(Home));
            Assert.Empty(hearing.Snapshot().Centres.Where(c => c.States.Count > 0));
        }

        private static readonly IReadOnlyDictionary<string, object?> ProbeListed =
            new Dictionary<string, object?> { ["vesselId"] = "probe", ["name"] = "Probe", ["vesselType"] = (int)VesselType.Probe };

        private static CraftState Flying(double ut) =>
            CraftState.Orbiting(Probe, ut, Kerbin, Orbit, null, null, true, new Dictionary<string, CraftLink>()).Listed(ProbeListed);

        private static CentreHearing HomeHeard(IReadOnlyList<CraftState> states, IReadOnlyList<CraftSighting>? sightings = null, IReadOnlyList<string>? dismissed = null)
        {
            var hearing = new CentreHearing(new Silent());
            hearing.Restore(new HeardSnapshot(new[]
            {
                new HeardAtCentre(Home, states, new Dictionary<string, bool>(), sightings: sightings, dismissed: dismissed),
            }));
            hearing.Listen(new[] { Home }, new string[0]);
            return hearing;
        }

        [Fact]
        public void ACraftWhoseLastWordIsThatItIsGoneEndedAsHeardAndKeepsItsEntry()
        {
            var hearing = HomeHeard(new[] { CraftState.Gone(Probe, 10.0, CraftEnd.Destroyed, ProbeListed) });

            Assert.Equal((RosterPlaceSource.Heard, 10.0, CraftEnd.Destroyed), hearing.EndAt(Home, Probe));
            Assert.Equal("Probe", hearing.HeardAt(Home).Single().Roster!["name"]);
        }

        [Fact]
        public void ACraftLastHeardFlyingAndSinceSeenGoneEndedAsSeenWithTheEntryItWasHeardBy()
        {
            var hearing = HomeHeard(new[] { Flying(5.0) }, new[] { CraftSighting.Gone(Probe, 10.0, CraftEnd.Destroyed) });

            Assert.Equal((RosterPlaceSource.Seen, 10.0, CraftEnd.Destroyed), hearing.EndAt(Home, Probe));
            Assert.Equal("Probe", hearing.HeardAt(Home).Single().Roster!["name"]);
        }

        [Fact]
        public void ACraftStillFlyingHasNoEndAndCannotBeDismissed()
        {
            var hearing = HomeHeard(new[] { Flying(5.0) });

            Assert.Null(hearing.EndAt(Home, Probe));
            Assert.False(hearing.Dismiss(Home, Probe));
            Assert.False(hearing.DismissedAt(Home, Probe));
        }

        [Fact]
        public void ADismissalIsKeptInTheSave()
        {
            var hearing = HomeHeard(new[] { CraftState.Gone(Probe, 10.0, CraftEnd.Destroyed, ProbeListed) });
            Assert.True(hearing.Dismiss(Home, Probe));

            var saved = hearing.Snapshot().Centres.Single(c => c.Centre == Home);
            var restored = HomeHeard(saved.States, saved.Sightings, saved.Dismissed);

            Assert.True(restored.DismissedAt(Home, Probe));
        }
}
}

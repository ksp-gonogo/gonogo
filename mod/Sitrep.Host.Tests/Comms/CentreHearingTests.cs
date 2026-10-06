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

            public void RecordCraftGone(string vesselId, double ut)
            {
            }

            public void RecordCraftSighting(string vesselId, CraftSighting sighting, double ut, IReadOnlyDictionary<string, double> lightSeconds)
            {
            }

            public Action HearCraftSighting(string vesselId, string centre, Action<CraftSighting> seen) => Hear();

            public Action HearCraftLink(string vesselId, string centre, Action<bool> heard) => Hear();

            public void RecordCraftRadio(string vesselId, ContactRadio radio, double ut)
            {
            }

            public Action HearCraftRadio(string vesselId, string centre, Action<ContactRadio> heard) => Hear();

            public Action HearCraftState(string vesselId, string centre, Action<CraftState> heard) => Hear();

            public void OnTimelineReset(Action reset)
            {
            }
        }

        private static HeardSnapshot Saved() => new HeardSnapshot(new[] { Knows(Home, 0.7), Knows(Crewed, 0.4) });

        private static HeardAtCentre Knows(string centre, double strength) => new HeardAtCentre(
            centre,
            new[] { CraftState.Orbiting(Probe, 100.0, Kerbin, Orbit, null, null, true, new Dictionary<string, CraftLink>()) },
            new Dictionary<string, bool> { [Probe] = true },
            new[] { new ContactRadio(Probe, true, strength, new CommsDegrade { ModelId = "m" }) { CapturedUt = 100.0 } });

        private static double? StrengthAt(CentreHearing hearing, string centre) => hearing.RadioAt(centre, Probe)?.Strength;

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
    }
}

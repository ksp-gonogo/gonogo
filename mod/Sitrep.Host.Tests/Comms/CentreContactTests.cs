using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// Whether a command centre can hear a craft, and what the centre knows of
    /// that from the word that has reached it.
    /// </summary>
    public class CentreContactTests
    {
        private const string Home = "ground:home";
        private const string Far = "ground:far";
        private const string Crewed = "vessel:crewed";
        private const string Craft = "vessel:probe";

        private static readonly OrbitElements Orbit = new OrbitElements(700_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 3.5316e12);

        private static bool Reaches(
            string centre,
            string vesselId = "probe",
            bool modelled = true,
            bool connected = true,
            bool offTheGround = false,
            bool unroutable = false) =>
            CentreReach.Reaches(centre, vesselId, modelled, connected, Home, offTheGround, unroutable);

        private static CraftState Heard(double ut) =>
            CraftState.Orbiting(Craft, ut, 0, Orbit, null, null, true, new Dictionary<string, CraftLink>());

        private static CraftReach Reach(double ut, params (string Centre, double LastUt)[] rows)
        {
            var last = new Dictionary<string, double>();
            foreach (var (centre, lastUt) in rows)
            {
                last[centre] = lastUt;
            }
            return new CraftReach(Craft, ut, last);
        }

        [Fact]
        public void ACentreHearsACraftItsOwnRouteReaches()
        {
            Assert.True(Reaches(Far));
            Assert.False(Reaches(Far, unroutable: true));
        }

        [Fact]
        public void NoCentreHearsACraftWhoseLinkIsDown()
        {
            Assert.False(Reaches(Home, connected: false));
            Assert.False(Reaches(Far, connected: false));
        }

        /// <summary>Every ground station is the home centre's antenna, so home hears exactly the craft whose route ends at one.</summary>
        [Fact]
        public void TheHomeCentreHearsACraftWhoseRouteEndsAtAnyGroundStation()
        {
            Assert.True(Reaches(Home, unroutable: true));
            Assert.False(Reaches(Home, offTheGround: true));
            Assert.True(Reaches(Far, offTheGround: true));
        }

        [Fact]
        public void ACrewedCentreAlwaysHearsItsOwnCraft()
        {
            Assert.True(Reaches(Crewed, vesselId: "crewed", connected: false, unroutable: true));
        }

        [Fact]
        public void InASaveWithNoCommsModelEveryCentreHearsEveryCraft()
        {
            Assert.True(Reaches(Far, modelled: false, connected: false, unroutable: true));
            Assert.True(Reaches(Home, modelled: false, connected: false, offTheGround: true));
        }

        private static CentreContact View(CentreContactState state, double? last) => new CentreContact(state, last);

        [Fact]
        public void SeveralViewsAreInContactWhenAnyIsAndSilentSinceTheLatestContactOtherwise()
        {
            var inContact = CentreContact.Consolidated(new[] { View(CentreContactState.Silent, 100.0), View(CentreContactState.InContact, 50.0) })!.Value;
            var silent = CentreContact.Consolidated(new[] { View(CentreContactState.Silent, 100.0), View(CentreContactState.Silent, 150.0), View(CentreContactState.Silent, null) })!.Value;

            Assert.Equal(CentreContactState.InContact, inContact.State);
            Assert.Equal(CentreContactState.Silent, silent.State);
            Assert.Equal(150.0, silent.LastContactUt);
            Assert.Null(CentreContact.Consolidated(new CentreContact[0]));
        }

        /// <summary>A craft one centre knows has gone does not come back because another centre's word of it is older.</summary>
        [Fact]
        public void AViewThatKnowsTheCraftIsGoneOutweighsOneStillInContact()
        {
            var views = new[] { View(CentreContactState.InContact, 300.0), View(CentreContactState.Gone, 250.0) };

            Assert.Equal(CentreContactState.Gone, CentreContact.Consolidated(views)!.Value.State);
        }

        [Fact]
        public void ACentreThatHasHeardNothingOfACraftKnowsNoContact()
        {
            Assert.Null(CentreContact.Of(Home, null, null, null));
        }

        [Fact]
        public void ACentreTheNewestWordSaysCanHearIsInContactAsOfTheNewestItHeard()
        {
            var contact = CentreContact.Of(Home, Heard(250.0), Heard(250.0), Reach(200.0, (Home, 200.0)))!.Value;

            Assert.Equal(CentreContactState.InContact, contact.State);
            Assert.Equal(250.0, contact.LastContactUt);
        }

        [Fact]
        public void ACentreTheNewestWordSaysHasLostItsRouteIsSilentSinceItLastHadOne()
        {
            var contact = CentreContact.Of(Far, Heard(250.0), Heard(250.0), Reach(300.0, (Home, 300.0), (Far, 299.0)))!.Value;

            Assert.Equal(CentreContactState.Silent, contact.State);
            Assert.Equal(299.0, contact.LastContactUt);
        }

        /// <summary>A craft with no radio is heard of at once and never heard from, so it is silent and has no last contact.</summary>
        [Fact]
        public void ACraftNoWordOfAnyRouteHasReachedIsSilentWithNoLastContact()
        {
            var contact = CentreContact.Of(Home, Heard(250.0), Heard(250.0), null)!.Value;

            Assert.Equal(CentreContactState.Silent, contact.State);
            Assert.Null(contact.LastContactUt);
        }

        [Fact]
        public void ACraftTheCentreKnowsIsGoneIsGoneHoweverItCameToKnow()
        {
            var heardGone = CentreContact.Of(Home, CraftState.Gone(Craft, 400.0), CraftState.Gone(Craft, 400.0), Reach(300.0, (Home, 300.0)))!.Value;
            var seenGone = CentreContact.Of(Home, CraftState.Gone(Craft, 400.0), Heard(250.0), Reach(300.0, (Home, 299.0)))!.Value;

            Assert.Equal(CentreContactState.Gone, heardGone.State);
            Assert.Equal(CentreContactState.Gone, seenGone.State);
            Assert.Equal(299.0, seenGone.LastContactUt);
        }
    }
}

using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class CentreRosterTests
    {
        private static CommandCentreEntry Entry(string id, string name = "n") => new CommandCentreEntry { Id = id, DisplayName = name, Active = true };

        private static readonly CommandCentreEntry[] Game = { Entry("ground:ksc"), Entry("ground:forward"), Entry("vessel:a"), Entry("vessel:b") };

        private static CraftState Heard(string id, double ut, CommandCentreEntry? centre) =>
            CraftState.WithoutARadio(id, ut, null).AsCentre(centre);

        private static string[] Ids(string centre, params CraftState[] heard) =>
            CentreRoster.For(centre, Game, heard).Select(e => e.Id!).ToArray();

        [Fact]
        public void ACentreThatHasHeardNothingListsTheFixedCentresAndNoCraft()
        {
            Assert.Equal(new[] { "ground:ksc", "ground:forward" }, Ids("ground:ksc"));
        }

        [Fact]
        public void ACraftIsListedOnceItsOwnWordThatItIsACentreHasBeenHeard()
        {
            Assert.Equal(
                new[] { "ground:ksc", "ground:forward", "vessel:a" },
                Ids("ground:ksc", Heard("vessel:a", 1.0, Entry("vessel:a")), Heard("vessel:b", 1.0, null)));
        }

        [Fact]
        public void ACraftIsListedAsItWasHeardAndNotAsTheGameHasItNow()
        {
            var roster = CentreRoster.For("ground:ksc", Game, new[] { Heard("vessel:a", 1.0, Entry("vessel:a", "old name")) });

            Assert.Equal("old name", roster.Single(e => e.Id == "vessel:a").DisplayName);
        }

        [Fact]
        public void ACentreAlwaysListsItself()
        {
            Assert.Equal(new[] { "ground:ksc", "ground:forward", "vessel:b" }, Ids("vessel:b"));
        }

        [Fact]
        public void ACraftTheGameNoLongerListsStaysUntilItsWordArrives()
        {
            var gone = Entry("vessel:gone");

            Assert.Contains("vessel:gone", Ids("ground:ksc", Heard("vessel:gone", 1.0, gone)));
            Assert.DoesNotContain("vessel:gone", Ids("ground:ksc", CraftState.Gone("vessel:gone", 2.0)));
            Assert.DoesNotContain("vessel:gone", Ids("ground:ksc", Heard("vessel:gone", 2.0, null)));
        }

        /// <summary>
        /// Everything the contact plan source declares it sends addressed, and
        /// says so on the declaration, which is what the generated table of
        /// delay roles lists these channels from.
        /// </summary>
        [Fact]
        public void EveryChannelThePlanSourceDeclaresSaysItIsAddressed()
        {
            var channels = ContactPlanSource.Channels();

            Assert.Contains(channels, c => c.Topic == ContactPlanSource.RosterTopic);
            Assert.All(channels, c => Assert.True(c.Addressed, c.Topic + " is sent addressed and does not declare it"));
        }

        [Fact]
        public void TwoRostersThatReadTheSameAreTheSame()
        {
            Assert.True(CentreRoster.Same(new[] { Entry("ground:ksc") }, new[] { Entry("ground:ksc") }));
            Assert.False(CentreRoster.Same(new[] { Entry("ground:ksc") }, new[] { Entry("ground:ksc", "renamed") }));
            Assert.False(CentreRoster.Same(new[] { Entry("ground:ksc") }, new[] { Entry("ground:ksc"), Entry("vessel:a") }));
        }
    }
}

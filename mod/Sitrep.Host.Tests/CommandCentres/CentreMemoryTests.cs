using System;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.Tests.CommandCentres
{
    public class CentreMemoryTests
    {
        private static System.Collections.Generic.ISet<string> Ids(params string[] ids) =>
            new System.Collections.Generic.HashSet<string>(ids, StringComparer.Ordinal);

        [Fact]
        public void ACentreStillListedIsNotUnreachable()
        {
            var memory = new CentreMemory();
            memory.Observe(new[] { new FakeCommandCentre("ground:A") }, 100);

            Assert.Empty(memory.Unreachable(Ids("ground:A")));
        }

        [Fact]
        public void ACentreThatLeftIsNamedAndStampedWithTheLastPassThatSawIt()
        {
            var memory = new CentreMemory();
            var a = new FakeCommandCentre("ground:A");
            memory.Observe(new[] { a }, 100);
            memory.Observe(new[] { a }, 250);
            memory.Observe(new Sitrep.Contract.ICommandCentre[0], 300);

            var gone = Assert.Single(memory.Unreachable(Ids()));
            Assert.Equal("ground:A", gone.Id);
            Assert.Equal("ground:A", gone.DisplayName);
            Assert.Equal("GroundStation", gone.Kind);
            Assert.Equal(250, gone.LastReachableUt);
        }

        [Fact]
        public void ACentreThatReturnsLeavesTheList()
        {
            var memory = new CentreMemory();
            var a = new FakeCommandCentre("ground:A");
            memory.Observe(new[] { a }, 100);
            Assert.Single(memory.Unreachable(Ids()));

            memory.Observe(new[] { a }, 400);
            Assert.Empty(memory.Unreachable(Ids("ground:A")));
        }

        [Fact]
        public void ACentreNeverSeenIsNotListed()
        {
            Assert.Empty(new CentreMemory().Unreachable(Ids()));
        }

        [Fact]
        public void TheOldestDeparturesAreForgottenPastCapacity()
        {
            var memory = new CentreMemory();
            for (var i = 0; i < CentreMemory.Capacity + 5; i++)
            {
                memory.Observe(new[] { new FakeCommandCentre("vessel:" + i.ToString("D4")) }, i);
            }

            var kept = memory.Unreachable(Ids());
            Assert.Equal(CentreMemory.Capacity, kept.Count);
            Assert.DoesNotContain(kept, e => e.Id == "vessel:0000");
            Assert.Contains(kept, e => e.Id == "vessel:" + (CentreMemory.Capacity + 4).ToString("D4"));
        }
    }
}

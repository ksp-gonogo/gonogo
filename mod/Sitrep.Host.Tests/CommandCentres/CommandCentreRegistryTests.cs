using System.Linq;
using Sitrep.Host.CommandCentres;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Host.Tests.CommandCentres
{
    public class CommandCentreRegistryTests
    {
        [Fact]
        public void EnumerateActive_FlattensSources_FiltersInactive_DedupesById()
        {
            var reg = new CommandCentreRegistry();
            reg.RegisterSource(new FakeCommandCentreSource(
                "a",
                new FakeCommandCentre("ksc", active: true),
                new FakeCommandCentre("gs1", active: false)));
            reg.RegisterSource(new FakeCommandCentreSource(
                "b",
                new FakeCommandCentre("ksc", active: true))); // duplicate id, second source

            var active = reg.EnumerateActive();

            Assert.Equal(new[] { "ksc" }, active.Select(c => c.Id).ToArray());
        }

        [Fact]
        public void EnumerateListeners_AreNeverActiveCentres_AndAnActiveCentreIsNotAlsoAListener()
        {
            var reg = new CommandCentreRegistry();
            reg.RegisterSource(new FakeCommandCentreSource("a", new FakeCommandCentre("vessel:crewed-control", CommandCentreKind.CrewedVessel)));
            reg.RegisterListenerSource(new FakeCommandCentreSource(
                "listeners",
                new FakeCommandCentre("vessel:crewed-control", CommandCentreKind.CrewedVessel),
                new FakeCommandCentre("vessel:pod", CommandCentreKind.CrewedVessel, active: false),
                new FakeCommandCentre("vessel:pod", CommandCentreKind.CrewedVessel, active: false)));

            Assert.Equal(new[] { "vessel:crewed-control" }, reg.EnumerateActive().Select(c => c.Id).ToArray());
            Assert.Equal(new[] { "vessel:pod" }, reg.EnumerateListeners().Select(c => c.Id).ToArray());
        }

        [Fact]
        public void ADuplicateId_IsRecordedAndReported_NotDroppedQuietly()
        {
            var reports = new System.Collections.Generic.List<string>();
            var reg = new CommandCentreRegistry(reports.Add);
            reg.RegisterSource(new FakeCommandCentreSource(
                "stock-home",
                new FakeCommandCentre("ksc"),
                new FakeCommandCentre("ksc"),
                new FakeCommandCentre("ground:A")));

            var active = reg.EnumerateActive();

            Assert.Equal(new[] { "ksc", "ground:A" }, active.Select(c => c.Id).ToArray());
            var collision = Assert.Single(reg.Collisions);
            Assert.Equal("ksc", collision.Id);
            Assert.Equal("stock-home", collision.KeptProviderId);
            Assert.Equal("stock-home", collision.DroppedProviderId);
            var report = Assert.Single(reports);
            Assert.Contains("\"ksc\"", report);
        }

        [Fact]
        public void ACollision_IsReportedOncePerId_ButRecordedEveryPass_AndClearsWhenItStops()
        {
            var reports = new System.Collections.Generic.List<string>();
            var source = new MutableSource("stock-home")
            {
                Centres = new ICommandCentre[] { new FakeCommandCentre("ksc"), new FakeCommandCentre("ksc") },
            };
            var reg = new CommandCentreRegistry(reports.Add);
            reg.RegisterSource(source);

            reg.EnumerateActive();
            reg.EnumerateActive();

            Assert.Single(reports);
            Assert.Single(reg.Collisions);

            source.Centres = new ICommandCentre[] { new FakeCommandCentre("ksc") };
            reg.EnumerateActive();

            Assert.Empty(reg.Collisions);
        }

        [Fact]
        public void AnInactiveDuplicate_IsNotACollision()
        {
            var reports = new System.Collections.Generic.List<string>();
            var reg = new CommandCentreRegistry(reports.Add);
            reg.RegisterSource(new FakeCommandCentreSource(
                "a",
                new FakeCommandCentre("ksc"),
                new FakeCommandCentre("ksc", active: false)));

            reg.EnumerateActive();

            Assert.Empty(reg.Collisions);
            Assert.Empty(reports);
        }

        [Fact]
        public void EnumerateActive_ReflectsLiveSourceChanges_EachCall()
        {
            var mutable = new MutableSource("dyn");
            var reg = new CommandCentreRegistry();
            reg.RegisterSource(mutable);

            Assert.Empty(reg.EnumerateActive());

            mutable.Centres = new ICommandCentre[] { new FakeCommandCentre("vessel:g1", CommandCentreKind.CrewedVessel) };
            Assert.Equal(new[] { "vessel:g1" }, reg.EnumerateActive().Select(c => c.Id).ToArray());
        }

        [Fact]
        public void ASeatIsNotACentre_NeverInEnumerateActive_AndAppearsOnlyInEnumerateSeats()
        {
            var reg = new CommandCentreRegistry();
            reg.RegisterSource(new FakeCommandCentreSource("a", new FakeCommandCentre("ksc")));
            reg.RegisterSeatSource(new FakeCommandCentreSource(
                "seat", new FakeCommandCentre("vessel:g1", CommandCentreKind.CrewedVessel)));

            Assert.Equal(new[] { "ksc" }, reg.EnumerateActive().Select(c => c.Id).ToArray());
            Assert.Equal(new[] { "vessel:g1" }, reg.EnumerateSeats().Select(c => c.Id).ToArray());
        }

        [Fact]
        public void ACraftThatIsAlreadyACentre_IsNotAlsoASeat()
        {
            var reg = new CommandCentreRegistry();
            reg.RegisterSource(new FakeCommandCentreSource(
                "a", new FakeCommandCentre("vessel:g1", CommandCentreKind.CrewedVessel)));
            reg.RegisterSeatSource(new FakeCommandCentreSource(
                "seat", new FakeCommandCentre("vessel:g1", CommandCentreKind.CrewedVessel)));

            Assert.Empty(reg.EnumerateSeats());
            Assert.Empty(reg.Collisions);
        }

        [Fact]
        public void ASeatThatIsNotActiveNow_IsNotOffered_AndTheSetFollowsTheSourceEachCall()
        {
            var mutable = new MutableSource("seat");
            var reg = new CommandCentreRegistry();
            reg.RegisterSeatSource(mutable);

            Assert.Empty(reg.EnumerateSeats());

            mutable.Centres = new ICommandCentre[] { new FakeCommandCentre("vessel:g1", CommandCentreKind.CrewedVessel) };
            Assert.Equal(new[] { "vessel:g1" }, reg.EnumerateSeats().Select(c => c.Id).ToArray());

            mutable.Centres = new ICommandCentre[] { new FakeCommandCentre("vessel:g1", CommandCentreKind.CrewedVessel, active: false) };
            Assert.Empty(reg.EnumerateSeats());
        }

        [Fact]
        public void FirstSeatId_NamesTheCraftEvenWhenItIsAlreadyACentre_AndIsNullWithNoSeat()
        {
            var reg = new CommandCentreRegistry();
            var seats = new MutableSource("seat");
            reg.RegisterSource(new FakeCommandCentreSource(
                "a", new FakeCommandCentre("vessel:g1", CommandCentreKind.CrewedVessel)));
            reg.RegisterSeatSource(seats);

            Assert.Null(reg.FirstSeatId());

            seats.Centres = new ICommandCentre[] { new FakeCommandCentre("vessel:g1", CommandCentreKind.CrewedVessel) };
            Assert.Equal("vessel:g1", reg.FirstSeatId());
            Assert.Empty(reg.EnumerateSeats());
        }

        private sealed class MutableSource : ICommandCentreSource
        {
            public MutableSource(string id) => ProviderId = id;
            public string ProviderId { get; }
            public ICommandCentre[] Centres { get; set; } = System.Array.Empty<ICommandCentre>();
            public System.Collections.Generic.IEnumerable<ICommandCentre> Enumerate() => Centres;
        }
    }
}

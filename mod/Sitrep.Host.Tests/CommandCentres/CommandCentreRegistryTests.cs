using System.Linq;
using Sitrep.Host.CommandCentres;
using Xunit;

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
        public void EnumerateActive_ReflectsLiveSourceChanges_EachCall()
        {
            var mutable = new MutableSource("dyn");
            var reg = new CommandCentreRegistry();
            reg.RegisterSource(mutable);

            Assert.Empty(reg.EnumerateActive());

            mutable.Centres = new ICommandCentre[] { new FakeCommandCentre("vessel:g1", CommandCentreKind.CrewedVessel) };
            Assert.Equal(new[] { "vessel:g1" }, reg.EnumerateActive().Select(c => c.Id).ToArray());
        }

        private sealed class MutableSource : ICommandCentreSource
        {
            public MutableSource(string id) => SourceId = id;
            public string SourceId { get; }
            public ICommandCentre[] Centres { get; set; } = System.Array.Empty<ICommandCentre>();
            public System.Collections.Generic.IEnumerable<ICommandCentre> Enumerate() => Centres;
        }
    }
}

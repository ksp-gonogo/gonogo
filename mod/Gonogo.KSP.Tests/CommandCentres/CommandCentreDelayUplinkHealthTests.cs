using System.Collections.Generic;
using Gonogo.KSP.CommandCentres;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Gonogo.KSP.Tests.CommandCentres
{
    /// <summary>
    /// A centre the registry drops for a duplicate id is a hole in the roster and in
    /// the delay ledger, so the uplink that builds both says so on its health.
    /// </summary>
    public class CommandCentreDelayUplinkHealthTests
    {
        [Fact]
        public void HealthyWhileEveryIdIsDistinct()
        {
            var registry = RegistryOf("ksc", "ground:A");
            registry.EnumerateActive();

            Assert.Equal(UplinkHealthState.Healthy, new CommandCentreDelayUplink(registry).Health().State);
        }

        [Fact]
        public void DegradedWithTheCollidingIdAsAFact_WhileACentreIsDropped()
        {
            var registry = RegistryOf("ksc", "ksc");
            registry.EnumerateActive();

            var health = new CommandCentreDelayUplink(registry).Health();

            Assert.Equal(UplinkHealthState.Degraded, health.State);
            var fact = Assert.Single(health.Facts);
            Assert.Equal("ksc", fact.Label);
        }

        private static CommandCentreRegistry RegistryOf(params string[] ids)
        {
            var registry = new CommandCentreRegistry();
            registry.RegisterSource(new Source(ids));
            return registry;
        }

        private sealed class Source : ICommandCentreSource
        {
            private readonly string[] _ids;

            public Source(string[] ids) => _ids = ids;

            public string ProviderId => "stock-home";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                foreach (var id in _ids)
                {
                    yield return new Centre(id);
                }
            }
        }

        private sealed class Centre : ICommandCentre
        {
            public Centre(string id) => Id = id;

            public string Id { get; }
            public string DisplayName => Id;
            public CommandCentreKind Kind => CommandCentreKind.GroundStation;
            public int? BodyIndex => null;
            public bool IsActiveNow() => true;
        }
    }
}

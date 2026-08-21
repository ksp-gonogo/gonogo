using System.Collections.Generic;
using System.Linq;
using Sitrep.Host.CommandCentres;
using Sitrep.Contract;

namespace Sitrep.Host.Tests.CommandCentres
{
    /// <summary>
    /// Shared KSP-free test doubles for the command-centre layer. The real
    /// centres are produced by the KSP-layer sources (StockHomeNodeSource,
    /// CrewedVesselSource); these fakes let the Sitrep.Host-side registry and
    /// authority-iteration logic be exercised without any KSP dependency.
    /// </summary>
    public sealed class FakeCommandCentre : ICommandCentre
    {
        private readonly bool _active;

        public FakeCommandCentre(
            string id,
            CommandCentreKind kind = CommandCentreKind.GroundStation,
            bool active = true,
            int? bodyIndex = null)
        {
            Id = id;
            Kind = kind;
            _active = active;
            BodyIndex = bodyIndex;
        }

        public string Id { get; }
        public string DisplayName => Id;
        public CommandCentreKind Kind { get; }
        public int? BodyIndex { get; }
        public bool IsActiveNow() => _active;
    }

    public sealed class FakeCommandCentreSource : ICommandCentreSource
    {
        private readonly ICommandCentre[] _centres;

        public FakeCommandCentreSource(string sourceId, params ICommandCentre[] centres)
        {
            ProviderId = sourceId;
            _centres = centres;
        }

        public string ProviderId { get; }
        public IEnumerable<ICommandCentre> Enumerate() => _centres;
    }
}

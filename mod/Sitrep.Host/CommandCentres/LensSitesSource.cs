using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>A ground station's roster id beside the name of its network node.</summary>
    public readonly struct NamedGroundStation
    {
        public NamedGroundStation(string id, string? nodeName)
        {
            Id = id;
            NodeName = nodeName;
        }

        public string Id { get; }

        public string? NodeName { get; }
    }

    /// <summary>
    /// The <c>lensSites</c> capability's provider: station lookup by node name
    /// over the live ground stations, and lens delivery on the engine's own
    /// frontiers.
    /// </summary>
    public sealed class LensSitesSource : ILensSites
    {
        private readonly ChannelEngine _engine;
        private readonly Func<IEnumerable<NamedGroundStation>> _stations;

        /// <param name="engine">The engine whose courier advances each scope's delivered knowledge.</param>
        /// <param name="stations">The active ground stations, read on the main thread.</param>
        public LensSitesSource(ChannelEngine engine, Func<IEnumerable<NamedGroundStation>> stations)
        {
            _engine = engine ?? throw new ArgumentNullException(nameof(engine));
            _stations = stations ?? throw new ArgumentNullException(nameof(stations));
        }

        public string ProviderId => "gonogo-lens-sites";

        public string? GroundStationNamed(string nodeName) => StationNamed(_stations(), nodeName);

        public void Bind(string scope, string site, string commandingCentre) =>
            _engine.BindLensSite(scope, site, commandingCentre);

        public void Unbind(string scope, string site) => _engine.UnbindLensSite(scope, site);

        public double? KnowledgeUt(string scope) => _engine.LensKnowledgeUt(scope);

        /// <summary>The id of the one station named <paramref name="nodeName"/>, or null for none or several.</summary>
        public static string? StationNamed(IEnumerable<NamedGroundStation> stations, string nodeName)
        {
            if (string.IsNullOrEmpty(nodeName))
            {
                return null;
            }
            string? found = null;
            foreach (var station in stations)
            {
                if (!string.Equals(station.NodeName, nodeName, StringComparison.Ordinal))
                {
                    continue;
                }
                if (found != null)
                {
                    return null;
                }
                found = station.Id;
            }
            return found;
        }
    }
}

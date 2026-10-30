using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>A ground station's roster id beside the name of its network node.</summary>
    public readonly struct NamedGroundStation
    {
        public NamedGroundStation(string id, string? nodeName, int? bodyIndex = null, double? latitude = null, double? longitude = null)
        {
            Id = id;
            NodeName = nodeName;
            BodyIndex = bodyIndex;
            Latitude = latitude;
            Longitude = longitude;
        }

        public string Id { get; }

        public string? NodeName { get; }

        /// <summary>The body the station stands on, or null when it is not known.</summary>
        public int? BodyIndex { get; }

        /// <summary>Body-fixed latitude in degrees, null with <see cref="BodyIndex"/>.</summary>
        public double? Latitude { get; }

        /// <summary>Body-fixed longitude in degrees, null with <see cref="BodyIndex"/>.</summary>
        public double? Longitude { get; }
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

        public string? GroundStationNear(int bodyIndex, double latitude, double longitude) =>
            StationNear(_stations(), bodyIndex, latitude, longitude);

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

        /// <summary>
        /// The id of the station nearest the point along the body's surface, or null
        /// for none on that body or for two equally near.
        /// </summary>
        public static string? StationNear(IEnumerable<NamedGroundStation> stations, int bodyIndex, double latitude, double longitude)
        {
            string? best = null;
            var bestAngle = double.MaxValue;
            var tied = false;
            foreach (var station in stations)
            {
                if (station.BodyIndex != bodyIndex || station.Latitude is not double lat || station.Longitude is not double lon)
                {
                    continue;
                }
                var angle = SurfaceAngle(latitude, longitude, lat, lon);
                if (angle < bestAngle - TieRadians)
                {
                    best = station.Id;
                    bestAngle = angle;
                    tied = false;
                    continue;
                }
                if (angle <= bestAngle + TieRadians)
                {
                    tied = true;
                    bestAngle = Math.Min(bestAngle, angle);
                }
            }
            return tied ? null : best;
        }

        /* Two stations closer in range than this to the same point are the same distance away for any purpose a lens has. */
        private const double TieRadians = 1e-9;

        private static double SurfaceAngle(double latA, double lonA, double latB, double lonB)
        {
            const double ToRadians = Math.PI / 180.0;
            var a = latA * ToRadians;
            var b = latB * ToRadians;
            var dLon = (lonB - lonA) * ToRadians;
            var cos = Math.Sin(a) * Math.Sin(b) + Math.Cos(a) * Math.Cos(b) * Math.Cos(dLon);
            return Math.Acos(Math.Max(-1.0, Math.Min(1.0, cos)));
        }
    }
}

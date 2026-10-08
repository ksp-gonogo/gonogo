using System;

namespace Sitrep.Host.CommandCentres
{
    /// <summary>
    /// A point on a body's surface. Distance between two is an angle, which
    /// needs no body radius and so compares the same on Kerbin and on an
    /// Earth-sized home world.
    /// </summary>
    public readonly struct SurfaceSite
    {
        public SurfaceSite(double latitude, double longitude)
        {
            Latitude = latitude;
            Longitude = longitude;
        }

        /// <summary>Degrees north.</summary>
        public double Latitude { get; }

        /// <summary>Degrees east.</summary>
        public double Longitude { get; }

        /// <summary>The great-circle angle between this site and <paramref name="other"/>, in degrees.</summary>
        public double AngleTo(SurfaceSite other)
        {
            var lat1 = Latitude * Math.PI / 180.0;
            var lat2 = other.Latitude * Math.PI / 180.0;
            var dLat = lat2 - lat1;
            var dLon = (other.Longitude - Longitude) * Math.PI / 180.0;
            var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
                + Math.Cos(lat1) * Math.Cos(lat2) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
            return 2.0 * Math.Asin(Math.Min(1.0, Math.Sqrt(a))) * 180.0 / Math.PI;
        }
    }

    /// <summary>An active ground station's id and, when its body is readable, where it stands.</summary>
    public readonly struct GroundSite
    {
        public GroundSite(string id, SurfaceSite? site)
        {
            Id = id;
            Site = site;
        }

        public string Id { get; }

        public SurfaceSite? Site { get; }
    }
}

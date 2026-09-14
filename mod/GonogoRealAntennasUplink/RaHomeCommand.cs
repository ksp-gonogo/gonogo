using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// Where KSP's space centre stands: the index into system.bodies of the body it
    /// sits on, and its body-fixed position there in degrees.
    /// </summary>
    public readonly struct SpaceCentreFix
    {
        public SpaceCentreFix(int bodyIndex, double latitude, double longitude)
        {
            BodyIndex = bodyIndex;
            Latitude = latitude;
            Longitude = longitude;
        }

        public int BodyIndex { get; }

        public double Latitude { get; }

        public double Longitude { get; }
    }

    /// <summary>
    /// The RealAntennas home-command claimant: home is the ground station nearest
    /// KSP's space centre, on the space centre's own body.
    ///
    /// <para>RealAntennas replaces every stock ground station with its own and marks
    /// them all as home for comms, so no flag on a station says which one holds the
    /// career ledger. The space centre survives the replacement, and every planet pack
    /// rebuilds a station beside it: Kerbal Space Center on stock, Gael Space Center on
    /// GPP, US - Cape Canaveral on RSS.</para>
    ///
    /// <para>Registered only while RealAntennas is loaded, at <see cref="Priority"/>,
    /// below a career overhaul's claimant, which knows which centre holds the ledger
    /// rather than inferring it from where stations stand.</para>
    /// </summary>
    public sealed class RaHomeCommandProvider : IHomeCommandProvider
    {
        public const string Id = "realantennas";

        /// <summary>Strictly below a career overhaul's claimant, and never <c>IsDefault</c>, as <see cref="HomeCommandCapability"/> requires of two claimants installed together.</summary>
        public const double Priority = 10.0;

        private readonly Func<SpaceCentreFix?> _spaceCentre;

        /// <param name="spaceCentre">
        /// Where the space centre stands, or null when it has never been readable.
        /// Called from <see cref="Identify"/>, so on the main thread only.
        /// </param>
        public RaHomeCommandProvider(Func<SpaceCentreFix?> spaceCentre) =>
            _spaceCentre = spaceCentre ?? throw new ArgumentNullException(nameof(spaceCentre));

        public string ProviderId => Id;

        /// <summary>The kernel registration for this claimant, the one the Uplink makes.</summary>
        public static ProviderRegistration Registration(Func<SpaceCentreFix?> spaceCentre) =>
            new ProviderRegistration
            {
                Capability = HomeCommandCapability.Id,
                Id = Id,
                Priority = Priority,
                Factory = _ => new RaHomeCommandProvider(spaceCentre),
            };

        /// <summary>
        /// The nearest ground station's id, or <see cref="HomeCommand.NotIdentified"/>
        /// when the space centre has never been readable or no ground station with a
        /// known position stands on its body.
        /// </summary>
        public HomeCommand Identify(IReadOnlyList<ICommandCentre> activeCentres)
        {
            var spaceCentre = _spaceCentre();
            if (spaceCentre == null || activeCentres == null)
            {
                return HomeCommand.NotIdentified;
            }

            var nearest = Nearest(spaceCentre.Value, activeCentres);
            return nearest == null ? HomeCommand.NotIdentified : HomeCommand.Identified(nearest);
        }

        /// <summary>
        /// The id of the ground station on <paramref name="spaceCentre"/>'s body at the
        /// smallest great-circle distance from it, or null when there is none.
        ///
        /// <para>Ranked by central angle, the distance on the body's sphere divided by
        /// its radius, so no radius is needed to compare two stations on one body.
        /// Altitude is ignored: a station's height above the surface does not move it
        /// nearer the space centre in any sense that bears on where the ledger is.</para>
        ///
        /// <para>Two stations exactly as far are decided by the ordinally smaller id,
        /// so the answer does not depend on the order the scene lists them in.</para>
        /// </summary>
        public static string? Nearest(SpaceCentreFix spaceCentre, IReadOnlyList<ICommandCentre> centres)
        {
            string? bestId = null;
            var bestAngle = double.PositiveInfinity;
            foreach (var centre in centres)
            {
                if (centre == null
                    || centre.Kind != CommandCentreKind.GroundStation
                    || centre.BodyIndex != spaceCentre.BodyIndex
                    || centre.Latitude is not double latitude
                    || centre.Longitude is not double longitude)
                {
                    continue;
                }

                var angle = CentralAngle(spaceCentre.Latitude, spaceCentre.Longitude, latitude, longitude);
                if (double.IsNaN(angle))
                {
                    continue;
                }

                if (angle < bestAngle
                    || (angle == bestAngle && string.CompareOrdinal(centre.Id, bestId) < 0))
                {
                    bestAngle = angle;
                    bestId = centre.Id;
                }
            }

            return bestId;
        }

        /// <summary>
        /// The angle in radians between two points given in degrees, by the haversine
        /// formula, which stays accurate for the few-kilometre separations that decide
        /// this claimant where the spherical law of cosines loses them to rounding.
        /// </summary>
        internal static double CentralAngle(double latitude1, double longitude1, double latitude2, double longitude2)
        {
            const double radians = Math.PI / 180.0;
            var phi1 = latitude1 * radians;
            var phi2 = latitude2 * radians;
            var halfDeltaPhi = (phi2 - phi1) / 2.0;
            var halfDeltaLambda = (longitude2 - longitude1) * radians / 2.0;

            var sinPhi = Math.Sin(halfDeltaPhi);
            var sinLambda = Math.Sin(halfDeltaLambda);
            var h = (sinPhi * sinPhi) + (Math.Cos(phi1) * Math.Cos(phi2) * sinLambda * sinLambda);
            return 2.0 * Math.Asin(Math.Sqrt(Math.Min(1.0, h)));
        }
    }
}

using UnityEngine;

namespace Gonogo.KSP.CommandCentres
{
    /// <summary>
    /// Body-fixed surface coordinates for a command centre, in DEGREES, for
    /// <c>CommandCentreEntry.Latitude</c>/<c>Longitude</c>.
    ///
    /// <para><b>Body-fixed, not inertial.</b> The roster declares where a centre
    /// sits on its body, which is <c>GetLongitude(world)</c> raw.
    /// <see cref="SilenceTracking.KspVisibilityGeometryFactory"/> adds
    /// <c>body.rotationAngle</c> plus a measured per-body offset to the same call,
    /// but that converts into the propagation frame and belongs only there: see
    /// <see cref="SilenceTracking.StationLongitudeCalibration"/> for what guessing
    /// that constant cost. Nothing here needs it, and adding it would move every
    /// station on the map.</para>
    ///
    /// <para><b>Degrees.</b> <c>CelestialBody.GetLatitude</c>/<c>GetLongitude</c>
    /// return degrees: <c>KspHost.PredictImpact</c> subtracts a <c>360/rotationPeriod</c>
    /// rate straight from <c>GetLongitude</c>'s result, which only holds in degrees.
    /// The contract carries <c>[SitrepUnit(Units.Degrees)]</c>, so no conversion
    /// happens anywhere downstream and none may be introduced here.</para>
    /// </summary>
    internal static class SurfaceCoordinates
    {
        /// <summary>
        /// The centre's body-fixed coordinates, or <c>false</c> when the body is
        /// unknown or the conversion does not produce two real numbers.
        ///
        /// <para>Failing here is NOT the same statement as a moving vessel centre
        /// having no surface position. A caller that is surface-anchored and gets
        /// <c>false</c> has an unknown body, which the entry already reports as a
        /// null <c>BodyIndex</c>, so the two nulls travel together and a null
        /// coordinate beside a known body cannot occur.</para>
        /// </summary>
        internal static bool TryFrom(CelestialBody? body, Vector3d world, out double latitudeDeg, out double longitudeDeg)
        {
            latitudeDeg = 0.0;
            longitudeDeg = 0.0;
            if (body == null)
            {
                return false;
            }

            var latitude = body.GetLatitude(world);
            var longitude = NormaliseLongitudeDeg(body.GetLongitude(world));
            if (!IsReal(latitude) || !IsReal(longitude))
            {
                return false;
            }

            latitudeDeg = latitude;
            longitudeDeg = longitude;
            return true;
        }

        /// <summary>
        /// Longitude wrapped into (-180, 180], the convention every geographic
        /// value already on the wire uses (<c>vessel.longitude</c> arrives that way
        /// from stock, and <c>KspHost.PredictImpact</c> wraps its own samples to
        /// match). <c>GetLongitude</c> can return outside that range, and a roster
        /// marker plotted against a vessel groundtrack has to share its frame or it
        /// lands half a world out.
        /// </summary>
        internal static double NormaliseLongitudeDeg(double raw)
        {
            if (!IsReal(raw))
            {
                return raw;
            }

            var wrapped = ((raw % 360.0) + 360.0) % 360.0;
            return wrapped > 180.0 ? wrapped - 360.0 : wrapped;
        }

        private static bool IsReal(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
    }
}

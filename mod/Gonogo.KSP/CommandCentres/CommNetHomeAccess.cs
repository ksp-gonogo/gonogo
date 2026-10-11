using System;
using System.Reflection;
using CommNet;

namespace Gonogo.KSP.CommandCentres
{
    /// <summary>
    /// Reads the <see cref="CommNetHome"/> members a command-centre source needs
    /// that stock keeps protected: the node's <c>comm</c> (<see cref="CommNode"/>), the
    /// <c>body</c> it sits on, and the body-fixed <c>lat</c>/<c>lon</c> the node's
    /// position is built from. All are protected instance fields with no public
    /// accessor of any kind, so reflection is the only route that does not require
    /// publicising the KSP assembly. The <see cref="FieldInfo"/> handles are resolved
    /// once and cached; a moved or renamed field degrades to null rather than throwing,
    /// so a source built on this simply reports no centres.
    ///
    /// All of them are declared on <see cref="CommNetHome"/> itself, so the lookup also
    /// covers subclasses (stock's Extra Ground Stations, Kerbal Konstructs sites).
    /// </summary>
    internal static class CommNetHomeAccess
    {
        private static readonly FieldInfo? CommField = typeof(CommNetHome).GetField(
            "comm", BindingFlags.NonPublic | BindingFlags.Instance);

        private static readonly FieldInfo? BodyField = typeof(CommNetHome).GetField(
            "body", BindingFlags.NonPublic | BindingFlags.Instance);

        private static readonly FieldInfo? LatitudeField = typeof(CommNetHome).GetField(
            "lat", BindingFlags.NonPublic | BindingFlags.Instance);

        private static readonly FieldInfo? LongitudeField = typeof(CommNetHome).GetField(
            "lon", BindingFlags.NonPublic | BindingFlags.Instance);

        /// <summary>The home's CommNet node, or null when absent or unreadable.</summary>
        public static CommNode? Comm(CommNetHome home)
        {
            if (home == null || CommField == null)
            {
                return null;
            }

            try
            {
                return CommField.GetValue(home) as CommNode;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>The body the home sits on, or null when absent or unreadable.</summary>
        public static CelestialBody? Body(CommNetHome home)
        {
            if (home == null || BodyField == null)
            {
                return null;
            }

            try
            {
                return BodyField.GetValue(home) as CelestialBody;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// The home's body-fixed latitude and longitude in degrees, the pair stock
        /// builds the node's world position from, or null when either is
        /// unreadable.
        ///
        /// <para>Preferred to converting <c>CommNode.precisePosition</c> back,
        /// because that position is a world point stamped at the last CommNet
        /// update and the body keeps turning after it: under rails warp the
        /// conversion drifts by the rotation done since, which walks every
        /// station's longitude past every other's.</para>
        /// </summary>
        public static (double Latitude, double Longitude)? Coordinates(CommNetHome home)
        {
            if (home == null || LatitudeField == null || LongitudeField == null)
            {
                return null;
            }

            try
            {
                if (LatitudeField.GetValue(home) is double latitude && LongitudeField.GetValue(home) is double longitude)
                {
                    return (latitude, longitude);
                }
            }
            catch (Exception)
            {
            }

            return null;
        }
    }
}

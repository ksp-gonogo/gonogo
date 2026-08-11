using System;
using System.Reflection;
using CommNet;

namespace Gonogo.KSP.CommandCentres
{
    /// <summary>
    /// Reads the two <see cref="CommNetHome"/> members a command-centre source needs
    /// that stock keeps protected: the node's <c>comm</c> (<see cref="CommNode"/>) and
    /// the <c>body</c> it sits on. Both are protected instance FIELDS with no public
    /// accessor of any kind, so reflection is the only route that does not require
    /// publicising the KSP assembly. The <see cref="FieldInfo"/> handles are resolved
    /// once and cached; a moved or renamed field degrades to null rather than throwing,
    /// so a source built on this simply reports no centres.
    ///
    /// Both fields are declared on <see cref="CommNetHome"/> itself, so the lookup also
    /// covers subclasses (stock's Extra Ground Stations, Kerbal Konstructs sites).
    /// </summary>
    internal static class CommNetHomeAccess
    {
        private static readonly FieldInfo? CommField = typeof(CommNetHome).GetField(
            "comm", BindingFlags.NonPublic | BindingFlags.Instance);

        private static readonly FieldInfo? BodyField = typeof(CommNetHome).GetField(
            "body", BindingFlags.NonPublic | BindingFlags.Instance);

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
    }
}

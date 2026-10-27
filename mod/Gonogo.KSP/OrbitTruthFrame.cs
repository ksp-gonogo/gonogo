using System;

namespace Gonogo.KSP
{
    /// <summary>
    /// Takes a state vector KSP keeps on an <c>Orbit</c> into the fixed, non-rotating frame the
    /// orbital elements are defined against.
    /// </summary>
    internal static class OrbitTruthFrame
    {
        /*
         * Orbit.pos and Orbit.vel are stored as Planetarium.Zup.WorldToLocal of the fixed-frame
         * vector, and KSP only refreshes Zup (and InverseRotAngle) while a body is in its
         * inverse-rotation regime. After any low flight the angle stays frozen at its last value,
         * so the raw vectors are rotated about the pole by it even once inverse rotation is off.
         * LocalToWorld undoes that for whatever angle Zup holds.
         */
        public static double[] ToFixedFrame(Vector3d stored)
        {
            var fixedFrame = Planetarium.Zup.LocalToWorld(stored);
            return new[] { fixedFrame.x, fixedFrame.y, fixedFrame.z };
        }

        /// <summary>
        /// The orbit's state vector in the fixed frame, or null when it cannot be stated: the
        /// orbit has no reference body to be fixed against, or the stored vectors or the frame
        /// they are taken out of are not finite numbers.
        /// </summary>
        public static (double[] Position, double[] Velocity)? Read(bool hasReferenceBody, Vector3d storedPosition, Vector3d storedVelocity)
        {
            if (!hasReferenceBody)
            {
                return null;
            }
            var position = ToFixedFrame(storedPosition);
            var velocity = ToFixedFrame(storedVelocity);
            return IsFinite(position) && IsFinite(velocity) ? (position, velocity) : ((double[], double[])?)null;
        }

        private static bool IsFinite(double[] vector)
        {
            foreach (var component in vector)
            {
                if (double.IsNaN(component) || double.IsInfinity(component))
                {
                    return false;
                }
            }
            return true;
        }
    }
}

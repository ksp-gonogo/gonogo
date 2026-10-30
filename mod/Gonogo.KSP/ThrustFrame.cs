using Sitrep.Host.Comms;
using ContractVector = Sitrep.Contract.Vector3d;

namespace Gonogo.KSP
{
    /// <summary>
    /// Splits a thrust acceleration read in the game's world frame into a
    /// craft's prograde, radial and normal parts. Carries no KSP type.
    ///
    /// <para>The world frame is left-handed against the right-handed frame an
    /// orbit is held in, so the normal direction, which is a cross product, comes
    /// out with the opposite sign when taken in world coordinates. Prograde and
    /// radial are dot products and agree in both.</para>
    /// </summary>
    public static class ThrustFrame
    {
        /// <param name="position">The craft's position from its body's centre, in the world frame.</param>
        /// <param name="velocity">Its velocity about that body, in the world frame.</param>
        /// <param name="thrust">The acceleration its engines gave it, in the world frame, in m/s².</param>
        /// <returns>The acceleration split along the craft's own directions, or null when position and velocity define none.</returns>
        public static ThrustAcceleration? Split(ContractVector position, ContractVector velocity, ContractVector thrust)
        {
            if (ThrustAcceleration.Basis(position, velocity) is not { } basis)
            {
                return null;
            }
            // Cross(radial, prograde) taken in the left-handed world frame points opposite the orbit's angular momentum.
            return new ThrustAcceleration(
                ContractVector.Dot(thrust, basis.Prograde),
                ContractVector.Dot(thrust, basis.Radial),
                -ContractVector.Dot(thrust, basis.Normal));
        }
    }
}

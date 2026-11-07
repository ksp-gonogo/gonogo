using Sitrep.Host.Comms;
using ContractVector = Sitrep.Contract.Vector3d;

namespace Gonogo.KSP
{
    /// <summary>
    /// A target's position and velocity relative to a craft, turned into that craft's orbit
    /// frame: radial along the craft's height above its body's centre, along-track square to
    /// radial in the orbit plane on the side the craft is moving, and normal along the orbit's
    /// angular momentum. The velocity is the rate the position changes as seen in those turning
    /// axes, so two craft in the same orbit at a fixed range read zero. Carries no KSP type.
    ///
    /// <para>All four inputs must be in the same axes at the same instant, but which axes they
    /// are does not matter: the result is the same whether the game's world frame is turning
    /// with the body or not.</para>
    /// </summary>
    public static class TargetOrbitFrame
    {
        /// <summary>
        /// The target's offset and velocity in the craft's orbit frame, as (radial, along-track,
        /// normal), from vectors in the game's left-handed world frame. Null when the craft's
        /// position and velocity define no orbit plane.
        /// </summary>
        /// <param name="position">The craft's position from its body's centre, in metres.</param>
        /// <param name="velocity">The craft's orbital velocity about that body, in m/s.</param>
        /// <param name="relativePosition">The target's position minus the craft's, in metres.</param>
        /// <param name="relativeVelocity">The target's orbital velocity minus the craft's, in m/s.</param>
        public static (ContractVector Position, ContractVector Velocity)? FromWorld(
            ContractVector position, ContractVector velocity, ContractVector relativePosition, ContractVector relativeVelocity) =>
            // Swapping two axes makes the left-handed world frame right-handed, which the normal's
            // cross product needs; dot products are unchanged by it.
            Split(RightHanded(position), RightHanded(velocity), RightHanded(relativePosition), RightHanded(relativeVelocity));

        /// <summary>The same split, from vectors in a right-handed frame.</summary>
        public static (ContractVector Position, ContractVector Velocity)? Split(
            ContractVector position, ContractVector velocity, ContractVector relativePosition, ContractVector relativeVelocity)
        {
            var height = position.Magnitude();
            if (!(height > 0.0))
            {
                return null;
            }
            var momentum = ThrustAcceleration.Cross(position, velocity);
            var momentumSize = momentum.Magnitude();
            if (!(momentumSize > 1e-12 * height * velocity.Magnitude()) || !(momentumSize > 0.0))
            {
                return null;
            }
            var radial = position * (1.0 / height);
            var normal = momentum * (1.0 / momentumSize);
            var alongTrack = ThrustAcceleration.Cross(normal, radial);

            // The axes turn about the normal at the craft's own angular rate, h / r², exact for a
            // two-body orbit, whose plane holds still.
            var turn = momentum * (1.0 / (height * height));
            var seen = relativeVelocity - ThrustAcceleration.Cross(turn, relativePosition);

            return (
                new ContractVector(
                    ContractVector.Dot(relativePosition, radial),
                    ContractVector.Dot(relativePosition, alongTrack),
                    ContractVector.Dot(relativePosition, normal)),
                new ContractVector(
                    ContractVector.Dot(seen, radial),
                    ContractVector.Dot(seen, alongTrack),
                    ContractVector.Dot(seen, normal)));
        }

        private static ContractVector RightHanded(ContractVector world) => new ContractVector(world.X, world.Z, world.Y);
    }
}

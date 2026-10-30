using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// The acceleration a craft's engines gave it when it was read, in m/s²,
    /// split along the craft's own prograde, radial and normal directions at that
    /// instant: prograde along its velocity, radial along its height above the
    /// body's centre with the prograde part removed, and normal along the orbit's
    /// angular momentum (radial crossed with prograde).
    /// </summary>
    public readonly struct ThrustAcceleration
    {
        public ThrustAcceleration(double prograde, double radial, double normal)
        {
            Prograde = prograde;
            Radial = radial;
            Normal = normal;
        }

        /// <summary>The part along the craft's velocity, in m/s².</summary>
        public double Prograde { get; }

        /// <summary>The part along its height above the body's centre, perpendicular to its velocity, in m/s².</summary>
        public double Radial { get; }

        /// <summary>The part along the orbit's angular momentum, in m/s².</summary>
        public double Normal { get; }

        /// <summary>The size of the acceleration, in m/s².</summary>
        public double Magnitude => System.Math.Sqrt(Prograde * Prograde + Radial * Radial + Normal * Normal);

        /// <summary>
        /// The prograde, radial and normal unit vectors of a craft at
        /// <paramref name="position"/> moving at <paramref name="velocity"/>, in the
        /// right-handed frame the two are given in. Null when the craft is moving
        /// along its own height, which leaves radial undefined.
        /// </summary>
        public static (Vector3d Prograde, Vector3d Radial, Vector3d Normal)? Basis(Vector3d position, Vector3d velocity)
        {
            var speed = velocity.Magnitude();
            if (speed <= 0.0)
            {
                return null;
            }
            var prograde = velocity * (1.0 / speed);
            var radial = position - prograde * Vector3d.Dot(position, prograde);
            var length = radial.Magnitude();
            if (length <= 1e-9 * position.Magnitude() || length <= 0.0)
            {
                return null;
            }
            radial = radial * (1.0 / length);
            return (prograde, radial, Cross(radial, prograde));
        }

        /// <summary>The cross product of <paramref name="a"/> and <paramref name="b"/> in a right-handed frame.</summary>
        public static Vector3d Cross(Vector3d a, Vector3d b) =>
            new Vector3d(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X);

        /// <summary>This acceleration as a vector in the frame <paramref name="position"/> and <paramref name="velocity"/> are given in, or null when they define no basis.</summary>
        public Vector3d? InFrameOf(Vector3d position, Vector3d velocity)
        {
            if (Basis(position, velocity) is not { } basis)
            {
                return null;
            }
            return basis.Prograde * Prograde + basis.Radial * Radial + basis.Normal * Normal;
        }
    }
}

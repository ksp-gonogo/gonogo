namespace Sitrep.Contract
{
    /// <summary>
    /// A plain (x, y, z) double-precision vector, independent of Unity's and
    /// KSP's own vector types so the contract stays headless. The components
    /// carry whatever unit and frame the value holding the vector states.
    /// </summary>
    /// <category>Propagation and models</category>
    public struct Vector3d
    {
        /// <summary>The x component.</summary>
        public double X;

        /// <summary>The y component.</summary>
        public double Y;

        /// <summary>The z component.</summary>
        public double Z;

        /// <summary>Builds a vector from its three components.</summary>
        /// <param name="x">The x component.</param>
        /// <param name="y">The y component.</param>
        /// <param name="z">The z component.</param>
        public Vector3d(double x, double y, double z)
        {
            X = x;
            Y = y;
            Z = z;
        }

        /// <summary>The vector's Euclidean length, in the components' own unit.</summary>
        public double Magnitude()
        {
            return System.Math.Sqrt(X * X + Y * Y + Z * Z);
        }

        /// <summary>Squared magnitude, for comparisons and projections that do not need the square root.</summary>
        public double MagnitudeSquared()
        {
            return X * X + Y * Y + Z * Z;
        }

        /// <summary>The dot product of <paramref name="a"/> and <paramref name="b"/>.</summary>
        /// <param name="a">The first vector.</param>
        /// <param name="b">The second vector.</param>
        /// <returns>The sum of the component-wise products.</returns>
        public static double Dot(Vector3d a, Vector3d b)
        {
            return a.X * b.X + a.Y * b.Y + a.Z * b.Z;
        }

        /// <summary>Component-wise sum.</summary>
        public static Vector3d operator +(Vector3d a, Vector3d b)
        {
            return new Vector3d(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
        }

        /// <summary>Component-wise difference, <paramref name="a"/> minus <paramref name="b"/>.</summary>
        public static Vector3d operator -(Vector3d a, Vector3d b)
        {
            return new Vector3d(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
        }

        /// <summary>Every component of <paramref name="a"/> multiplied by <paramref name="scalar"/>.</summary>
        public static Vector3d operator *(Vector3d a, double scalar)
        {
            return new Vector3d(a.X * scalar, a.Y * scalar, a.Z * scalar);
        }

        public override string ToString()
        {
            return "(" + X + ", " + Y + ", " + Z + ")";
        }
    }

    /// <summary>
    /// Position + velocity at a single instant, both expressed in whichever
    /// <see cref="PropagationFrame"/> the solve was asked for.
    /// </summary>
    /// <category>Propagation and models</category>
    public struct StateVector
    {
        /// <summary>Position in the solve's frame, in metres.</summary>
        public Vector3d Position;

        /// <summary>Velocity in the solve's frame, in metres per second.</summary>
        public Vector3d Velocity;

        /// <summary>Builds a state vector from a position and a velocity in the same frame.</summary>
        /// <param name="position">Position, in metres.</param>
        /// <param name="velocity">Velocity, in metres per second.</param>
        public StateVector(Vector3d position, Vector3d velocity)
        {
            Position = position;
            Velocity = velocity;
        }
    }
}

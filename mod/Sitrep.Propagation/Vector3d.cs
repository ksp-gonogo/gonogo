namespace Sitrep.Propagation
{
    /// <summary>
    /// A plain (x, y, z) double-precision vector. Deliberately not tied to
    /// any engine/UI vector type -- this project is headless and BCL-only.
    /// </summary>
    public struct Vector3d
    {
        public double X;
        public double Y;
        public double Z;

        public Vector3d(double x, double y, double z)
        {
            X = x;
            Y = y;
            Z = z;
        }

        public double Magnitude()
        {
            return System.Math.Sqrt(X * X + Y * Y + Z * Z);
        }

        public static Vector3d operator +(Vector3d a, Vector3d b)
        {
            return new Vector3d(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
        }

        public static Vector3d operator -(Vector3d a, Vector3d b)
        {
            return new Vector3d(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
        }

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
    /// Position + velocity, both parent-body-relative, at a single instant.
    /// </summary>
    public struct StateVector
    {
        public Vector3d Position;
        public Vector3d Velocity;

        public StateVector(Vector3d position, Vector3d velocity)
        {
            Position = position;
            Velocity = velocity;
        }
    }
}

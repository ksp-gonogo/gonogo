namespace Sitrep.Host
{
    /// <summary>
    /// Pure, KSP-free docking maths for the <c>vessel.dock</c> channel. The KSP
    /// capture (<c>Gonogo.KSP.KspHost.BuildDock</c>) feeds it the world-space
    /// vectors and the own port's axes read off the live port transform.
    /// </summary>
    public static class DockingModel
    {
        /// <summary>
        /// A world-space vector in the axes of a docking port: x along the
        /// port's right, y along its up and z along its forward (the docking
        /// axis). The three axes must be orthonormal.
        /// </summary>
        public static (double X, double Y, double Z) ToPortFrame(
            (double X, double Y, double Z) world,
            (double X, double Y, double Z) right,
            (double X, double Y, double Z) up,
            (double X, double Y, double Z) forward)
        {
            return (Dot(world, right), Dot(world, up), Dot(world, forward));
        }

        private static double Dot((double X, double Y, double Z) a, (double X, double Y, double Z) b) =>
            a.X * b.X + a.Y * b.Y + a.Z * b.Z;
    }
}

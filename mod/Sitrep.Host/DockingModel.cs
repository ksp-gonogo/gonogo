using Sitrep.Contract;

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

        /// <summary>
        /// KSP's <c>ModuleDockingNode.state</c> string as a <see cref="DockingPortState"/>. The strings are
        /// the names of the port's state machine: <c>Ready</c>, <c>Acquire</c> and <c>Acquire (dockee)</c>,
        /// <c>PreAttached</c>, <c>Docked (docker)</c>, <c>Docked (dockee)</c> and <c>Docked (same vessel)</c>,
        /// <c>Disengage</c> and <c>Disabled</c>. Null for any other string, never a guessed state.
        /// </summary>
        public static DockingPortState? ParsePortState(string? state)
        {
            if (state == null)
            {
                return null;
            }

            switch (state)
            {
                case "Ready": return DockingPortState.Ready;
                case "Acquire":
                case "Acquire (dockee)": return DockingPortState.Acquire;
                case "PreAttached": return DockingPortState.PreAttached;
                case "Docked (docker)":
                case "Docked (dockee)":
                case "Docked (same vessel)": return DockingPortState.Docked;
                case "Disengage": return DockingPortState.Disengage;
                case "Disabled": return DockingPortState.Disabled;
                default: return null;
            }
        }

        /// <summary>
        /// Whether a port in this state is part of the dock itself: capturing,
        /// joined or letting go. A port at rest, shut off or of an unknown state is not.
        /// </summary>
        public static bool IsDockStage(DockingPortState? state) =>
            state == DockingPortState.Acquire
            || state == DockingPortState.PreAttached
            || state == DockingPortState.Docked
            || state == DockingPortState.Disengage;

        /// <summary>
        /// Whether a port in a stage of the dock is paired with a port other than
        /// <paramref name="target"/>, as one docked to a third craft is. A port
        /// whose partner is not known is not counted.
        /// </summary>
        public static bool IsTiedToAnother<TPort>(string? state, TPort? partner, TPort target) where TPort : class =>
            IsDockStage(ParsePortState(state)) && partner != null && !ReferenceEquals(partner, target);

        private static double Dot((double X, double Y, double Z) a, (double X, double Y, double Z) b) =>
            a.X * b.X + a.Y * b.Y + a.Z * b.Z;
    }
}

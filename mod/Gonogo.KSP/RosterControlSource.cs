namespace Gonogo.KSP
{
    /// <summary>
    /// The fleet roster's raw control-source string for a vessel's
    /// <c>Vessel.ControlLevel</c>, parsed on the host by
    /// <c>SharedMappers.ParseRosterCommsControlSource</c>.
    /// <para>
    /// <c>"None"</c> is a measurement: the vessel has no control source. A level
    /// this build does not name is <see cref="Unknown"/>, never <c>"None"</c>, so
    /// a KSP release that adds a level reads as "cannot say" rather than as every
    /// vessel at it being uncontrolled. The default arm is for exactly that case,
    /// a mod built against one KSP running on a newer one, which is why the
    /// completeness of the cases is a test over the real enum rather than a
    /// compiler check.
    /// </para>
    /// </summary>
    internal static class RosterControlSource
    {
        public const string Unknown = "Unknown";

        public static string For(Vessel.ControlLevel level)
        {
            switch (level)
            {
                case Vessel.ControlLevel.FULL:
                    return "Full";
                case Vessel.ControlLevel.PARTIAL_MANNED:
                case Vessel.ControlLevel.PARTIAL_UNMANNED:
                    return "Partial";
                case Vessel.ControlLevel.NONE:
                    return "None";
                default:
                    return Unknown;
            }
        }
    }
}

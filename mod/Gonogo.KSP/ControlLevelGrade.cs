using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// Stock's <c>Vessel.ControlLevel</c> in the contract's
    /// <see cref="CommsControlGrade"/> vocabulary, for every comms read that
    /// starts from the game's own control level.
    /// <para>
    /// <c>NONE</c> is a measurement and maps to <see cref="CommsControlGrade.None"/>.
    /// A level this build does not name maps to
    /// <see cref="CommsControlGrade.Unknown"/>, so a KSP release that adds one
    /// reads as "cannot say" rather than as every craft at it being
    /// uncontrolled. The default arm is for a mod built against one KSP running
    /// on a newer one, which the compiler cannot see, so the completeness of the
    /// cases is a test over the real enum.
    /// </para>
    /// </summary>
    internal static class ControlLevelGrade
    {
        public static CommsControlGrade Of(Vessel.ControlLevel level)
        {
            switch (level)
            {
                case Vessel.ControlLevel.FULL:
                    return CommsControlGrade.Full;
                case Vessel.ControlLevel.PARTIAL_MANNED:
                    return CommsControlGrade.PartialManned;
                case Vessel.ControlLevel.PARTIAL_UNMANNED:
                    return CommsControlGrade.PartialUnmanned;
                case Vessel.ControlLevel.NONE:
                    return CommsControlGrade.None;
                default:
                    return CommsControlGrade.Unknown;
            }
        }

        /// <summary>
        /// The same level collapsed to the wire's <see cref="CommsControlSource"/>,
        /// for a read that has no link to derive it through.
        /// </summary>
#pragma warning disable CS8524
        public static CommsControlSource SourceOf(Vessel.ControlLevel level) => Of(level) switch
        {
            CommsControlGrade.None => CommsControlSource.None,
            CommsControlGrade.PartialUnmanned or CommsControlGrade.PartialManned => CommsControlSource.Partial,
            CommsControlGrade.Full => CommsControlSource.Full,
            CommsControlGrade.Unknown => CommsControlSource.Unknown,
        };
#pragma warning restore CS8524
    }
}

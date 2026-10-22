using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// KSP-free verdict for a throttle write, so "ran" means the craft's own
    /// control state holds the value the engines read and not only that an
    /// assignment executed. The same shape as <see cref="ActionGroupWrite.Verify"/>.
    /// </summary>
    public static class ThrottleWrite
    {
        /// <summary>The most the read-back may differ from the request, in throttle fraction, before the write counts as not taken.</summary>
        public const double Tolerance = 0.01;

        /// <summary>
        /// Success when the control state reads back within <see cref="Tolerance"/> of
        /// the request, otherwise a <see cref="CommandErrorCode.WrongState"/> refusal
        /// naming both figures. A control state that cannot be read (null) is not
        /// taken as proof of failure, as for the action groups.
        /// </summary>
        public static CommandResult Verify(double requested, double? readBack)
        {
            if (!readBack.HasValue || System.Math.Abs(readBack.Value - requested) <= Tolerance)
            {
                return CommandResult.Ok();
            }
            return CommandResult.Fail(
                CommandErrorCode.WrongState,
                "Throttle did not change to " + requested.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture)
                + ": the craft reads "
                + readBack.Value.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture));
        }
    }
}

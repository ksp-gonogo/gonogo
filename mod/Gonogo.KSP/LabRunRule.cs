namespace Gonogo.KSP
{
    /// <summary>
    /// What a Mobile Processing Lab's switched-on state means for the operator:
    /// whether it is turning data into science right now, and the game's reason
    /// when it is on and not.
    ///
    /// <para>The conditions are the ones <c>ModuleScienceConverter.PostProcess</c>
    /// stops on: the lab must be operational (a scientist aboard, power), must
    /// hold data to process, and must have room under its science cap.</para>
    /// </summary>
    internal static class LabRunRule
    {
        /// <summary>
        /// Whether the lab is generating science now. Null where operability
        /// could not be read, which is neither answer.
        /// </summary>
        public static bool? Producing(
            bool activated,
            bool? operational,
            double dataStored,
            double storedScience,
            double scienceCap)
        {
            if (!activated)
            {
                return false;
            }

            if (operational == null)
            {
                return null;
            }

            return operational.Value && dataStored > 0.0 && storedScience < scienceCap;
        }

        /// <summary>
        /// The converter's own status line when the lab is switched on and not
        /// producing, otherwise null: an off lab has nothing in its way, it is
        /// off.
        /// </summary>
        public static string? IssueFor(bool activated, bool? producing, string? status)
        {
            if (!activated || producing != false || string.IsNullOrWhiteSpace(status))
            {
                return null;
            }

            return status;
        }
    }
}

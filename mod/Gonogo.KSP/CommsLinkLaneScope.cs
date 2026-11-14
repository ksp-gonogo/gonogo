using System;
using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// When a craft's link is said into its lane: the first reading, every change,
    /// and again every <see cref="KeyframeUt"/> while it stands, so a screen that
    /// switches to the craft is shown its link as of a moment ago.
    /// </summary>
    internal static class CommsLinkLaneScope
    {
        /// <summary>How long, in UT seconds, a craft's standing link goes unsaid at most. The <c>comms.link</c> channel's own keyframe interval.</summary>
        internal const double KeyframeUt = 30.0;

        /// <summary>
        /// Whether <paramref name="connected"/> read at <paramref name="ut"/> is due to
        /// be said for <paramref name="craft"/>, noting it in <paramref name="said"/>
        /// when it is. A reading UT behind the last one said belongs to a timeline a
        /// load went back to, so it is due.
        /// </summary>
        internal static bool Due(IDictionary<string, (bool Connected, double Ut)> said, string craft, bool connected, double ut)
        {
            if (said.TryGetValue(craft, out var last)
                && last.Connected == connected
                && ut >= last.Ut
                && ut - last.Ut < KeyframeUt)
            {
                return false;
            }
            said[craft] = (connected, ut);
            return true;
        }

        /// <summary>Lets go of every craft in <paramref name="said"/> that <paramref name="present"/> no longer names.</summary>
        internal static void ForgetGone(IDictionary<string, (bool Connected, double Ut)> said, ICollection<string> present)
        {
            if (said.Count <= present.Count)
            {
                return;
            }
            var gone = new List<string>();
            foreach (var craft in said.Keys)
            {
                if (!present.Contains(craft))
                {
                    gone.Add(craft);
                }
            }
            foreach (var craft in gone)
            {
                said.Remove(craft);
            }
        }
    }
}

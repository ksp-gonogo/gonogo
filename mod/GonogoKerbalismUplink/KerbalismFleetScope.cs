using System;
using System.Collections.Generic;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// The <c>kerbalism.vessel.&lt;guid&gt;.*</c> namespace and the decision of
    /// which craft are worth reading this tick. KSP-free so the gate itself is
    /// testable: it is the part that keeps a per-vessel Kerbalism read
    /// affordable, and it is exactly the part that cannot be checked in flight
    /// by looking at a widget, because reading too much looks identical to
    /// reading the right amount.
    ///
    /// <para><b>The gate is per craft, never per namespace.</b> A namespace-wide
    /// "is anyone watching kerbalism.vessel.*" test passes as soon as ONE probe
    /// is on screen, and every tick after that walks every vessel in the save
    /// doing habitat, resource and rule reflection for craft nobody asked
    /// about.</para>
    /// </summary>
    public static class KerbalismFleetScope
    {
        /// <summary>
        /// The dynamic namespace prefix. Declares
        /// <c>ChannelDeclaration.PerVesselNode</c> at registration so each
        /// craft's payload records on its own node and reveals at its own
        /// light-time.
        /// </summary>
        public const string Prefix = "kerbalism.vessel.";

        /// <summary>Every topic for one craft, the exact prefix the per-craft subscription gate asks about.</summary>
        public static string TopicPrefixFor(string vesselId) => Prefix + vesselId + ".";

        /// <summary>Sub-topic (namespace-relative, as <c>IDynamicChannelSource.Publisher</c> takes it).</summary>
        public static string LifeSupportSubTopic(string vesselId) => vesselId + ".lifesupport";

        /// <summary>Sub-topic (namespace-relative, as <c>IDynamicChannelSource.Publisher</c> takes it).</summary>
        public static string CrewSubTopic(string vesselId) => vesselId + ".crew";

        /// <summary>
        /// The craft to read this tick: those with a subscriber of their own.
        /// <paramref name="isAnyTopicSubscribed"/> is asked once per craft, with
        /// that craft's own topic prefix.
        /// </summary>
        public static List<string> WatchedVessels(
            IEnumerable<string> vesselIds,
            Func<string, bool> isAnyTopicSubscribed)
        {
            var watched = new List<string>();
            if (vesselIds == null || isAnyTopicSubscribed == null)
            {
                return watched;
            }
            foreach (var id in vesselIds)
            {
                if (!string.IsNullOrEmpty(id) && isAnyTopicSubscribed(TopicPrefixFor(id)))
                {
                    watched.Add(id);
                }
            }
            return watched;
        }
    }
}

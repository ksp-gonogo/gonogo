using System.Collections.Generic;
using Sitrep.Core.StoreAndForward;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Where a continuous input, a throttle or a control axis, would be dropped
    /// on its way to a craft.
    ///
    /// <para>A continuous input is a stream of positions. Held at a node and
    /// sent on later it would arrive as a wall of stale ones, so it is never
    /// held: the node that could not send it on at once drops it. Sending one
    /// is still the operator's call. The centre and the pilot may have agreed a
    /// course change that opens the link, and the instrument is not there to
    /// overrule them, so the input is accepted with a warning and goes.</para>
    /// </summary>
    public static class ContinuousInput
    {
        /// <summary>
        /// The longest wait at a node that is not a hold, in seconds of game
        /// time.
        ///
        /// <para>A relay that has to turn a dish to send the input on is not
        /// holding it. A dish takes a new target at the comms network's next
        /// rebuild: measured on the rig at up to 1.26 s loaded at 1x and 1.2 s
        /// packed at 10x. Two seconds covers both with room, and is far below
        /// any wait for a window to open, which is minutes.</para>
        /// </summary>
        public const double NotAHoldSeconds = 2.0;

        /// <summary>Where a route makes its input wait: the node, and when the input reaches it.</summary>
        public readonly struct Hold
        {
            public Hold(string at, double arrivesUt)
            {
                At = at;
                ArrivesUt = arrivesUt;
            }

            /// <summary>The node it would wait at.</summary>
            public string At { get; }

            /// <summary>When it gets there, which is when it is dropped.</summary>
            public double ArrivesUt { get; }
        }

        /// <summary>
        /// The first node on <paramref name="route"/> where an input sent from
        /// <paramref name="from"/> at <paramref name="nowUt"/> would wait longer
        /// than <see cref="NotAHoldSeconds"/>, or null when it goes through. No
        /// route at all waits at the sender.
        /// </summary>
        public static Hold? FirstHold(IReadOnlyList<PlannedHop>? route, string from, double nowUt)
        {
            if (route == null || route.Count == 0)
            {
                return new Hold(from, nowUt);
            }
            var at = nowUt;
            for (var i = 0; i < route.Count; i++)
            {
                if (route[i].DepartUt > at + NotAHoldSeconds)
                {
                    return new Hold(i == 0 ? from : route[i - 1].To, at);
                }
                at = route[i].ArriveUt;
            }
            return null;
        }
    }
}

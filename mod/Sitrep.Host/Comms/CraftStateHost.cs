using System;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Where craft states are recorded and heard: each on its craft's own
    /// node, so the delay machinery carries it to each command centre as it
    /// carries that craft's telemetry. Courier thread only.
    /// </summary>
    public interface ICraftStateHost
    {
        /// <summary>
        /// Records <paramref name="state"/> as read aboard the craft at
        /// <paramref name="ut"/>. While the craft is out of contact it is held
        /// with the rest of the craft's recording, and dumped on reacquisition.
        /// </summary>
        /// <param name="vesselId">The craft's bare guid, as the fleet node carries it.</param>
        void RecordCraftState(string vesselId, CraftState state, double ut);

        /// <summary>
        /// Notes that the craft still exists and is still measured at
        /// <paramref name="ut"/>, so that its light-times are on file for the day
        /// it is not. A centre that has gained a route to the craft since the
        /// last note is sent the craft's last state again, from now.
        /// </summary>
        void NoteCraftPresent(string vesselId, double ut);

        /// <summary>
        /// Records that the craft is gone as of <paramref name="ut"/>. It
        /// reaches each centre at the light-time the craft was last measured at
        /// while in contact, which is when its silence would. A craft that was
        /// out of contact when it went sends nothing: no centre can tell its
        /// loss from the blackout it was already in.
        /// </summary>
        void RecordCraftGone(string vesselId, double ut);

        /// <summary>
        /// Hears the craft's states as <paramref name="centre"/> receives them:
        /// the newest already arrived at once, and each later one as it lands.
        /// Returns the call that stops listening.
        /// </summary>
        Action HearCraftState(string vesselId, string centre, Action<CraftState> heard);

        /// <summary>Calls <paramref name="reset"/> whenever the game's timeline is rewound or replaced, after everything recorded ahead of it has been dropped.</summary>
        void OnTimelineReset(Action reset);
    }
}

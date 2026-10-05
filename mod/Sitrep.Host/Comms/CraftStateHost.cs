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
        /// Records the state of a craft that carries no radio, as the ground
        /// saw it at <paramref name="ut"/>. It says nothing itself, so no light
        /// of its own carries this: every centre has it at once.
        /// </summary>
        void RecordCraftSeenFromGround(string vesselId, CraftState state, double ut);

        /// <summary>Records that a craft with no radio is gone as of <paramref name="ut"/>, which every centre has at once, as it had its arrival.</summary>
        void RecordCraftGoneFromGround(string vesselId, double ut);

        /// <summary>
        /// Hears whether the craft's radio answers, as <paramref name="centre"/>
        /// learns it: an outage one of the centre's own light-times after the
        /// last light the craft sent, and its return when its light arrives
        /// again. Returns the call that stops listening.
        /// </summary>
        Action HearCraftLink(string vesselId, string centre, Action<bool> heard);

        /// <summary>
        /// Records what a craft's radio says of its own link, on the craft's
        /// node. It reaches each centre no sooner than light from the farthest
        /// node on the path it was measured over.
        /// </summary>
        void RecordCraftRadio(string vesselId, ContactRadio radio, double ut);

        /// <summary>Calls <paramref name="heard"/> each time a radio reading of the craft reaches <paramref name="centre"/>. Returns what stops it.</summary>
        Action HearCraftRadio(string vesselId, string centre, Action<ContactRadio> heard);

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

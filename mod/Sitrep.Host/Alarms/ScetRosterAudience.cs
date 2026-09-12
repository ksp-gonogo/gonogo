namespace Sitrep.Host.Alarms
{
    /// <summary>
    /// When a tick should put the SCET alarm roster on the wire.
    ///
    /// <para><b>An EMPTY roster is an answer, and it is the one a cold client
    /// needs most.</b> The client reconciles its own alarm list against the
    /// roster, so it will not arm anything until it has seen one: reconciling
    /// against a roster it has not been given would disarm alarms the host
    /// actually holds. "There are no alarms" is therefore the state that MUST
    /// reach a client, and under a publish-on-change rule it is the only state
    /// that never can, because a roster that starts empty and stays empty never
    /// changes.</para>
    ///
    /// <para><b>Why counting our own publishes does not work.</b> The engine
    /// DROPS a publish for a topic nobody is subscribed to, so an uplink that
    /// publishes once at registration and remembers having done so has spent its
    /// one publish on a frame that went nowhere. Nothing replays it either: a
    /// keyframe is decided inside the emitter and the emitter is only consulted
    /// when something is published, so a publisher-backed channel has no cadence
    /// at all until its first delivered frame, and the Courier has nothing
    /// archived to catch a later subscriber up to. Measured on the deck
    /// 2026-09-12: subscribing to <c>alarm.scet</c> returned nothing for
    /// twenty-seven seconds and twelve thousand UT of warp.</para>
    ///
    /// <para>So the question this answers is not "have I published" but "is
    /// there anyone who has not been told", which is a fact about the
    /// subscription rather than about us. <c>commandCentre.roster</c>, the same
    /// class of channel, reaches the same place from the other end: its capture
    /// is gated on its own topic and publishes the current roster whatever it
    /// is, so a subscriber is answered by the first tick after it arrives. This
    /// uplink's capture cannot be gated, because its real effect is stopping the
    /// warp and that must happen whether or not anyone is watching, so the
    /// subscription check sits on the PUBLISH instead
    /// (<see cref="Sitrep.Contract.IUplinkHost.IsAnyTopicSubscribed"/>), which
    /// is what that method exists for.</para>
    /// </summary>
    public sealed class ScetRosterAudience
    {
        /// <summary>
        /// Whether everyone currently subscribed has been sent a roster. Cleared
        /// the moment the channel has no subscribers at all, because who is in
        /// the audience is not observable from here: the only safe reading of
        /// "nobody is listening" is that whoever listens next has heard nothing.
        /// </summary>
        private bool _answered;

        /// <summary>
        /// Publish when the roster moved, and always once for an audience that
        /// has not been answered yet.
        /// </summary>
        /// <param name="hasAudience">Whether anything is subscribed to the roster topic.</param>
        /// <param name="rosterChanged">Whether the roster differs from the one last published.</param>
        public bool ShouldPublish(bool hasAudience, bool rosterChanged)
        {
            if (!hasAudience)
            {
                // A change with nobody watching is not banked: the publish that
                // follows the next subscribe carries the CURRENT roster, so
                // there is nothing the dropped change could have cost.
                _answered = false;
                return false;
            }

            if (_answered && !rosterChanged)
            {
                return false;
            }

            _answered = true;
            return true;
        }
    }
}

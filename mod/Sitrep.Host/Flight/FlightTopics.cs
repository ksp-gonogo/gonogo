namespace Sitrep.Host.Flight
{
    /// <summary>
    /// Channel topic ids for the flight-lifecycle domain — mirrors
    /// <c>Sitrep.Host.Crash.CrashTopics</c>'s naming convention exactly.
    /// </summary>
    public static class FlightTopics
    {
        /// <summary>UT-indexed Value: current flight id/vessel/phase. LossyLatest.</summary>
        public const string CurrentTopic = "flight.current";

        /// <summary>Event: a new flight began. ReliableOrdered.</summary>
        public const string StartedTopic = "flight.started";

        /// <summary>Event: a flight ended (recovered/crashed/reverted/destroyed). ReliableOrdered.</summary>
        public const string EndedTopic = "flight.ended";

        /// <summary>Event: the operator's active-vessel focus moved to a different, already-known vessel. ReliableOrdered.</summary>
        public const string VesselChangedTopic = "flight.vesselChanged";
    }
}

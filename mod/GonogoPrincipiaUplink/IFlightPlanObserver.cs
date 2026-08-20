namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The seam between the uplink's publish decisions and the thing that watches
    /// the integrator's planner.
    ///
    /// <para>It exists so <see cref="PrincipiaUplink"/> can be compiled and tested
    /// with no KSP, Unity or Harmony reference at all. That property was true of
    /// this uplink before it observed anything and is worth keeping: the publish
    /// rule is real logic (publish an observation once, at the instant it was
    /// observed, and never republish it at a later one) and it should be provable
    /// without a game.</para>
    /// </summary>
    public interface IFlightPlanObserver
    {
        /// <summary>Starts observing, if the integrator is there to observe.
        /// Idempotent, and false rather than throwing when it cannot.</summary>
        bool TryAttach();

        /// <summary>The most recent observation, or null when there has not been
        /// one. Null is "not observed" and never "no plan".</summary>
        FlightPlanObservation? Latest { get; }
    }
}

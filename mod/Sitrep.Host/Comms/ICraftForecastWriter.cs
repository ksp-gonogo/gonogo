namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Takes the ground's forecast for each craft it has lost, worked out where
    /// the game's geometry can be read, so every centre can hear it.
    ///
    /// <para>Off <c>IUplinkHost</c> because its only writer is gonogo's own
    /// silence capture, which already references this assembly.</para>
    /// </summary>
    public interface ICraftForecastWriter
    {
        /// <summary>
        /// Records the forecast for the craft, by bare guid, at home. It reaches
        /// each other centre at that centre's delay to home.
        /// </summary>
        void RecordCraftForecast(string vesselId, CraftForecast forecast, double ut);
    }
}

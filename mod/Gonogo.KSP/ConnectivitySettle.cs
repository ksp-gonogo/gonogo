namespace Gonogo.KSP
{
    /// <summary>
    /// Whether a disconnected reading is still the game's first, unsettled
    /// answer for a craft rather than a loss of contact.
    ///
    /// <para>The first read after a craft comes on screen (a launch, a vessel
    /// switch, a load) precedes the game's first solve of its comms graph and
    /// says disconnected for a moment. A reading is unknown until the craft has
    /// been read connected once or <see cref="WindowSeconds"/> of game time have
    /// passed since it appeared, so nothing is held as out of contact on the
    /// strength of it.</para>
    /// </summary>
    internal sealed class ConnectivitySettle
    {
        internal const double WindowSeconds = 3.0;

        private object? _craft;
        private double _settledAtUt;

        /// <summary>
        /// True while a disconnected reading of <paramref name="craft"/> at
        /// <paramref name="ut"/> is still unknown. A connected reading settles
        /// the craft at once.
        /// </summary>
        internal bool IsUnknown(object craft, double ut, bool connected)
        {
            if (!ReferenceEquals(craft, _craft))
            {
                _craft = craft;
                _settledAtUt = ut + WindowSeconds;
            }
            if (connected)
            {
                _settledAtUt = double.NegativeInfinity;
                return false;
            }
            return ut < _settledAtUt;
        }
    }
}

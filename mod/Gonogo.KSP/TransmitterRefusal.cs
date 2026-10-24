namespace Gonogo.KSP
{
    /// <summary>
    /// The wording of a transmit refusal when the game found no transmitter. The game answers
    /// with nothing both when no antenna is aboard and when one is aboard but the vessel's
    /// control path has not been worked out yet, which is the case for a craft just launched
    /// or a scene just loaded. A craft that stays unlinked after that is out of range.
    /// </summary>
    internal static class TransmitterRefusal
    {
        internal const string NoDevice = "no usable comms device aboard";

        internal const string LinkNotUp = "the antenna has no link yet, try again in a moment";

        internal const string NoLink = "the craft has no link to the command centre";

        internal static string For(bool antennaAboard, bool linkUp, bool linkSettling)
        {
            if (!antennaAboard)
            {
                return NoDevice;
            }

            if (linkUp)
            {
                return NoDevice;
            }

            return linkSettling ? LinkNotUp : NoLink;
        }
    }

    /// <summary>
    /// How long after a launch or a scene load the game's comms network is still working out
    /// each craft's control path, measured on a clock the caller supplies in real seconds.
    /// </summary>
    internal sealed class LinkSettleWindow
    {
        internal const double Seconds = 15;

        private double? _markedAt;

        internal void Mark(double now) => _markedAt = now;

        internal bool IsSettling(double now) => _markedAt is double at && now - at < Seconds;
    }
}

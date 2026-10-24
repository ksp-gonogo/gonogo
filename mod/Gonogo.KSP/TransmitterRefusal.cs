namespace Gonogo.KSP
{
    /// <summary>
    /// The wording of a transmit refusal when the game found no transmitter. The game answers
    /// with nothing both when no antenna is aboard and when one is aboard but the vessel's
    /// control path has not been worked out yet, which is the case for a craft just launched.
    /// </summary>
    internal static class TransmitterRefusal
    {
        internal const string NoDevice = "no usable comms device aboard";

        internal const string LinkNotUp = "the antenna has no link yet, try again in a moment";

        internal static string For(bool antennaAboard, bool linkUp) =>
            antennaAboard && !linkUp ? LinkNotUp : NoDevice;
    }
}

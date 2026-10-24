using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Whether the game's comms network is still working out control paths after the latest
    /// scene load or flight start. Read by the transmit refusal to tell a link that is coming
    /// up from a craft that is out of range.
    /// </summary>
    internal static class KspLinkSettle
    {
        private static readonly LinkSettleWindow Window = new LinkSettleWindow();

        internal static void Mark() => Window.Mark(Time.realtimeSinceStartup);

        internal static bool IsSettling() => Window.IsSettling(Time.realtimeSinceStartup);
    }
}

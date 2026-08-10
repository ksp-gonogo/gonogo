namespace Gonogo.MechJebUplink
{
    /// <summary>
    /// The three <c>mechjeb.*</c> command topic string constants, in one
    /// place (mirrors <c>GonogoKosUplink</c>'s <c>KosChannels.cs</c>). This
    /// Uplink is command-only, see <c>MechJebUplink.cs</c>'s class doc
    /// comment, so there are no channel topics to declare here.
    /// </summary>
    public static class MechJebChannels
    {
        /// <summary>Engage the ascent autopilot to a target altitude (<see cref="MechJebAscentArgs"/>).</summary>
        public const string EngageAscentAutopilotCommand = "mechjeb.engageAscentAutopilot";

        /// <summary>Execute the next maneuver node (<see cref="MechJebNoArgs"/>).</summary>
        public const string ExecuteNextNodeCommand = "mechjeb.executeNextNode";

        /// <summary>Autopilot land at the selected target (<see cref="MechJebNoArgs"/>).</summary>
        public const string LandAtTargetCommand = "mechjeb.landAtTarget";
    }
}

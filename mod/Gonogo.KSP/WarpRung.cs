namespace Gonogo.KSP
{
    /// <summary>
    /// The time-warp rung a scene is on. <c>TimeWarp.CurrentRateIndex</c>
    /// answers 1 when there is no warp controller, as in the editor, and 1 is
    /// the first rung above real time wherever there is one. A scene that
    /// cannot warp is at real time, which is rung 0.
    /// </summary>
    internal static class WarpRung
    {
        /// <param name="hasController">Whether the scene has a warp controller (<c>TimeWarp.fetch</c>).</param>
        /// <param name="answered">What <c>TimeWarp.CurrentRateIndex</c> answered.</param>
        internal static int Index(bool hasController, int answered) => hasController ? answered : 0;
    }
}

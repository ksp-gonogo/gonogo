using HarmonyLib;
using UnityEngine;

namespace Gonogo.KSP.GameWindows
{
    /// <summary>
    /// Connects a part menu button to the window it opens: a BaseEvent firing
    /// starts a short watch, and the first new window seen during it is claimed
    /// for that event. Windows opened any other way are never mirrored.
    /// </summary>
    internal static class OpenerWatch
    {
        private const int WatchFrames = 60;

        private static WindowOpenedBy? _opener;
        private static int _untilFrame;

        internal static void Patch(Harmony harmony)
        {
            var type = typeof(BaseEvent);
            var pre = new HarmonyMethod(typeof(OpenerWatch), nameof(InvokePrefix));
            harmony.Patch(AccessTools.Method(type, "Invoke", new System.Type[0]), prefix: pre);
            harmony.Patch(AccessTools.Method(type, "Invoke", new[] { typeof(BaseEventDetails) }), prefix: pre);
        }

        public static void InvokePrefix(BaseEvent __instance)
        {
            var list = __instance.listParent;
            _opener = new WindowOpenedBy
            {
                PartId = list?.part != null ? list.part.flightID.ToString() : "",
                Module = list?.module != null ? list.module.moduleName : null,
                Event = __instance.name ?? "",
                Label = __instance.guiName ?? "",
            };
            _untilFrame = Time.frameCount + WatchFrames;
            UguiCapture.SnapshotCanvases();
        }

        internal static WindowOpenedBy? Claim()
        {
            if (_opener == null) return null;
            if (Time.frameCount > _untilFrame)
            {
                _opener = null;
                return null;
            }
            var claimed = _opener;
            _opener = null;
            return claimed;
        }

        internal static bool Watching => _opener != null && Time.frameCount <= _untilFrame;
    }
}

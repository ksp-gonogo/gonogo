using System;
using HarmonyLib;
using Sitrep.Contract;
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

        private static CommandOrigin? _press;
        private static WindowOpenedBy? _opener;
        private static int _untilFrame;

        internal static void Patch(Harmony harmony)
        {
            var type = typeof(BaseEvent);
            var pre = new HarmonyMethod(typeof(OpenerWatch), nameof(InvokePrefix));
            harmony.Patch(AccessTools.Method(type, "Invoke", new System.Type[0]), prefix: pre);
            harmony.Patch(AccessTools.Method(type, "Invoke", new[] { typeof(BaseEventDetails) }), prefix: pre);
        }

        /// <summary>
        /// Marks the part event fired inside the returned scope as pressed from a
        /// screen by <paramref name="origin"/>. Only such an event starts a watch.
        /// </summary>
        internal static IDisposable Pressing(CommandOrigin origin)
        {
            var previous = _press;
            _press = origin;
            return new Scope(() => _press = previous);
        }

        public static void InvokePrefix(BaseEvent __instance)
        {
            if (_press == null) return;

            var list = __instance.listParent;
            _opener = new WindowOpenedBy
            {
                PartId = list?.part != null ? list.part.flightID.ToString() : "",
                Module = list?.module != null ? list.module.moduleName : null,
                Event = __instance.name ?? "",
                Label = __instance.guiName ?? "",
                Session = _press.SessionId,
                PressId = _press.RequestId,
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

        private sealed class Scope : IDisposable
        {
            private readonly Action _end;

            public Scope(Action end) => _end = end;

            public void Dispose() => _end();
        }

        /// <summary>The press's button while its watch is open and nothing has claimed a window for it yet.</summary>
        internal static WindowOpenedBy? Pending => Watching ? _opener : null;

        internal static bool Watching => _opener != null && Time.frameCount <= _untilFrame;
    }
}

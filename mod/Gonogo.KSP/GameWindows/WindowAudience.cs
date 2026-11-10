using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KSP.GameWindows
{
    /// <summary>
    /// Decides which session sees which mirrored window: the one whose press
    /// opened it. Kept apart from the capture so it can be tested without the game.
    /// </summary>
    internal static class WindowAudience
    {
        /// <summary>
        /// Keeps the windows that the viewing session's own press opened, and drops
        /// the session id from what it passes on.
        /// </summary>
        internal static object? KeepPressedBy(object payload, ViewerContext viewer)
        {
            if (!(payload is Dictionary<string, object?> frame)
                || !frame.TryGetValue("windows", out var listed)
                || !(listed is IEnumerable<object?> windows))
            {
                return null;
            }

            var kept = new List<object?>();
            foreach (var window in windows)
            {
                if (window is Dictionary<string, object?> w
                    && w.TryGetValue("openedBy", out var openedBy)
                    && openedBy is Dictionary<string, object?> opener
                    && opener.TryGetValue(WindowOpenedBy.SessionKey, out var session)
                    && string.Equals(session as string, viewer.SessionId, StringComparison.Ordinal))
                {
                    var visible = new Dictionary<string, object?>(w);
                    var visibleOpener = new Dictionary<string, object?>(opener);
                    visibleOpener.Remove(WindowOpenedBy.SessionKey);
                    visible["openedBy"] = visibleOpener;
                    kept.Add(visible);
                }
            }

            return new Dictionary<string, object?>(frame) { ["windows"] = kept };
        }
    }
}

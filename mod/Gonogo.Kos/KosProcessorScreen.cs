// Gonogo.Kos — GPLv3. See Gonogo.Kos.csproj's header comment for the
// licence/linkage rationale.

using System;
using kOS.Module;
using kOS.Safe.Screen;
using kOS.Screen;
using kOS.UserIO;

namespace Gonogo.Kos
{
    /// <summary>
    /// The live-kOS implementation of <see cref="IKosTerminalScreen"/> for one
    /// CPU — the in-process replacement for the telnet proxy's byte pump. It
    /// reads the CPU's own <c>kOS.Safe.Screen.ScreenSnapShot</c>, diffs it
    /// against the last frame with kOS's own <c>DiffFrom</c>, and runs the diff
    /// through kOS's own <c>kOS.UserIO.TerminalXtermMapper</c> — the SAME
    /// pipeline kOS's telnet server uses — so the output is xterm-ready
    /// (VT100/xterm escapes), not kOS's private-use control codes. Nothing here
    /// touches telnet or node-pty.
    ///
    /// <para>All methods run on the KSP main thread (the manager's poll loop and
    /// the command handlers via <see cref="KosExtension.RunOnMainThread"/>). The
    /// processor is re-resolved by <c>KOSCoreId</c> every read so a reboot /
    /// vessel reload (which recreates or drops the Screen) is detected by
    /// reference identity and triggers a self-contained full repaint rather than
    /// a dangling diff (spec §P3 lifecycle).</para>
    /// </summary>
    internal sealed class KosProcessorScreen : IKosTerminalScreen
    {
        // Explicit ANSI clear-screen + home so a full-repaint frame wipes any
        // stale content on the client (including a stray diff a reconnecting
        // viewer's keyframe-on-subscribe may have replayed) before the absolute-
        // positioned full frame is applied.
        private const string ClearScreen = "\u001b[2J\u001b[H";

        private readonly int _coreId;
        private readonly Func<int, kOSProcessor?> _resolve;

        private TerminalUnicodeMapper _mapper;
        private IScreenSnapShot? _prev;
        private IScreenBuffer? _lastScreenRef;

        public KosProcessorScreen(int coreId, Func<int, kOSProcessor?> resolve)
        {
            _coreId = coreId;
            _resolve = resolve ?? throw new ArgumentNullException(nameof(resolve));
            _mapper = TerminalUnicodeMapper.TerminalMapperFactory("xterm");
        }

        public TerminalReadResult ReadChunk(bool forceReseed)
        {
            var proc = _resolve(_coreId);
            if (proc == null || !proc.HasBooted)
            {
                return TerminalReadResult.None;
            }
            var screen = proc.GetScreen();
            if (screen == null)
            {
                return TerminalReadResult.None;
            }

            // Reboot / rebind: kOS recreates the Screen on reboot and drops it
            // on unload, so a changed reference means our diff baseline is dead.
            var rebound = !ReferenceEquals(screen, _lastScreenRef);
            var reseed = forceReseed || rebound || _prev == null;

            var current = new ScreenSnapShot(screen);
            string raw;
            if (reseed)
            {
                // Full frame = diff from an empty screen (absolute-positioned).
                // Fresh mapper so the frame is self-contained.
                _mapper = TerminalUnicodeMapper.TerminalMapperFactory("xterm");
                raw = current.DiffFrom(ScreenSnapShot.EmptyScreen(screen));
            }
            else
            {
                raw = current.DiffFrom(_prev);
            }

            _prev = current.DeepCopy();
            _lastScreenRef = screen;

            if (!reseed && string.IsNullOrEmpty(raw))
            {
                return TerminalReadResult.None;
            }

            var mapped = new string(_mapper.OutputConvert(raw));
            return reseed
                ? TerminalReadResult.Output(ClearScreen + mapped, fullRepaint: true)
                : TerminalReadResult.Output(mapped, fullRepaint: false);
        }

        public bool TypeChars(string chars)
        {
            var proc = _resolve(_coreId);
            var window = proc?.GetWindow();
            if (window == null)
            {
                return false;
            }
            foreach (var ch in chars)
            {
                // whichTelnet:null, allowQueue:true, forceQueue:true — the
                // sanctioned remote-input mode (matches KosExtension.TypeLine).
                window.ProcessOneInputChar(ch, null, true, true);
            }
            return true;
        }

        public void Resize(int cols, int rows)
        {
            var screen = _resolve(_coreId)?.GetScreen();
            // IScreenBuffer.SetSize(rowCount, columnCount).
            screen?.SetSize(rows, cols);
        }
    }
}

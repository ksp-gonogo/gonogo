// Gonogo.Kos — GPLv3. See Gonogo.Kos.csproj's header comment for the
// licence/linkage rationale.

using System;
using kOS.Module;

namespace Gonogo.Kos
{
    /// <summary>
    /// The live-kOS implementation of <see cref="IKosTerminalScreen"/> for one
    /// CPU — the in-process replacement for the telnet proxy's byte pump. It is
    /// a thin KSP shell: it resolves the live <c>kOSProcessor</c> by
    /// <c>KOSCoreId</c>, grabs its <c>kOS.Safe.Screen.IScreenBuffer</c>, and
    /// delegates the actual diff + xterm-map to <see cref="ScreenDiffMapper"/>
    /// (which references only <c>kOS.Safe</c> + kOS's own
    /// <c>TerminalXtermMapper</c>, no <c>kOSProcessor</c>/window). That split is
    /// what lets the pure diff pipeline — the SAME pipeline kOS's telnet server
    /// uses — be exercised headlessly by the terminal-harness tests while this
    /// shell stays KSP-only. Nothing here touches telnet or node-pty.
    ///
    /// <para>All methods run on the KSP main thread (the manager's poll loop and
    /// the command handlers via <see cref="KosExtension.RunOnMainThread"/>). The
    /// processor is re-resolved by <c>KOSCoreId</c> every read so a reboot /
    /// vessel reload (which recreates or drops the Screen) is detected by
    /// reference identity — inside <see cref="ScreenDiffMapper"/> — and triggers
    /// a self-contained full repaint rather than a dangling diff (spec §P3
    /// lifecycle).</para>
    /// </summary>
    internal sealed class KosProcessorScreen : IKosTerminalScreen
    {
        private readonly int _coreId;
        private readonly Func<int, kOSProcessor?> _resolve;
        private readonly ScreenDiffMapper _diffMapper = new ScreenDiffMapper();

        public KosProcessorScreen(int coreId, Func<int, kOSProcessor?> resolve)
        {
            _coreId = coreId;
            _resolve = resolve ?? throw new ArgumentNullException(nameof(resolve));
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

            return _diffMapper.MapNext(screen, forceReseed);
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

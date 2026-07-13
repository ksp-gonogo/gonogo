// Gonogo.Kos — GPLv3. See Gonogo.Kos.csproj's header comment for the
// licence/linkage rationale.

using kOS.Safe.Screen;
using kOS.UserIO;

namespace Gonogo.Kos
{
    /// <summary>
    /// The PURE kOS.Safe screen-diff → xterm-mapper pipeline, extracted out of
    /// <see cref="KosProcessorScreen"/> so it can be driven headlessly (no
    /// KSP/Unity process, no live <c>kOSProcessor</c>) by the terminal-harness
    /// tests. It references only <c>kOS.Safe</c> (<see cref="ScreenSnapShot"/> /
    /// <see cref="IScreenSnapShot"/> / <see cref="IScreenBuffer"/>) and kOS's
    /// own <c>kOS.UserIO.TerminalUnicodeMapper</c> — both of which load and run
    /// in a plain .NET process without UnityEngine (the mapper's body touches
    /// only mscorlib + kOS.Safe types, so its assembly's Unity references stay
    /// lazily unresolved). Nothing here resolves a processor, a window, or any
    /// <c>kOS.Module</c>/<c>kOS.Screen</c>/UnityEngine type — that KSP shell
    /// stays in <see cref="KosProcessorScreen"/>.
    ///
    /// <para>The logic is byte-identical to the diff+map half that used to live
    /// inline in <c>KosProcessorScreen.ReadChunk</c>: a reseed (forced, or a
    /// changed <see cref="IScreenBuffer"/> reference from a reboot/rebind, or
    /// the very first frame) produces a self-contained absolute-positioned full
    /// repaint (diff from an empty screen, fresh mapper, prefixed with an
    /// explicit clear); otherwise a cursor-relative diff from the previous
    /// snapshot. The caller owns the "is there a live screen at all" guard.</para>
    /// </summary>
    internal sealed class ScreenDiffMapper
    {
        // Explicit ANSI clear-screen + home so a full-repaint frame wipes any
        // stale content on the client (including a stray diff a reconnecting
        // viewer's keyframe-on-subscribe may have replayed) before the absolute-
        // positioned full frame is applied.
        private const string ClearScreen = "\u001b[2J\u001b[H";

        private TerminalUnicodeMapper _mapper;
        private IScreenSnapShot? _prev;
        private IScreenBuffer? _lastScreenRef;

        public ScreenDiffMapper()
        {
            _mapper = TerminalUnicodeMapper.TerminalMapperFactory("xterm");
        }

        /// <summary>
        /// Diff <paramref name="screen"/> against the last frame and return the
        /// xterm-ready chunk (or <see cref="TerminalReadResult.None"/> when an
        /// incremental frame produced no change). A reboot / CPU rebind is
        /// detected by <see cref="IScreenBuffer"/> reference identity and forces
        /// a self-contained full repaint, same as <paramref name="forceReseed"/>.
        /// </summary>
        public TerminalReadResult MapNext(IScreenBuffer screen, bool forceReseed)
        {
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
    }
}

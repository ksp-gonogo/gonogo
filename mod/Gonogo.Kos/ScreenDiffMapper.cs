// Gonogo.Kos — GPLv3. See Gonogo.Kos.csproj's header comment for the
// licence/linkage rationale.

using System;
using System.Collections.Generic;
using kOS.Safe.Screen;
using kOS.UserIO;

namespace Gonogo.Kos
{
    /// <summary>
    /// A full-repaint diff baseline: an <see cref="IScreenSnapShot"/> whose
    /// <see cref="Buffer"/> is EMPTY. Used as the "older" side of
    /// <see cref="ScreenSnapShot.DiffFrom"/> to force a self-contained full
    /// render of the current screen.
    ///
    /// <para>This deliberately replaces <see cref="ScreenSnapShot.EmptyScreen"/>
    /// for the reseed baseline. <c>EmptyScreen</c> builds its rows with
    /// <c>new ScreenBufferLine(columnCount)</c>, and every <c>ScreenBufferLine</c>
    /// constructor stamps <c>LastChangeTick = TickGen.Next</c> — the newest tick
    /// so far. <c>DiffFrom</c> skips a row whenever the baseline row's
    /// <c>Length != 0</c> AND <c>current.LastChangeTick &lt;= baseline.LastChangeTick</c>,
    /// so an EmptyScreen baseline (constructed AFTER the screen's content was
    /// printed, hence newer-ticked) makes <c>DiffFrom</c> discard every
    /// content-bearing row — a reseed of an already-populated screen emits only
    /// the clear, no content. That silently blanks a late/second subscriber
    /// joining a BUSY CPU (the exact case the per-subscriber reseed forces a
    /// full repaint for). An EMPTY baseline buffer instead makes
    /// <c>DiffFrom</c> treat every current row as absent (its zero-length
    /// fallback), emitting the full content regardless of ticks — char-identical
    /// to diffing against a genuinely-older blank snapshot.</para>
    /// </summary>
    internal sealed class FullRepaintBaseline : IScreenSnapShot
    {
        public List<IScreenBufferLine> Buffer { get; } = new List<IScreenBufferLine>();
        public int TopRow { get; }
        public int CursorColumn { get; }
        public int CursorRow { get; }
        public int RowCount { get; }

        public FullRepaintBaseline(IScreenBuffer screen)
        {
            // Match ScreenSnapShot.EmptyScreen's non-Buffer fields (TopRow keeps
            // DiffFrom's scroll delta at zero; cursor mirrors the current screen)
            // — only the Buffer differs: intentionally empty, see class summary.
            TopRow = screen.TopRow;
            CursorColumn = screen.CursorColumnShow;
            CursorRow = screen.CursorRowShow;
            RowCount = screen.RowCount;
        }

        // DiffFrom only ever reads a baseline's TopRow / Cursor / Buffer; it
        // never calls these on the "older" arg. Present to satisfy the interface.
        public string DiffFrom(IScreenSnapShot older) => throw new NotSupportedException();

        public IScreenSnapShot DeepCopy() => throw new NotSupportedException();
    }

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
    /// <para>The logic mirrors the diff+map half that used to live inline in
    /// <c>KosProcessorScreen.ReadChunk</c>: a reseed (forced, or a changed
    /// <see cref="IScreenBuffer"/> reference from a reboot/rebind, or the very
    /// first frame) produces a self-contained absolute-positioned full repaint
    /// (diff from a <see cref="FullRepaintBaseline"/> — an empty-buffer baseline
    /// that forces every current row to render regardless of its change tick;
    /// see that type for why <c>ScreenSnapShot.EmptyScreen</c> is wrong here —
    /// fresh mapper, prefixed with an explicit clear); otherwise a
    /// cursor-relative diff from the previous snapshot. The caller owns the "is
    /// there a live screen at all" guard.</para>
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
                // Full frame = diff from an EMPTY-buffer baseline (absolute-
                // positioned), NOT ScreenSnapShot.EmptyScreen: the latter's
                // fresh, newest-ticked rows make DiffFrom skip all pre-existing
                // content, blanking a reseed of a busy screen. See
                // FullRepaintBaseline's summary. Fresh mapper so the frame is
                // self-contained.
                _mapper = TerminalUnicodeMapper.TerminalMapperFactory("xterm");
                raw = current.DiffFrom(new FullRepaintBaseline(screen));
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

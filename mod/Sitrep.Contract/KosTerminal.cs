#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One frame of interactive-terminal output for a single kOS CPU, delivered on
/// the <c>kos.terminal.&lt;coreId&gt;</c> dynamic channel
/// (<c>Delivery.ReliableOrdered</c>, <c>DelayRole.Delayed</c> — the screen
/// downlink is vessel telemetry and rides gonogo's reveal clock exactly like
/// <c>vessel.flight</c>).
///
/// <para>The mod reads the CPU's live <c>kOS.Safe.Screen.ScreenSnapShot</c>,
/// diffs it against the last sent frame, and runs the diff through kOS's own
/// <c>kOS.UserIO.TerminalXtermMapper</c> — so <see cref="Chunk"/> is already
/// xterm-ready output bytes (VT100/xterm escape sequences), the same bytes
/// kOS's telnet server would have sent. The client writes <see cref="Chunk"/>
/// straight into xterm; there is no proxy and no telnet in the path.</para>
///
/// <para><see cref="FullRepaint"/> marks a self-contained repaint frame (the
/// client clears its terminal before applying <see cref="Chunk"/>). The mod
/// emits one on session open, on a new subscriber, and after a CPU
/// reboot/unload/CPU-switch, so a late-joining or reconnecting viewer — which
/// does NOT receive the sticky replay via <c>useStreamEvent</c> — always
/// resyncs from a clean full screen rather than an orphaned diff. Ordinary
/// incremental frames carry <c>FullRepaint = false</c>.</para>
///
/// <para><see cref="CoreId"/> echoes the emitting CPU's
/// <see cref="KosProcessorInfo.CoreId"/> so a client reading several CPUs can
/// disambiguate without parsing the topic string.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KosTerminalFrame
{
    /// <summary>The emitting CPU's <see cref="KosProcessorInfo.CoreId"/>.</summary>
    public int CoreId { get; set; }

    /// <summary>xterm-ready output bytes (already mapped from kOS's screen diff) to write into the terminal.</summary>
    public string Chunk { get; set; } = "";

    /// <summary>True for a self-contained repaint frame — the client clears the terminal before applying <see cref="Chunk"/>.</summary>
    public bool FullRepaint { get; set; }
}

/// <summary>
/// Args for <c>kos.terminal.open</c> — acquires the single-owner WRITE LEASE on
/// a CPU's shared terminal (kOS has one Interpreter/Screen per CPU; every
/// viewer shares it, so writes must be arbitrated). On success the mod starts
/// (or attaches) the screen downlink and emits a <see cref="KosTerminalFrame"/>
/// full repaint. A second <c>open</c> on a CPU already leased by a different
/// holder is REJECTED with <c>CommandErrorCode.ModeUnavailable</c> (no silent
/// steal) — the caller stays a read-only downlink viewer. Delivered DELAYED
/// (rides gonogo's uplink delay); the CPU-exists guard is re-checked at
/// delivery on the KSP main thread.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KosTerminalOpenArgs
{
    /// <summary>Target CPU, identified by its <see cref="KosProcessorInfo.CoreId"/>.</summary>
    public int CoreId { get; set; }

    /// <summary>
    /// Caller-generated, per-terminal-instance opaque lease token. The mod
    /// records it as the CPU's current write-lease holder; every subsequent
    /// <c>kos.keystroke</c>/<c>kos.terminal.resize</c>/<c>kos.terminal.close</c>
    /// must present the SAME token or is rejected. This is how the mod tells
    /// lease holders apart without a client identity on the command channel.
    /// </summary>
    public string LeaseToken { get; set; } = "";
}

/// <summary>
/// Args for <c>kos.keystroke</c> — types input into the leased CPU's terminal
/// via kOS's public, frozen-signature
/// <c>TermWindow.ProcessOneInputChar(ch, whichTelnet: null, forceQueue: true)</c>.
/// <see cref="Chars"/> may be a single character (char-by-char mode) or a whole
/// composed line (line-mode collapses N light-time round-trips to one).
/// Rejected with <c>CommandErrorCode.ModeUnavailable</c> if
/// <see cref="LeaseToken"/> does not match the CPU's current lease holder.
/// Delivered DELAYED — the keystroke reaches the craft at <c>UT + uplink</c>
/// under gonogo's SignalDelay, which is the sole delay authority (kOS's own
/// input path is immediate, so there is no double-counting).
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KosKeystrokeArgs
{
    /// <summary>Target CPU, identified by its <see cref="KosProcessorInfo.CoreId"/>.</summary>
    public int CoreId { get; set; }

    /// <summary>The write-lease token from <see cref="KosTerminalOpenArgs.LeaseToken"/>; must match the CPU's current holder.</summary>
    public string LeaseToken { get; set; } = "";

    /// <summary>The character(s) to type — one char, or a whole line in line-mode.</summary>
    public string Chars { get; set; } = "";
}

/// <summary>
/// Args for <c>kos.terminal.resize</c> — sets the CPU screen's column/row count
/// (kOS's NAWS equivalent), via the sanctioned resize input sequence
/// that reaches <c>ScreenBuffer.SetSize</c>. Rejected with
/// <c>CommandErrorCode.ModeUnavailable</c> on a lease-token mismatch. Delivered
/// DELAYED.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KosTerminalResizeArgs
{
    /// <summary>Target CPU, identified by its <see cref="KosProcessorInfo.CoreId"/>.</summary>
    public int CoreId { get; set; }

    /// <summary>The write-lease token; must match the CPU's current holder.</summary>
    public string LeaseToken { get; set; } = "";

    /// <summary>Desired column count.</summary>
    public int Cols { get; set; }

    /// <summary>Desired row count.</summary>
    public int Rows { get; set; }
}

/// <summary>
/// Args for <c>kos.terminal.close</c> — releases the write lease if
/// <see cref="LeaseToken"/> matches the CPU's current holder (a mismatched
/// token is a no-op ack, never steals). Once no holder remains the mod stops
/// polling that CPU's screen (the downlink is subscription-gated regardless).
/// Delivered DELAYED.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KosTerminalCloseArgs
{
    /// <summary>Target CPU, identified by its <see cref="KosProcessorInfo.CoreId"/>.</summary>
    public int CoreId { get; set; }

    /// <summary>The write-lease token to release; a non-matching token releases nothing.</summary>
    public string LeaseToken { get; set; } = "";
}

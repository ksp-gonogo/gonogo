namespace Sitrep.Contract;

/// <summary>
/// The single source of truth for the boundary a caller-stamped publish UT
/// must stay within to survive <c>Sitrep.Host.ChannelEngine.ProcessPublish</c>'s
/// stale-ut clamp: it clamps any <c>publish.Ut &gt; clock.Now() + Seconds</c>
/// back down to <c>clock.Now()</c> (strict <c>&gt;</c>, so landing exactly at
/// the boundary survives).
///
/// <para>That clamp is why <c>Gonogo.Kos.KosTerminalManager</c>'s per-frame
/// same-tick epsilon bump (<c>NextUt</c>, used to keep two frames published
/// within one Poll tick at strictly increasing <c>ValidAt</c> stamps rather
/// than colliding and silently corrupting the terminal's diff stream) works
/// at all: the bump has to land AT OR BELOW this tolerance, or every
/// epsilon-bumped frame gets clamped straight back to <c>clock.Now()</c>,
/// re-colliding with the frame it was meant to stay ahead of and reproducing
/// the original garble with no test catching it (see
/// <c>Sitrep.Host.IntegrationTests.ChannelEngineTests
/// .AnEpsilonBumpedSameTickPublishSurvivesTheStaleUtClampAndDeliversTwoDistinctFrames</c>).
/// Both sides derive from this ONE constant deliberately, instead of two
/// independently-hardcoded <c>1e-6</c> literals in different assemblies that
/// happen to agree today but have no compiler-enforced reason to keep
/// agreeing tomorrow.</para>
/// </summary>
public static class EnginePublishTolerance
{
    public const double Seconds = 1e-6;
}

using Gonogo.KerbcastUplink;
using Xunit;

namespace GonogoKerbcastUplink.Tests;

/// <summary>
/// The sidecar-liveness debounce state machine
/// <see cref="KerbcastUplink.Health"/> reads through. kerbcast auto-restarts
/// its video sidecar (up to 5 attempts, ~5s apart), during which
/// <c>SidecarAlive</c> reads false for one transient tick; these pin the
/// "two consecutive, not just one" contract that keeps a routine restart from
/// flapping the reported health.
/// </summary>
public class SidecarDeathDebouncerTests
{
    [Fact]
    public void StartsNotConfirmedDead()
    {
        var debouncer = new SidecarDeathDebouncer();
        Assert.False(debouncer.ConfirmedDead);
    }

    [Fact]
    public void StaysNotConfirmedDead_AfterASingleFalseTick()
    {
        var debouncer = new SidecarDeathDebouncer();

        debouncer.Observe(aliveNow: false);

        Assert.False(debouncer.ConfirmedDead);
    }

    [Fact]
    public void ConfirmsDead_AfterTwoConsecutiveFalseTicks()
    {
        var debouncer = new SidecarDeathDebouncer();

        debouncer.Observe(aliveNow: false);
        debouncer.Observe(aliveNow: false);

        Assert.True(debouncer.ConfirmedDead);
    }

    [Fact]
    public void ANonConsecutiveFalseTickDoesNotAccumulateTowardTheStreak()
    {
        // false, true, false: the "true" tick in the middle resets the
        // streak, so this is two false ticks total but never two
        // CONSECUTIVE ones. Must not confirm dead.
        var debouncer = new SidecarDeathDebouncer();

        debouncer.Observe(false);
        debouncer.Observe(true);
        debouncer.Observe(false);

        Assert.False(debouncer.ConfirmedDead);
    }

    [Fact]
    public void RecoversImmediately_OnceATickReportsAliveAgain_NoDebounceOnTheWayBack()
    {
        var debouncer = new SidecarDeathDebouncer();
        debouncer.Observe(false);
        debouncer.Observe(false);
        Assert.True(debouncer.ConfirmedDead);

        debouncer.Observe(true);

        Assert.False(debouncer.ConfirmedDead);
    }

    [Fact]
    public void StaysConfirmedDead_AcrossContinuedFalseTicksAfterConfirmation()
    {
        var debouncer = new SidecarDeathDebouncer();
        debouncer.Observe(false);
        debouncer.Observe(false);
        Assert.True(debouncer.ConfirmedDead);

        debouncer.Observe(false);
        debouncer.Observe(false);

        Assert.True(debouncer.ConfirmedDead);
    }
}

using System;
using Gonogo.KSP.CurrencyDelay;
using Xunit;

public class CurrencyDelayGuardTests
{
    [Fact]
    public void RunGuarded_is_active_during_the_action_and_inactive_after()
    {
        var guard = new CurrencyDelayGuard();
        Assert.False(guard.Active);

        bool activeDuring = false;
        guard.RunGuarded(() => activeDuring = guard.Active);

        Assert.True(activeDuring);
        Assert.False(guard.Active);
    }

    [Fact]
    public void RunGuarded_clears_active_even_when_the_action_throws()
    {
        var guard = new CurrencyDelayGuard();

        Assert.Throws<InvalidOperationException>(() =>
            guard.RunGuarded(() => throw new InvalidOperationException("boom")));

        Assert.False(guard.Active);
    }

    [Fact]
    public void RunGuarded_of_a_null_action_is_a_no_op()
    {
        var guard = new CurrencyDelayGuard();

        guard.RunGuarded(null!);

        Assert.False(guard.Active);
    }
}

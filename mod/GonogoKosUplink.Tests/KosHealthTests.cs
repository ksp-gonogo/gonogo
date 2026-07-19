using Gonogo.KosUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoKosUplink.Tests;

/// <summary>
/// <see cref="KosHealth"/> — the kOS uplink's <see cref="IUplinkHealthReporter"/>
/// state machine (mirrors <c>GonogoKerbcastUplink.Tests.KerbcastHealthTests</c>).
/// </summary>
public class KosHealthTests
{
    [Fact]
    public void ReportsUnavailableWithTheRegistrationReason_WhenTheVersionGuardFails()
    {
        var health = KosHealth.Evaluate(
            unavailableReason: "kOS version guard failed: kOSProcessor not found",
            sampledOnce: false, cpuCount: 0);

        Assert.Equal(UplinkHealthState.Unavailable, health.State);
        Assert.Equal("kOS version guard failed: kOSProcessor not found", health.Detail);
    }

    [Fact]
    public void UnavailableReasonWins_EvenIfLaterStateLooksHealthy()
    {
        var health = KosHealth.Evaluate(
            unavailableReason: "unsupported kOS version",
            sampledOnce: true, cpuCount: 3);

        Assert.Equal(UplinkHealthState.Unavailable, health.State);
        Assert.Equal("unsupported kOS version", health.Detail);
    }

    [Fact]
    public void ReportsDegraded_BeforeTheFirstSample()
    {
        var health = KosHealth.Evaluate(null, sampledOnce: false, cpuCount: -1);

        // Not Healthy — we would be claiming a CPU count we have not
        // observed. Not Unavailable — kOS registered fine.
        Assert.Equal(UplinkHealthState.Degraded, health.State);
        Assert.Contains("waiting for the first processor sample", health.Detail);
    }

    [Fact]
    public void ReportsDegraded_WhenNoCpuOnTheActiveVessel()
    {
        var health = KosHealth.Evaluate(null, sampledOnce: true, cpuCount: 0);

        Assert.Equal(UplinkHealthState.Degraded, health.State);
        Assert.Contains("no kOS CPU on active vessel", health.Detail);
    }

    [Fact]
    public void TreatsAnUnsetCpuCountAsDegraded_NotHealthy()
    {
        // -1 is the "never written" sentinel on the uplink's field. It must
        // not fall through to Healthy.
        var health = KosHealth.Evaluate(null, sampledOnce: true, cpuCount: -1);

        Assert.Equal(UplinkHealthState.Degraded, health.State);
    }

    [Fact]
    public void ReportsHealthyWithTheCpuCount_WhenCpusArePresent()
    {
        var health = KosHealth.Evaluate(null, sampledOnce: true, cpuCount: 2);

        Assert.Equal(UplinkHealthState.Healthy, health.State);
        Assert.Equal("2 CPUs", health.Detail);
    }

    [Fact]
    public void SingularisesTheOneCpuCase()
    {
        var health = KosHealth.Evaluate(null, sampledOnce: true, cpuCount: 1);

        Assert.Equal(UplinkHealthState.Healthy, health.State);
        Assert.Equal("1 CPU", health.Detail);
    }
}

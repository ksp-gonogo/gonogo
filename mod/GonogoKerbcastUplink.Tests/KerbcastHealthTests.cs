using Gonogo.KerbcastUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoKerbcastUplink.Tests;

/// <summary>
/// The mandatory healthcheck's state machine — the reason the kerbcast Uplink
/// exists (see <see cref="KerbcastHealth"/>'s doc and commit 45111e44).
///
/// <para>These assert the DISTINCTIONS, not just the enum: an operator looking
/// at a black camera feed must be able to tell "kerbcast isn't installed" from
/// "you're in the VAB" from "your craft has no camera on it", because those are
/// three different fixes.</para>
/// </summary>
public class KerbcastHealthTests
{
    [Fact]
    public void ReportsUnavailableWithTheRegistrationReason_WhenKerbcastIsAbsent()
    {
        var health = KerbcastHealth.Evaluate(
            unavailableReason: "kerbcast mod not installed (Kerbcast assembly not loaded)",
            sampledOnce: false, coreActive: false, cameraCount: 0);

        Assert.Equal(UplinkHealthState.Unavailable, health.State);
        Assert.Equal("kerbcast mod not installed (Kerbcast assembly not loaded)", health.Detail);
    }

    [Fact]
    public void UnavailableReasonWins_EvenIfLaterStateLooksHealthy()
    {
        // An uplink that went inert at registration never samples, but guard the
        // ordering explicitly: a stale-looking healthy count must never mask a
        // hard unavailability.
        var health = KerbcastHealth.Evaluate(
            unavailableReason: "unsupported kerbcast version",
            sampledOnce: true, coreActive: true, cameraCount: 4);

        Assert.Equal(UplinkHealthState.Unavailable, health.State);
        Assert.Equal("unsupported kerbcast version", health.Detail);
    }

    [Fact]
    public void ReportsDegraded_BeforeTheFirstSample()
    {
        var health = KerbcastHealth.Evaluate(null, sampledOnce: false, coreActive: false, cameraCount: -1);

        // Not Healthy — we would be claiming a camera count we have not observed.
        // Not Unavailable — kerbcast registered fine.
        Assert.Equal(UplinkHealthState.Degraded, health.State);
        Assert.Contains("waiting for the first sample", health.Detail);
    }

    [Fact]
    public void ReportsDegradedSceneProblem_WhenKerbcastsCoreIsNotRunning()
    {
        var health = KerbcastHealth.Evaluate(null, sampledOnce: true, coreActive: false, cameraCount: 0);

        Assert.Equal(UplinkHealthState.Degraded, health.State);
        Assert.Contains("capture core is not running", health.Detail);
    }

    [Fact]
    public void ReportsDegradedCraftProblem_WhenRunningButNoCamerasOnTheVessel()
    {
        var health = KerbcastHealth.Evaluate(null, sampledOnce: true, coreActive: true, cameraCount: 0);

        Assert.Equal(UplinkHealthState.Degraded, health.State);
        Assert.Contains("no camera parts", health.Detail);
    }

    [Fact]
    public void TheThreeDegradedCasesAreDistinguishable()
    {
        // The whole point: same state, three different answers to "why".
        var noScene = KerbcastHealth.Evaluate(null, true, coreActive: false, cameraCount: 0);
        var noCameras = KerbcastHealth.Evaluate(null, true, coreActive: true, cameraCount: 0);
        var noSample = KerbcastHealth.Evaluate(null, sampledOnce: false, coreActive: false, cameraCount: 0);

        Assert.Equal(UplinkHealthState.Degraded, noScene.State);
        Assert.Equal(UplinkHealthState.Degraded, noCameras.State);
        Assert.Equal(UplinkHealthState.Degraded, noSample.State);

        Assert.NotEqual(noScene.Detail, noCameras.Detail);
        Assert.NotEqual(noScene.Detail, noSample.Detail);
        Assert.NotEqual(noCameras.Detail, noSample.Detail);
    }

    [Fact]
    public void ReportsHealthyWithTheCameraCount_WhenRunningWithCameras()
    {
        var health = KerbcastHealth.Evaluate(null, sampledOnce: true, coreActive: true, cameraCount: 3);

        Assert.Equal(UplinkHealthState.Healthy, health.State);
        Assert.Equal("3 cameras", health.Detail);
    }

    [Fact]
    public void SingularisesTheOneCameraCase()
    {
        var health = KerbcastHealth.Evaluate(null, sampledOnce: true, coreActive: true, cameraCount: 1);

        Assert.Equal(UplinkHealthState.Healthy, health.State);
        Assert.Equal("1 camera", health.Detail);
    }

    [Fact]
    public void TreatsAnUnsetCameraCountAsDegraded_NotHealthy()
    {
        // -1 is the "never written" sentinel on the uplink's field. It must not
        // fall through to Healthy.
        var health = KerbcastHealth.Evaluate(null, sampledOnce: true, coreActive: true, cameraCount: -1);

        Assert.Equal(UplinkHealthState.Degraded, health.State);
    }
}

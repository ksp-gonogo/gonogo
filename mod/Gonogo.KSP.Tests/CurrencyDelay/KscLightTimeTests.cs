using Gonogo.KSP.CurrencyDelay;
using Sitrep.Host.Comms;
using Xunit;

public class KscLightTimeTests
{
    private static SignalDelayConfig Config(double lightSpeedScale) =>
        new SignalDelayConfig { Enabled = true, LightSpeedScale = lightSpeedScale };

    [Fact]
    public void DistanceMeters_computes_straight_line_euclidean_distance()
    {
        var a = new DelayPosition(0, 0, 0);
        var b = new DelayPosition(3, 4, 0);

        Assert.Equal(5.0, KscLightTimeMath.DistanceMeters(a, b));
    }

    [Fact]
    public void FromDistance_at_real_light_speed_matches_known_earth_moon_distance()
    {
        // ~384,400 km, real light-speed one-way is ~1.28s - a familiar
        // real-world sanity check for the c * LightSpeedScale arithmetic.
        var distanceMeters = 384_400_000.0;

        var seconds = KscLightTimeMath.FromDistance(distanceMeters, Config(1.0));

        Assert.NotNull(seconds);
        Assert.Equal(1.2822, seconds!.Value, 3);
    }

    [Fact]
    public void FromDistance_scales_inversely_with_LightSpeedScale()
    {
        var distanceMeters = SignalDelay.SpeedOfLightMetersPerSecond; // exactly 1 light-second at scale 1.0

        var atRealSpeed = KscLightTimeMath.FromDistance(distanceMeters, Config(1.0));
        var atDoubleSpeed = KscLightTimeMath.FromDistance(distanceMeters, Config(2.0));

        Assert.Equal(1.0, atRealSpeed);
        Assert.Equal(0.5, atDoubleSpeed);
    }

    [Fact]
    public void FromDistance_of_zero_distance_is_zero()
    {
        Assert.Equal(0.0, KscLightTimeMath.FromDistance(0.0, Config(1.0)));
    }

    [Fact]
    public void FromDistance_with_LightSpeedScale_zero_is_not_computable()
    {
        var seconds = KscLightTimeMath.FromDistance(1_000_000.0, Config(0.0));

        Assert.Null(seconds);
    }

    [Fact]
    public void FromDistance_with_delay_disabled_is_a_genuine_zero_not_null()
    {
        // Enabled=false means the delay FEATURE is off (link still live), a
        // real zero - distinct from LightSpeedScale<=0's "not computable"
        // null above. CommsCoreUplink.SignalDelayConfig's own default is
        // SignalDelayConfig.Off() = { Enabled = false, LightSpeedScale = 1.0 },
        // so this is the literal out-of-the-box case.
        var config = new SignalDelayConfig { Enabled = false, LightSpeedScale = 1.0 };

        var seconds = KscLightTimeMath.FromDistance(1_000_000.0, config);

        Assert.Equal(0.0, seconds);
    }

    [Fact]
    public void FromDistance_with_negative_LightSpeedScale_is_not_computable()
    {
        var seconds = KscLightTimeMath.FromDistance(1_000_000.0, Config(-1.0));

        Assert.Null(seconds);
    }

    [Fact]
    public void FromDistance_with_null_config_is_not_computable()
    {
        Assert.Null(KscLightTimeMath.FromDistance(1_000_000.0, null));
    }

    [Fact]
    public void Resolve_prefers_the_routed_delay_over_straight_line_when_both_are_available()
    {
        var subject = new DelayPosition(0, 0, 0);
        var ksc = new DelayPosition(1_000_000_000, 0, 0); // a straight-line distance that would NOT equal the routed value

        var result = KscLightTimeMath.Resolve(
            routedOneWaySeconds: 42.0,
            subjectPosition: subject,
            kscPosition: ksc,
            config: Config(1.0));

        Assert.Equal(42.0, result);
    }

    [Fact]
    public void Resolve_falls_back_to_straight_line_when_no_routed_delay_is_available()
    {
        var subject = new DelayPosition(0, 0, 0);
        var ksc = new DelayPosition(SignalDelay.SpeedOfLightMetersPerSecond, 0, 0);

        var result = KscLightTimeMath.Resolve(
            routedOneWaySeconds: null,
            subjectPosition: subject,
            kscPosition: ksc,
            config: Config(1.0));

        Assert.Equal(1.0, result);
    }

    [Fact]
    public void Resolve_at_ksc_position_is_zero()
    {
        var ksc = new DelayPosition(100, 200, 300);

        var result = KscLightTimeMath.Resolve(
            routedOneWaySeconds: null,
            subjectPosition: ksc,
            kscPosition: ksc,
            config: Config(1.0));

        Assert.Equal(0.0, result);
    }

    [Fact]
    public void Resolve_with_no_routed_delay_and_a_missing_position_is_not_computable()
    {
        var result = KscLightTimeMath.Resolve(
            routedOneWaySeconds: null,
            subjectPosition: null,
            kscPosition: new DelayPosition(0, 0, 0),
            config: Config(1.0));

        Assert.Null(result);
    }

    [Fact]
    public void Resolve_with_LightSpeedScale_zero_and_no_routed_delay_is_not_computable()
    {
        var subject = new DelayPosition(0, 0, 0);
        var ksc = new DelayPosition(1000, 0, 0);

        var result = KscLightTimeMath.Resolve(
            routedOneWaySeconds: null,
            subjectPosition: subject,
            kscPosition: ksc,
            config: Config(0.0));

        Assert.Null(result);
    }
}

using GonogoAvionicsUplink;
using Xunit;

public class AvionicsCaptureTests
{
    [Fact]
    public void Build_flags_no_go_when_mass_exceeds_limit()
    {
        var s = AvionicsCapture.Build(new AvionicsRaw { ControllableMassTons = 4.0, AvionicsActive = true }, vesselMassTons: 5.2);
        Assert.Equal(false, s["controllable"]);
        Assert.Equal(4.0, (double)s["controllableMassTons"]!, 6);
        Assert.Equal(5.2, (double)s["vesselMassTons"]!, 6);
        Assert.Equal(true, s["avionicsActive"]);
    }

    [Fact]
    public void Build_flags_go_when_within_limit()
    {
        var s = AvionicsCapture.Build(new AvionicsRaw { ControllableMassTons = 10.0, AvionicsActive = true }, vesselMassTons: 6.5);
        Assert.Equal(true, s["controllable"]);
    }

    [Fact]
    public void Build_flags_go_when_mass_equals_limit()
    {
        // ShouldLock locks only when vesselMass > maxMass, so mass == limit is GO.
        var s = AvionicsCapture.Build(new AvionicsRaw { ControllableMassTons = 5.0, AvionicsActive = true }, vesselMassTons: 5.0);
        Assert.Equal(true, s["controllable"]);
    }

    [Fact]
    public void Build_reports_no_avionics_when_raw_null()
    {
        var s = AvionicsCapture.Build(null, vesselMassTons: 6.5);
        Assert.Equal(false, s["avionicsActive"]);
        Assert.Null(s["controllableMassTons"]);
        Assert.Equal(false, s["controllable"]);
        Assert.Equal(6.5, (double)s["vesselMassTons"]!, 6);
    }
}

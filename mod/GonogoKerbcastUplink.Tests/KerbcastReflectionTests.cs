using Gonogo.KerbcastUplink;
using Xunit;

namespace GonogoKerbcastUplink.Tests;

/// <summary>
/// The arm's-length reflection surface onto kerbcast. This code is the LICENCE
/// BOUNDARY (kerbcast is CC-BY-NC-SA-4.0, so it must never be linked), and it
/// is designed to fail soft — which means a broken probe reads exactly like a
/// missing mod unless something pins it. These pin it.
/// </summary>
public class KerbcastReflectionTests
{
    private static KerbcastReflection Bind()
    {
        global::Kerbcast.KerbcastControl.Reset();
        return KerbcastReflection.ForAssembly(typeof(global::Kerbcast.KerbcastControl).Assembly);
    }

    [Fact]
    public void ProbeFindsNothing_WhenKerbcastIsNotLoaded()
    {
        // The real probe scans loaded assemblies for one named "Kerbcast". The
        // test assembly is not it (the stand-ins above only share a NAMESPACE),
        // so this is a genuine "mod not installed" reading.
        Assert.Null(KerbcastReflection.Probe());
    }

    [Fact]
    public void ResolvesTheControlSurface_WhenTheShapeMatches()
    {
        var kerbcast = Bind();

        Assert.True(kerbcast.IsAvailable);
        Assert.Null(kerbcast.Reason);
    }

    [Fact]
    public void ReportsAReason_WhenTheAssemblyLacksKerbcastsSurface()
    {
        // An assembly with no Kerbcast.KerbcastControl at all — stands in for a
        // kerbcast version whose surface moved. Must degrade to a REASON, not a
        // throw and not silence.
        var kerbcast = KerbcastReflection.ForAssembly(typeof(string).Assembly);

        Assert.False(kerbcast.IsAvailable);
        Assert.NotNull(kerbcast.Reason);
        Assert.Contains("KerbcastControl", kerbcast.Reason);
    }

    [Fact]
    public void ReadsIsActiveOffTheStaticProperty()
    {
        var kerbcast = Bind();
        Assert.True(kerbcast.IsActive());

        global::Kerbcast.KerbcastControl.ActiveResult = false;
        Assert.False(kerbcast.IsActive());
    }

    [Fact]
    public void ReadsEveryCameraViewField()
    {
        var kerbcast = Bind();
        var part = new object();
        global::Kerbcast.KerbcastControl.Cameras.Add(new global::Kerbcast.KerbcastCameraView
        {
            FlightId = 42u,
            PartFlightId = 7u,
            CameraName = "NavCam",
            PartName = "dockingPort2",
            PartTitle = "Clamp-O-Tron Docking Port",
            SupportsZoom = true,
            SupportsPan = false,
            Fov = 60f,
            FovMin = 20f,
            FovMax = 90f,
            PanYaw = 1f,
            PanPitch = 2f,
            PanYawMin = -135f,
            PanYawMax = 135f,
            PanPitchMin = -45f,
            PanPitchMax = 60f,
            Part = part,
        });

        var views = kerbcast.CamerasFor(new object());
        var view = kerbcast.ReadView(Assert.Single(views));

        Assert.Equal(42u, view.FlightId);
        Assert.Equal(7u, view.PartFlightId);
        Assert.Equal("NavCam", view.CameraName);
        Assert.Equal("dockingPort2", view.PartName);
        Assert.Equal("Clamp-O-Tron Docking Port", view.PartTitle);
        Assert.True(view.SupportsZoom);
        Assert.False(view.SupportsPan);
        Assert.Equal(60.0, view.Fov);
        Assert.Equal(20.0, view.FovMin);
        Assert.Equal(90.0, view.FovMax);
        Assert.Equal(1.0, view.PanYaw);
        Assert.Equal(2.0, view.PanPitch);
        Assert.Equal(-135.0, view.PanYawMin);
        Assert.Equal(135.0, view.PanYawMax);
        Assert.Equal(-45.0, view.PanPitchMin);
        Assert.Equal(60.0, view.PanPitchMax);
        // The Part handle must survive as an opaque object — it is what the
        // docking detector reads ModuleDockingNode off in-game.
        Assert.Same(part, view.Part);
    }

    [Fact]
    public void CamerasForIsEmpty_WhenThereIsNoVessel()
    {
        var kerbcast = Bind();
        Assert.Empty(kerbcast.CamerasFor(null));
    }

    [Fact]
    public void ForwardsSetFovToKerbcast_AndCarriesItsRejection()
    {
        var kerbcast = Bind();

        Assert.True(kerbcast.SetFov(42u, 35f));
        Assert.Equal((42u, 35f), global::Kerbcast.KerbcastControl.LastSetFov);

        global::Kerbcast.KerbcastControl.SetFovResult = false;
        Assert.False(kerbcast.SetFov(42u, 35f));
    }

    [Fact]
    public void ForwardsSetPanToKerbcast_AndCarriesItsRejection()
    {
        var kerbcast = Bind();

        Assert.True(kerbcast.SetPan(42u, 10f, -5f));
        Assert.Equal((42u, 10f, -5f), global::Kerbcast.KerbcastControl.LastSetPan);

        global::Kerbcast.KerbcastControl.SetPanResult = false;
        Assert.False(kerbcast.SetPan(42u, 10f, -5f));
    }

    [Fact]
    public void CommandsFailSoft_WhenTheSurfaceIsMissing()
    {
        // No KerbcastControl on this assembly — must return false, never throw.
        var kerbcast = KerbcastReflection.ForAssembly(typeof(string).Assembly);

        Assert.False(kerbcast.SetFov(1u, 50f));
        Assert.False(kerbcast.SetPan(1u, 0f, 0f));
        Assert.False(kerbcast.IsActive());
        Assert.Empty(kerbcast.CamerasFor(new object()));
    }
}

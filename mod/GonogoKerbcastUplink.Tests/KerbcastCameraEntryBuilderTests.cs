using Gonogo.KerbcastUplink;
using Xunit;

namespace GonogoKerbcastUplink.Tests;

/// <summary>
/// The <c>kerbcast.cameras</c> wire mapping. These pin two things that drift
/// silently otherwise: the CLEAN FULL NAMES the project mandates
/// (<c>fieldOfView</c>, never kerbcast's own <c>fov</c>), and R7 typed absence
/// (an unreadable member travels as null, never as a 0 that reads like a real
/// measurement).
/// </summary>
public class KerbcastCameraEntryBuilderTests
{
    private static KerbcastView FullView() => new KerbcastView
    {
        FlightId = 42u,
        PartFlightId = 7u,
        CameraName = "NavCam",
        PartName = "dockingPort2",
        PartTitle = "Clamp-O-Tron Docking Port",
        SupportsZoom = true,
        SupportsPan = false,
        Fov = 60.0,
        FovMin = 20.0,
        FovMax = 90.0,
        PanYaw = 1.0,
        PanPitch = 2.0,
        PanYawMin = -135.0,
        PanYawMax = 135.0,
        PanPitchMin = -45.0,
        PanPitchMax = 60.0,
    };

    [Fact]
    public void UsesCleanFullNames_NotKerbcastsAbbreviations()
    {
        var entry = KerbcastCameraEntryBuilder.Build(FullView(), default, "vessel:abc");

        // The contract's vocabulary, not a passthrough of the upstream mod's.
        Assert.True(entry.ContainsKey("fieldOfView"));
        Assert.True(entry.ContainsKey("fieldOfViewMinimum"));
        Assert.True(entry.ContainsKey("fieldOfViewMaximum"));
        Assert.True(entry.ContainsKey("panYawMinimum"));
        Assert.True(entry.ContainsKey("panPitchMaximum"));

        Assert.False(entry.ContainsKey("fov"));
        Assert.False(entry.ContainsKey("fovMin"));
        Assert.False(entry.ContainsKey("fovMax"));
        Assert.False(entry.ContainsKey("panYawMin"));
        Assert.False(entry.ContainsKey("panPitchMax"));
    }

    [Fact]
    public void MapsEveryValueOntoItsContractKey()
    {
        var entry = KerbcastCameraEntryBuilder.Build(FullView(), default, "vessel:abc");

        Assert.Equal(42u, entry["cameraId"]);
        Assert.Equal(7u, entry["partId"]);
        Assert.Equal("NavCam", entry["cameraName"]);
        Assert.Equal("dockingPort2", entry["partName"]);
        Assert.Equal("Clamp-O-Tron Docking Port", entry["partTitle"]);
        Assert.Equal("vessel:abc", entry["vesselId"]);
        Assert.Equal(true, entry["supportsZoom"]);
        Assert.Equal(false, entry["supportsPan"]);
        Assert.Equal(60.0, entry["fieldOfView"]);
        Assert.Equal(20.0, entry["fieldOfViewMinimum"]);
        Assert.Equal(90.0, entry["fieldOfViewMaximum"]);
        Assert.Equal(1.0, entry["panYaw"]);
        Assert.Equal(2.0, entry["panPitch"]);
        Assert.Equal(-135.0, entry["panYawMinimum"]);
        Assert.Equal(135.0, entry["panYawMaximum"]);
        Assert.Equal(-45.0, entry["panPitchMinimum"]);
        Assert.Equal(60.0, entry["panPitchMaximum"]);
    }

    [Fact]
    public void CarriesCameraIdAndPartIdSeparately()
    {
        // kerbcast's flightId is a SYNTHETIC hash for the 2nd+ camera module on
        // a multi-camera part, so it is not a part identity. partId is the real
        // KSP Part.flightID and the join key onto vessel.parts. Conflating them
        // would silently break that join.
        var view = FullView();
        view.FlightId = 999u;
        view.PartFlightId = 7u;

        var entry = KerbcastCameraEntryBuilder.Build(view, default, "vessel:abc");

        Assert.Equal(999u, entry["cameraId"]);
        Assert.Equal(7u, entry["partId"]);
    }

    [Fact]
    public void PublishesTypedAbsence_ForUnreadableMembers()
    {
        // A view where kerbcast's surface gave us nothing.
        var entry = KerbcastCameraEntryBuilder.Build(new KerbcastView(), default, null);

        Assert.Null(entry["cameraId"]);
        Assert.Null(entry["fieldOfView"]);
        Assert.Null(entry["panYawMinimum"]);
        Assert.Null(entry["supportsPan"]);
        Assert.Null(entry["vesselId"]);
        // Crucially NOT 0.0 / false — those would read as real measurements.
    }

    [Fact]
    public void CarriesDerivedDockingFacts_WhenThePartHasADockingNode()
    {
        var docking = new DockingCameraFacts
        {
            IsDockingCamera = true,
            NodeType = "size1",
            State = "Ready",
        };

        var entry = KerbcastCameraEntryBuilder.Build(FullView(), docking, "vessel:abc");

        Assert.Equal(true, entry["isDockingCamera"]);
        Assert.Equal("size1", entry["dockingPortNodeType"]);
        Assert.Equal("Ready", entry["dockingPortState"]);
    }

    [Fact]
    public void DistinguishesNotADockingCamera_FromCouldNotDetermine()
    {
        // This distinction is the whole reason DockingCameraFacts is nullable.
        var definitelyNot = KerbcastCameraEntryBuilder.Build(
            FullView(), new DockingCameraFacts { IsDockingCamera = false }, "vessel:abc");
        var unknown = KerbcastCameraEntryBuilder.Build(FullView(), default, "vessel:abc");

        Assert.Equal(false, definitelyNot["isDockingCamera"]);
        Assert.Null(unknown["isDockingCamera"]);
    }

    [Fact]
    public void DoesNotInferDockingFromThePartTitle()
    {
        // A part titled "Clamp-O-Tron Docking Port" with NO docking node read
        // must NOT be reported as a docking camera. Title-sniffing is exactly
        // the guess this uplink exists to replace — it false-positives on any
        // part someone named "Docking Bay Floodlight".
        var view = FullView();
        view.PartTitle = "Clamp-O-Tron Docking Port";

        var entry = KerbcastCameraEntryBuilder.Build(
            view, new DockingCameraFacts { IsDockingCamera = false }, "vessel:abc");

        Assert.Equal(false, entry["isDockingCamera"]);
    }

    [Fact]
    public void EmitsExactlyTheContractsFieldSet()
    {
        // Guards against a field being added to the builder but not the contract
        // type (or vice versa) — they must agree field for field.
        var entry = KerbcastCameraEntryBuilder.Build(FullView(), default, "vessel:abc");

        var expected = new[]
        {
            "cameraId", "partId", "cameraName", "partName", "partTitle", "vesselId",
            "supportsZoom", "supportsPan",
            "fieldOfView", "fieldOfViewMinimum", "fieldOfViewMaximum",
            "panYaw", "panPitch",
            "panYawMinimum", "panYawMaximum", "panPitchMinimum", "panPitchMaximum",
            "isDockingCamera", "dockingPortNodeType", "dockingPortState",
        };

        Assert.Equal(expected.Length, entry.Count);
        foreach (var key in expected)
        {
            Assert.True(entry.ContainsKey(key), $"missing wire key: {key}");
        }
    }
}

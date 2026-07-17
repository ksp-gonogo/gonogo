using System.Collections.Generic;
using Gonogo.KerbcastUplink;
using Xunit;

namespace Kerbcast
{
    // ─────────────────────────────────────────────────────────────────────────
    // STAND-INS for kerbcast's public integration seam.
    //
    // These are NOT kerbcast's code — not a copy, not a derivation. They are
    // independently written test doubles that carry the same member SHAPE
    // (names/arity/types) that KerbcastReflection reflects against, so the
    // arm's-length reflection path can be exercised without a KSP install and
    // without linking kerbcast's CC-BY-NC-SA-4.0 assembly. Shape compatibility
    // is not copyright-relevant; this is the same thing a mock does.
    //
    // They deliberately live in namespace `Kerbcast` because KerbcastReflection
    // resolves types by their full name.
    // ─────────────────────────────────────────────────────────────────────────

    public sealed class KerbcastCameraView
    {
        public uint FlightId;
        public uint PartFlightId;
        public string? CameraName;
        public string? PartName;
        public string? PartTitle;
        public bool SupportsZoom;
        public bool SupportsPan;
        public float Fov, FovMin, FovMax;
        public float PanYaw, PanPitch;
        public float PanYawMin, PanYawMax, PanPitchMin, PanPitchMax;
        public object? Part;
    }

    public static class KerbcastControl
    {
        public static bool ActiveResult = true;
        public static List<KerbcastCameraView> Cameras = new();
        public static bool SetFovResult = true;
        public static bool SetPanResult = true;
        public static (uint FlightId, float Fov)? LastSetFov;
        public static (uint FlightId, float Yaw, float Pitch)? LastSetPan;

        public static bool IsActive => ActiveResult;

        public static IReadOnlyList<KerbcastCameraView> CamerasFor(object vessel) => Cameras;

        public static KerbcastCameraView? ViewOf(uint flightId) => null;

        public static bool SetFov(uint flightId, float fov)
        {
            LastSetFov = (flightId, fov);
            return SetFovResult;
        }

        public static bool SetPan(uint flightId, float yaw, float pitch)
        {
            LastSetPan = (flightId, yaw, pitch);
            return SetPanResult;
        }

        public static void Reset()
        {
            ActiveResult = true;
            Cameras = new List<KerbcastCameraView>();
            SetFovResult = true;
            SetPanResult = true;
            LastSetFov = null;
            LastSetPan = null;
        }
    }
}

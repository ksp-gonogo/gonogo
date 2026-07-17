#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

// ─────────────────────────────────────────────────────────────────────────────
// kerbcast Topic payloads — the CONTROL plane only.
//
// kerbcast (the camera-streaming mod, ~/personal/kerbcam) splits cleanly in two:
//
//   • MEDIA — H.264 video, sidecar -> browser over WebRTC, negotiated by
//     HTTP POST /offer and steered on the "kerbcast-control" data channel.
//     This Uplink does NOT carry video and never will: a keyframed,
//     UT-indexed telemetry channel is the wrong shape for a 30fps encoded
//     stream, and the WebRTC path already works. The client's delay authority
//     (`useViewClock()`) is what keeps that media aligned with telemetry —
//     see .superpowers/sdd/u4-kerbcast-report.md. Nothing here disturbs it.
//
//   • CONTROL — "what cameras exist, what can they do, which are docking
//     cameras, is the mod healthy, point that camera there". That is ordinary
//     Sitrep telemetry + commands, and it is what this Uplink owns.
//
// The split matters because the control plane is the half that must obey
// signal delay, must report health through `system.uplinks`, and must be
// readable by a station screen that never talks to the sidecar directly.
//
// This file is TYPING-ONLY (see SitrepTopicAttribute's doc): it mirrors, field
// for field, the serialized shape GonogoKerbcastUplink builds by hand as
// Dictionary<string, object?> (same camelCase wire keys via
// RtConfig.CamelCaseForProperties). Adding it changes no wire bytes.
//
// Naming: clean full names, never kerbcast's internal wire keys — `fieldOfView`
// not `fov`, `panYawMinimum` not `panYawMin`. The Uplink's contract is gonogo's
// vocabulary, not a passthrough of the upstream mod's abbreviations.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// One kerbcast camera as it appears on the <c>kerbcast.cameras</c> channel —
/// a bare JSON array of these.
///
/// <para>Sourced by reflecting the running kerbcast plugin's public
/// <c>Kerbcast.KerbcastControl</c> static facade (never a compile-time
/// reference — kerbcast is CC-BY-NC-SA-4.0, so the arm's-length reflection
/// pattern is mandatory; see <c>GonogoKerbcastUplink.csproj</c>'s header).
/// Every field below is read off kerbcast's <c>KerbcastCameraView</c>, except
/// the docking fields, which this Uplink DERIVES from the stock KSP
/// <c>Part</c> the view carries.</para>
///
/// <para>R7 typed-absence discipline: every field is nullable. A camera whose
/// pan bounds could not be read carries <c>null</c>, never a 0 that a consumer
/// would read as a real "centred, no travel" limit.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("kerbcast.cameras", isArray: true)]
public class KerbcastCameraEntry
{
    /// <summary>
    /// kerbcast's own camera handle (<c>KerbcastCameraView.FlightId</c>) — the
    /// id every kerbcast command and the WebRTC <c>subscribe</c> take. NOTE
    /// this is NOT reliably a KSP part id: kerbcast synthesises a hash for the
    /// 2nd+ camera module on a multi-camera part. Use <see cref="PartId"/> when
    /// you want part identity; use this when you want to talk to kerbcast.
    /// </summary>
    public long? CameraId { get; set; }

    /// <summary>
    /// The real stock-KSP <c>Part.flightID</c> the camera is mounted on
    /// (<c>KerbcastCameraView.PartFlightId</c>) — the join key onto
    /// <c>vessel.parts</c>. Null when the camera's part could not be read.
    /// </summary>
    public long? PartId { get; set; }

    /// <summary>
    /// kerbcast's camera name. NOT unique — Hullcam's docking-port patch names
    /// every docking-port camera "NavCam", which is precisely why
    /// <see cref="IsDockingCamera"/> is derived from the part's modules rather
    /// than sniffed from this string.
    /// </summary>
    public string? CameraName { get; set; }

    /// <summary>The part's internal name (<c>Part.partInfo.name</c>), e.g. <c>DC.TurretCam</c>.</summary>
    public string? PartName { get; set; }

    /// <summary>The part's display title, e.g. <c>Clamp-O-Tron Docking Port Jr.</c>.</summary>
    public string? PartTitle { get; set; }

    /// <summary>The vessel this camera is on, as <c>vessel:&lt;guid&gt;</c>. Null when unreadable.</summary>
    public string? VesselId { get; set; }

    /// <summary>Whether the camera can zoom — kerbcast runtime-detects this from the part type.</summary>
    public bool? SupportsZoom { get; set; }

    /// <summary>
    /// Whether the camera can pan. kerbcast derives this from a hardcoded
    /// per-part capability table, so it is false for most stock camera parts.
    /// </summary>
    public bool? SupportsPan { get; set; }

    /// <summary>Current field of view, degrees.</summary>
    public double? FieldOfView { get; set; }

    /// <summary>Narrowest field of view the camera allows, degrees (fully zoomed in).</summary>
    public double? FieldOfViewMinimum { get; set; }

    /// <summary>Widest field of view the camera allows, degrees (fully zoomed out).</summary>
    public double? FieldOfViewMaximum { get; set; }

    /// <summary>Current pan yaw, degrees.</summary>
    public double? PanYaw { get; set; }

    /// <summary>Current pan pitch, degrees.</summary>
    public double? PanPitch { get; set; }

    /// <summary>Minimum pan yaw the camera allows, degrees.</summary>
    public double? PanYawMinimum { get; set; }

    /// <summary>Maximum pan yaw the camera allows, degrees.</summary>
    public double? PanYawMaximum { get; set; }

    /// <summary>Minimum pan pitch the camera allows, degrees.</summary>
    public double? PanPitchMinimum { get; set; }

    /// <summary>Maximum pan pitch the camera allows, degrees.</summary>
    public double? PanPitchMaximum { get; set; }

    /// <summary>
    /// Whether this camera is mounted on a docking port — the operator-facing
    /// question "which of my cameras can I dock with".
    ///
    /// <para>DERIVED, not reported by kerbcast: kerbcast has no docking concept
    /// on its wire at all. This Uplink reads the stock
    /// <c>ModuleDockingNode</c> off the camera's own <c>Part</c> (the part
    /// handle kerbcast's control facade already carries) and answers from the
    /// part's actual modules. That is why it is trustworthy where sniffing
    /// <see cref="PartTitle"/> for the word "Docking" is not.</para>
    ///
    /// <para>Null means "could not determine" (the part was unreadable) —
    /// distinct from <c>false</c>, "read the part, it has no docking node".</para>
    /// </summary>
    public bool? IsDockingCamera { get; set; }

    /// <summary>
    /// The docking node's <c>nodeType</c> (e.g. <c>size1</c>, <c>size2</c>) when
    /// <see cref="IsDockingCamera"/> is true — what this port can mate with.
    /// Null for a non-docking camera.
    /// </summary>
    public string? DockingPortNodeType { get; set; }

    /// <summary>
    /// The docking node's live <c>state</c> (e.g. <c>Ready</c>, <c>Docked</c>,
    /// <c>Acquire</c>) when <see cref="IsDockingCamera"/> is true. Null for a
    /// non-docking camera.
    /// </summary>
    public string? DockingPortState { get; set; }
}

/// <summary>
/// Args for the <c>kerbcast.setFieldOfView</c> command — zoom one camera.
/// Delayed like any other craft command: a zoom is an instruction to hardware
/// on the vessel, so it rides the signal-delay Courier.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbcastSetFieldOfViewArgs
{
    /// <summary>Target camera, identified by its <see cref="KerbcastCameraEntry.CameraId"/>.</summary>
    public long CameraId { get; set; }

    /// <summary>Requested field of view, degrees. kerbcast clamps to the camera's own bounds.</summary>
    public double FieldOfView { get; set; }
}

/// <summary>
/// Args for the <c>kerbcast.setPan</c> command — aim one camera. Absolute
/// degrees, matching kerbcast's own <c>SetPan</c> facade (not a rate).
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class KerbcastSetPanArgs
{
    /// <summary>Target camera, identified by its <see cref="KerbcastCameraEntry.CameraId"/>.</summary>
    public long CameraId { get; set; }

    /// <summary>Requested yaw, degrees. kerbcast clamps to the camera's own bounds.</summary>
    public double Yaw { get; set; }

    /// <summary>Requested pitch, degrees. kerbcast clamps to the camera's own bounds.</summary>
    public double Pitch { get; set; }
}

using System.Collections.Generic;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

// ─────────────────────────────────────────────────────────────────────────────
// SCANsat Topic payloads.
//
// The GonogoScansatUplink (mod/GonogoScansatUplink/) publishes two STATIC
// SCANsat Topics whose payload shape the client codes against:
//
//   • scansat.available        — a BARE JSON boolean (`true`/`false`). The
//     uplink source is `_ => true`, so the wire is a naked boolean, NOT an
//     object. There is deliberately NO wrapper contract type for it: a
//     `{ available: bool }` POCO would MISREPRESENT the bare-bool wire (unlike
//     `robotics.available`, whose PROVIDER genuinely emits an object). It is a
//     hand-declared primitive Topic in the SDK (`mod/sitrep-sdk/src/topics.ts`
//     maps it to `boolean`) and stays that way — this file adds no type for it.
//
//   • scansat.scanningVessels  — a BARE JSON array. Its element shape is the
//     `ScanningVesselEntry` below, tagged `[SitrepTopic(..., isArray: true)]`
//     so codegen can replace the SDK's currently hand-declared `unknown[]`
//     (the P0.5-logged gap this build closes) with `ScanningVesselEntry[]`.
//
// This file is TYPING-ONLY (see SitrepTopicAttribute's doc): it mirrors, field
// for field, the exact serialized shape the uplink already builds by hand as
// `Dictionary<string, object?>` in `Gonogo.ScansatUplink.ScanningVessels.Build`
// (same camelCase wire keys via RtConfig.CamelCaseForProperties). Adding it
// changes no wire bytes — the wire is written by JsonWriter walking the
// uplink's live value tree; these POCOs just give codegen a concrete name.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// One scanner module on a <c>scansat.scanningVessels</c> vessel — mirrors
/// SCANsat's public <c>SCANcontroller.SCANsensor</c> fields
/// (<c>SCANcontroller.cs:32-53</c>). <see cref="Type"/> is the numeric
/// <c>SCANtype</c> bit value (AltimetryLoRes=1 / AltimetryHiRes=2 / Biome=8 /
/// Anomaly=16 / ResourceLoRes=128 / ResourceHiRes=256); a single vessel can
/// carry scanners of several types. <see cref="InRange"/> means the vessel is
/// between <see cref="MinAlt"/> and <see cref="MaxAlt"/>;
/// <see cref="BestRange"/> means it is at the high-fidelity
/// <see cref="BestAlt"/>. Below <c>minAlt</c> or above <c>maxAlt</c> both are
/// false and the scanner is idle.
///
/// <para>Every field nullable to mirror the permissive-on-absence convention
/// the other contract types use — a live entry always carries concrete
/// values.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ScanSensorEntry
{
    public int? Type { get; set; }

    public double? Fov { get; set; }

    public double? MinAlt { get; set; }

    public double? MaxAlt { get; set; }

    public double? BestAlt { get; set; }

    public bool? InRange { get; set; }

    public bool? BestRange { get; set; }
}

/// <summary>
/// SCANsat's combined per-vessel <c>trackColor</c> (a stock <c>Color32</c>,
/// 0-255 channels) — reused as the tint for the minimap / MapView footprint so
/// the overlay matches the in-game ground track.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ScanTrackColor
{
    public int? R { get; set; }

    public int? G { get; set; }

    public int? B { get; set; }

    public int? A { get; set; }
}

/// <summary>
/// One entry in the <c>scansat.scanningVessels</c> channel payload — a single
/// vessel SCANsat is tracking. SCANsat tracks UNLOADED vessels too, so this
/// list is CROSS-VESSEL by design: a satellite mapping Kerbin and a probe
/// orbiting Mun both appear at once. The channel payload is a BARE ARRAY of
/// these (<c>ScanningVesselEntry[]</c>) or <c>null</c> — never a wrapper
/// object — so the Topic tag sits on this element type with
/// <c>IsArray = true</c>.
///
/// <para><see cref="SubLatitude"/> / <see cref="SubLongitude"/> are the
/// sub-satellite ground point (SCANsat's <c>SCANvessel.latitude</c> /
/// <c>longitude</c>); the scanning footprint is a band centred there.
/// <see cref="GroundTrackWidthDeg"/> is the per-side LATITUDE half-width from
/// SCANsat's <c>getFOV</c> replication (see
/// <c>Gonogo.ScansatUplink.GroundTrackFov</c>);
/// <see cref="GroundTrackLonHalfDeg"/> is the per-side LONGITUDE half-width
/// (<c>widthDeg / cos(|subLat|)</c>, capped at 120°, matching SCANsat's
/// coverage-paint widening). Both are <c>null</c> when the vessel currently has
/// no in-range sensors (nothing to paint).</para>
///
/// <para><b>Typing-only mirror</b> of
/// <c>Gonogo.ScansatUplink.ScanningVessels.Build</c> — see this file's header
/// for the "no wire change, all fields nullable" rationale.</para>
/// </summary>
[SitrepContract]
[SitrepTopic("scansat.scanningVessels", isArray: true)]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ScanningVesselEntry
{
    public string? VesselId { get; set; }

    public string? VesselName { get; set; }

    public string? Body { get; set; }

    public double? SubLatitude { get; set; }

    public double? SubLongitude { get; set; }

    public double? Altitude { get; set; }

    public List<ScanSensorEntry>? Sensors { get; set; }

    public double? GroundTrackWidthDeg { get; set; }

    public double? GroundTrackLonHalfDeg { get; set; }

    public ScanTrackColor? TrackColor { get; set; }
}

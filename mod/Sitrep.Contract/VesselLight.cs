#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.light</c> Topic payload: whether the active craft is in
/// sunlight now, and the next two instants at which that changes, for a
/// widget that warps to sunrise or sunset or plans around a night pass.
///
/// <para>The star counts as hidden when a body between it and the craft covers
/// its centre. A craft in orbit is swept along its patched conic; a landed or
/// splashed craft is carried round by its body's rotation. The instants are
/// universal times, so they hold wherever they are read and need no
/// reckoning between samples.</para>
///
/// <para>Whenever no sound answer exists (an open orbit, an orbit of the star
/// itself, no body table yet) the payload is absent or its instants are null
/// with <see cref="Basis"/> saying <c>withheld</c>, never a guess.</para>
/// <internal>
/// Made by Sitrep.Propagation.Visibility.LightPrediction over the elected
/// propagation provider and stamped by Gonogo.KSP.KspHost, the same seam the
/// closest approach of <c>vessel.target</c> uses.
/// </internal>
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.light")]
public class VesselLight
{
    /// <summary>
    /// True while the star is above the craft's horizon and no body covers it,
    /// false in shadow. Null when the geometry could not be solved this tick.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? Sunlit { get; set; }

    /// <summary>
    /// The next universal time the craft leaves shadow, or null when it stays
    /// lit through <see cref="SweptToUt"/>, is lit now and no sunrise is
    /// predicted, or no prediction was made.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? NextSunriseUt { get; set; }

    /// <summary>
    /// The next universal time the craft enters shadow, or null when it stays
    /// lit through <see cref="SweptToUt"/> or no prediction was made.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? NextSunsetUt { get; set; }

    /// <summary>The last universal time the search reached. A null instant means no change before it.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double SweptToUt { get; set; }

    /// <summary>
    /// What the instants rest on: <c>orbit</c> (the craft swept along its
    /// orbit), <c>surface</c> (the craft carried round by its body's rotation)
    /// or <c>withheld</c> (no sound prediction, so both instants are null).
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public string Basis { get; set; } = "withheld";
}

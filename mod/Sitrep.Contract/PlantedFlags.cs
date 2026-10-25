#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One planted flag, on the <c>surface.sites</c> Topic: the named site a kerbal
/// has claimed on the surface of a body. The payload is a bare array with one entry
/// per flag in the save, empty when none is planted, and it is delayed like the
/// vessel it is recorded from, so a flag appears at a command centre only once the
/// word of it has had time to reach it.
///
/// <para>A flag has no radio and is not on <c>trackingStation.catalog</c>.</para>
/// <internal>
/// Read off the vessels the game types <c>Flag</c>; the plaque and planter come
/// from the <c>FlagSite</c> module, live for a loaded flag and from the saved module
/// for one that is not.
/// </internal>
/// </summary>
/// <category>Surface</category>
[SitrepContract]
[SitrepTopic("surface.sites", isArray: true, DisplayName = "Surface sites")]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PlantedFlag
{
    /// <summary>The flag's own vessel id.</summary>
    [SitrepUnit(Units.Id)]
    public string? SiteId { get; set; }

    /// <summary>The name the kerbal gave the site.</summary>
    [SitrepUnit(Units.Text)]
    public string? Name { get; set; }

    /// <summary>The name of the body the flag stands on.</summary>
    [SitrepUnit(Units.Text)]
    public string? Body { get; set; }

    /// <summary>Body-fixed latitude of the flag in degrees.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Latitude { get; set; }

    /// <summary>Body-fixed longitude of the flag in degrees, wrapped to (-180, 180].</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Longitude { get; set; }

    /// <summary>Universal Time the flag was planted. Null when it could not be read.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? PlantedAt { get; set; }

    /// <summary>The name of the kerbal who planted it. Null when the flag's module could not be read, live or saved.</summary>
    [SitrepUnit(Units.Text)]
    public string? PlantedBy { get; set; }

    /// <summary>The text on the site's plaque. Null when the flag's module could not be read, live or saved, and empty when it has none.</summary>
    [SitrepUnit(Units.Text)]
    public string? Plaque { get; set; }
}

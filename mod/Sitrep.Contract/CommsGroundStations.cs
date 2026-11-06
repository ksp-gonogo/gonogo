#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// One ground station of the comms network: where it stands on its body, under
/// the name the route and the network use for it.
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommsGroundStation
{
    /// <summary>
    /// The station's join key in the same id space as <see cref="CommsNetworkNode.Id"/>
    /// and <see cref="CommsHop.From"/>, so a marker can be matched to the
    /// station a route ends at.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>The station's name as the player reads it in game.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary>The <c>bodyName</c> of the body the station stands on, or null when the body could not be read. Null together with <see cref="Latitude"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string? BodyName { get; set; }

    /// <summary>Body-fixed latitude of the station in degrees. Null exactly when <see cref="BodyName"/> is.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Latitude { get; set; }

    /// <summary>Body-fixed longitude of the station in degrees, wrapped to (-180, 180]. Null exactly when <see cref="Latitude"/> is.</summary>
    [SitrepUnit(Units.Degrees)]
    public double? Longitude { get; set; }

    /// <summary>
    /// Per-station facts the comms mod in use reports beyond this shape, keyed
    /// by that mod's name.
    /// A comms mod that knows more about its stations, such as their radio
    /// equipment, fills its own namespace here, typed by that mod's client.
    /// </summary>
    // The key is omitted when no provider filled a bag, so a payload no provider
    // extended carries no trace of the mechanism.
    [SitrepOmittedWhenNull]
    [ProviderExtensionBag]
    public Dictionary<string, object?>? Extensions { get; set; }
}

/// <summary>
/// The <c>comms.groundStations</c> payload: every ground station the game has,
/// as the comms mod in use reads them, with the body each stands on and
/// its latitude and longitude. Present with or without a craft on screen, and
/// the same for every command centre.
///
/// <para>Not delayed by signal delay: the stations are fixed places the
/// universe holds, not an observation of any vessel. An unchanged list is not
/// re-sent.</para>
/// </summary>
/// <category>Comms</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("comms.groundStations", DisplayName = "Ground stations")]
public class CommsGroundStations
{
    /// <summary>Every ground station. Empty when the backend reads none, never null.</summary>
    public IReadOnlyList<CommsGroundStation> Stations { get; set; } = new List<CommsGroundStation>();
}

/// <summary>
/// A comms backend that can list the ground stations of its network with their
/// places on their bodies. A companion to <see cref="ICommsBackend"/>: a backend
/// that is not one of these publishes an empty <c>comms.groundStations</c>.
///
/// <para>Called on the main thread, from the capture that reads every other
/// live comms fact.</para>
/// </summary>
/// <category>Comms models</category>
public interface ICommsGroundStations
{
    /// <summary>The ground stations as they stand now, with this backend's own facts in each station's extension bag.</summary>
    /// <returns>Every station, in a stable order. Never null.</returns>
    IReadOnlyList<CommsGroundStation> GroundStations();
}

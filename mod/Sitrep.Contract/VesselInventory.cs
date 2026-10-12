using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The stock cargo a vessel's parts are carrying: what is aboard, and in
/// which part.
///
/// <para>A kerbal's own inventory is not here: it is on <c>vessel.crew</c>,
/// beside the trait and experience level that decide whether that kerbal can
/// do a job. This channel lists only part-hosted stores.</para>
///
/// <para>Each store is reported with its part rather than as one vessel total,
/// because a craft can carry plenty of something while the kerbal who needs it
/// has none. A kerbal has two slots, 40 units of volume and a 65 kg limit, and
/// one slot holds a parachute by default; a cargo container holds far
/// more.</para>
///
/// <para>Stock KSP, with or without any Uplink: stock repairs consume stock
/// cargo, so a stock career has inventories worth showing.</para>
/// </summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.inventory")]
public class VesselInventory
{
    /// <summary>Every part-hosted inventory on the active vessel this tick, in
    /// vessel part-list order. Always present (possibly empty); a vessel-less
    /// tick yields a <c>null</c> payload, not an empty list.</summary>
    public List<InventoryStore> Stores { get; set; } = new();
}

/// <summary>One part's <c>ModuleInventoryPart</c>: a cargo hold aboard.</summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class InventoryStore
{
    /// <summary><c>Part.flightID</c> stringified, so a store id-joins to
    /// <c>vessel.parts</c> and the other per-part channels.</summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>The part's display title.</summary>
    [SitrepUnit(Units.Text)]
    public string PartName { get; set; } = "";

    /// <summary>What is actually in it. Empty is meaningful and is not the same
    /// as an absent store: an empty hold is a place to put something.</summary>
    public List<InventoryItem> Items { get; set; } = new();

    /// <summary><c>ModuleInventoryPart.InventorySlots</c>. Null when the module
    /// did not report one.</summary>
    [SitrepUnit(Units.Count)]
    public int? Slots { get; set; }

    /// <summary>Slots with something in them, so a consumer can say "2 of 4"
    /// without summing quantities that share a slot.</summary>
    [SitrepUnit(Units.Count)]
    public int? SlotsUsed { get; set; }

    /// <summary>
    /// <c>packedVolumeLimit</c>, in KSP's own cargo-volume unit, not cubic
    /// metres: it is a config number with no physical dimension (a kerbal holds
    /// 40, a repair kit takes 5).
    /// </summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? PackedVolumeLimit { get; set; }

    /// <summary>Packed volume currently used, same unit as <see
    /// cref="PackedVolumeLimit"/>.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? PackedVolumeUsed { get; set; }

    /// <summary><c>massLimit</c> in tonnes. A kerbal's is 0.065, which is the
    /// binding constraint on how much they can carry long before slots
    /// are.</summary>
    [SitrepUnit(Units.Tonnes)]
    public double? MassLimit { get; set; }
}

/// <summary>One kind of thing stored in an <see cref="InventoryStore"/>, with
/// how many of it.</summary>
/// <category>Vessel</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class InventoryItem
{
    /// <summary><c>AvailablePart.name</c>, the config id (e.g.
    /// <c>"evaRepairKit"</c>). The id a consumer matches on, never the title,
    /// which is localised.</summary>
    [SitrepUnit(Units.Id)]
    public string Name { get; set; } = "";

    /// <summary>The part's display title, already localised by KSP.</summary>
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    /// <summary>How many of this kind are in this store, summed across
    /// slots.</summary>
    [SitrepUnit(Units.Count)]
    public int Quantity { get; set; }

    /// <summary>Packed volume of one of these, same unit as the store's
    /// limits.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? PackedVolume { get; set; }
}

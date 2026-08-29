using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The stock cargo a vessel's PARTS are carrying: the supply aboard.
///
/// <para><b>Why the crew's own inventories are not here.</b> A kerbal carries
/// the same KSP module, <c>ModuleInventoryPart</c>, so one topic was the
/// obvious shape and it is the wrong one. These answer different questions.
/// This channel answers "what is aboard, and where", which is SUPPLY.
/// <c>vessel.crew</c> answers "who is here, are they qualified, and what are
/// they holding", which is the ACTOR list, and that is where a kerbal's two
/// slots belong: beside the trait and experience level that decide whether
/// they may do the job at all.</para>
///
/// <para><b>Why location is carried rather than a per-vessel total.</b> A
/// kerbal has two slots, forty volume and a 65kg limit, one slot of which
/// defaults to a parachute; a cargo container has far more. A craft can be
/// carrying plenty of something while the kerbal who needs it has none, and a
/// single total reports the reassuring half of that.</para>
///
/// <para>This is STOCK, and deliberately not any Uplink's. Stock KSP's own
/// repair mechanic consumes stock cargo, so a stock-career player has
/// inventories worth showing whether or not a modelling mod is installed.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.inventory")]
public class VesselInventory
{
    /// <summary>Every part-hosted inventory on the active vessel this tick, in vessel part-list order. Always present (possibly empty); a vessel-less tick yields a <c>null</c> payload, not an empty list.</summary>
    public List<InventoryStore> Stores { get; set; } = new();

    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>One part's <c>ModuleInventoryPart</c>: a cargo hold aboard.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class InventoryStore
{
    /// <summary><c>Part.flightID</c> stringified, so a store id-joins to <c>vessel.parts</c> and the other per-part channels.</summary>
    [SitrepUnit(Units.Id)]
    public string PartId { get; set; } = "";

    /// <summary>The part's display title.</summary>
    [SitrepUnit(Units.Text)]
    public string PartName { get; set; } = "";

    /// <summary>What is actually in it. Empty is meaningful and is NOT the same as an absent store: an empty hold is a place to put something.</summary>
    public List<InventoryItem> Items { get; set; } = new();

    /// <summary><c>ModuleInventoryPart.InventorySlots</c>. Null when the module did not report one.</summary>
    [SitrepUnit(Units.Count)]
    public int? Slots { get; set; }

    /// <summary>Slots with something in them, so a consumer can say "2 of 4" without summing quantities that share a slot.</summary>
    [SitrepUnit(Units.Count)]
    public int? SlotsUsed { get; set; }

    /// <summary>
    /// <c>packedVolumeLimit</c>, in KSP's own cargo-volume unit rather than
    /// cubic metres: it is a config number (a kerbal is 40, a repair kit is 5)
    /// and presenting it as a physical volume would be inventing a dimension
    /// the game does not attach to it.
    /// </summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? PackedVolumeLimit { get; set; }

    /// <summary>Packed volume currently used, same unit as <see cref="PackedVolumeLimit"/>.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? PackedVolumeUsed { get; set; }

    /// <summary><c>massLimit</c> in tonnes. A kerbal's is 0.065, which is the binding constraint on how much they can carry long before slots are.</summary>
    [SitrepUnit(Units.Tonnes)]
    public double? MassLimit { get; set; }
}

/// <summary>One kind of thing stored in an <see cref="InventoryStore"/>, with how many of it.</summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class InventoryItem
{
    /// <summary><c>AvailablePart.name</c>, the config id (e.g. <c>"evaRepairKit"</c>). The id a consumer matches on, never the title, which is localised.</summary>
    [SitrepUnit(Units.Id)]
    public string Name { get; set; } = "";

    /// <summary>The part's display title, already localised by KSP.</summary>
    [SitrepUnit(Units.Text)]
    public string? Title { get; set; }

    /// <summary>How many of this kind are in this store, summed across slots.</summary>
    [SitrepUnit(Units.Count)]
    public int Quantity { get; set; }

    /// <summary>Packed volume of ONE of these, same unit as the store's limits.</summary>
    [SitrepUnit(Units.Dimensionless)]
    public double? PackedVolume { get; set; }
}

using System;
using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// The <c>craftCatalogue</c> capability: the save's <c>.craft</c> files,
    /// listed, measured, and loaded into live parts for a consumer that needs
    /// the craft itself rather than a description of it. Resolve it through
    /// <see cref="IUplinkHost.Kernel"/> as an <see cref="ICraftCatalogue"/>.
    ///
    /// <para><c>spaceCenter.savedShips</c> is the read-only listing a widget
    /// draws; this capability is what a command acts on. The core mod does the
    /// KSP half (loading a craft instantiates part prefabs that must later be
    /// destroyed) and hands back an opaque handle, given back through
    /// <see cref="ICraftCatalogue.Release"/> once the consumer is done with
    /// it.</para>
    ///
    /// <para>Gonogo registers the only provider.</para>
    /// <internal>
    /// There is no election: a craft folder is a fact about the save's
    /// directory, not a model mods hold rival opinions about.
    /// Implemented by Gonogo.KSP.CraftCatalogueBackend and registered from
    /// SpaceCenterUplink. It is a capability because that is the only route an
    /// Uplink has into core; an Uplink may not reference KSP, and managing Unity
    /// object lifetime by reflection from an assembly that cannot name
    /// UnityEngine.Object leaves craft standing at the world origin. The load
    /// stays thin on purpose: it hands back the stock ShipConstruct and
    /// nothing else. Walking what a craft's own parts say about their
    /// configuration needs a convention stock does not have, so it stays with
    /// whichever mod asked for the craft.
    /// </internal>
    /// </summary>
    /// <category>Host and Kernel</category>
    public static class CraftCatalogueCapability
    {
        /// <summary>The capability id, <c>"craftCatalogue"</c>.</summary>
        public const string Id = "craftCatalogue";
    }

    /// <summary>
    /// One <c>.craft</c> file, measured without loading it.
    ///
    /// <para>Every measured figure is null when it could not be measured, never
    /// zero, so a consumer can tell "weighs nothing" from "not weighed".</para>
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class CraftFileRecord
    {
        /// <summary>
        /// The file's own name without its extension, and the only thing that
        /// addresses a craft: it is unique within its folder.
        ///
        /// <para>Not <see cref="ShipName"/>, which is what an operator reads and
        /// what <c>spaceCenter.savedShips</c> publishes. KSP stores the ship name
        /// inside the file and lets it differ from the file name, so two files
        /// can carry the same ship name.</para>
        /// </summary>
        public string? File { get; set; }

        /// <summary>The name inside the file, which is what the game shows.</summary>
        public string? ShipName { get; set; }

        /// <summary>Which editor built it, from the file rather than from the folder it sits in.</summary>
        public KspEditorFacility? Facility { get; set; }

        /// <summary>The number of parts in the craft, as KSP's craft profile reads it from the file.</summary>
        public int? PartCount { get; set; }

        /// <summary>Total mass in tonnes, everything included.</summary>
        public double? Mass { get; set; }

        /// <summary>
        /// Mass in tonnes with launch clamps left out.
        ///
        /// <para>The mass of what flies, which is usually what a facility limit
        /// is measured against; KSP's own <c>ShipConstruct.GetShipMass</c> offers
        /// the same choice. Equal to <see cref="Mass"/> for a craft with no
        /// clamps.</para>
        /// </summary>
        public double? MassExcludingClamps { get; set; }

        /// <summary>The craft's bounding size along x, in metres, as KSP's <c>ShipTemplate.GetShipSize</c> measures it. Null when it could not be measured.</summary>
        public double? SizeX { get; set; }

        /// <summary>The craft's bounding size along y (the editor's vertical axis), in metres. Null when it could not be measured.</summary>
        public double? SizeY { get; set; }

        /// <summary>The craft's bounding size along z, in metres. Null when it could not be measured.</summary>
        public double? SizeZ { get; set; }

        /// <summary>Stock total cost in funds. A career mod's own price may differ and this is not it.</summary>
        public double? Cost { get; set; }

        /// <summary>
        /// Parts the craft names that this install does not have at all, so the
        /// craft cannot be assembled by anybody. An empty array when it is
        /// whole; null when the question was not asked.
        /// </summary>
        public string[]? MissingParts { get; set; }

        /// <summary>
        /// Parts whose tech node is not researched. Parts that only need buying
        /// are in <see cref="UnpurchasedParts"/> instead.
        /// </summary>
        public string[]? LockedParts { get; set; }

        /// <summary>Parts researched but not bought in the R&amp;D building.</summary>
        public string[]? UnpurchasedParts { get; set; }
    }

    /// <summary>
    /// A craft loaded into live parts, or the reason it was not: a successful
    /// load sets <see cref="Ship"/>, a failed one <see cref="Failure"/>.
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class CraftLoad
    {
        /// <summary>
        /// The loaded craft, as an opaque handle. It is a KSP
        /// <c>ShipConstruct</c>, which the consumer is expected to hand to its
        /// own mod by reflection without naming the type.
        ///
        /// <para>It owns live Unity objects and MUST be given back to
        /// <see cref="ICraftCatalogue.Release"/>, whether the consumer used it or
        /// refused part-way.</para>
        /// </summary>
        public object? Ship { get; }

        /// <summary>Why nothing was loaded, in words an operator can act on. Null on success.</summary>
        public string? Failure { get; }

        /// <summary>
        /// The craft measured again from the parts that were just loaded, rather
        /// than from the cached listing.
        ///
        /// <para><see cref="ICraftCatalogue.Craft"/> may be a rescan behind; this is
        /// current, so a part unlocked since the last rescan counts. Use it before
        /// a command spends money on the craft.</para>
        /// </summary>
        public CraftFileRecord? Measured { get; }

        private CraftLoad(object? ship, string? failure, CraftFileRecord? measured)
        {
            Ship = ship;
            Failure = failure;
            Measured = measured;
        }

        /// <summary>A successful load carrying the loaded craft.</summary>
        /// <param name="ship">The KSP <c>ShipConstruct</c>, as an opaque handle.</param>
        /// <param name="measured">The craft measured again from the parts just loaded, or null when it could not be.</param>
        /// <returns>A load whose <see cref="Ship"/> is set and whose <see cref="Failure"/> is null.</returns>
        /// <exception cref="ArgumentNullException"><paramref name="ship"/> is null.</exception>
        public static CraftLoad Loaded(object ship, CraftFileRecord? measured = null) =>
            new CraftLoad(ship ?? throw new ArgumentNullException(nameof(ship)), null, measured);

        /// <summary>A failed load carrying the reason.</summary>
        /// <param name="reason">Why nothing was loaded, in words an operator can act on.</param>
        /// <returns>A load whose <see cref="Failure"/> is set and whose <see cref="Ship"/> is null.</returns>
        /// <exception cref="ArgumentException"><paramref name="reason"/> is null or blank.</exception>
        public static CraftLoad Failed(string reason) =>
            string.IsNullOrWhiteSpace(reason)
                ? throw new ArgumentException("a failed load says why", nameof(reason))
                : new CraftLoad(null, reason, null);
    }

    /// <summary>
    /// The save's craft folders: what is in them, and how to open one.
    ///
    /// <para>Every member is main-thread only: the listing walks the disk and
    /// reads part prefabs, and the load instantiates them. Never call one from a
    /// map passed to <see cref="IUplinkHost.AddChannelSource"/>.</para>
    /// </summary>
    /// <category>Host and Kernel</category>
    public interface ICraftCatalogue : ISitrepProvider
    {
        /// <summary>
        /// Every craft file in the save, VAB and SPH.
        ///
        /// <para>Empty when the save has no craft, which the caller should report
        /// as such rather than as a failure. Do not assume it is cheap:
        /// implementations are free to cache, and the core one does, so the
        /// listing may be a rescan behind.</para>
        /// </summary>
        IReadOnlyList<CraftFileRecord> Craft();

        /// <summary>
        /// Loads one craft into live parts, addressed by
        /// <see cref="CraftFileRecord.File"/> and the facility whose folder holds
        /// it.
        ///
        /// <para>The facility is required rather than searched for: the VAB and
        /// SPH folders are separate and may hold a file of the same name, and a
        /// loader that picked one would launch a spaceplane off a pad.</para>
        /// </summary>
        CraftLoad Load(string? file, KspEditorFacility? facility);

        /// <summary>
        /// Destroys the parts a <see cref="Load"/> instantiated. Safe to call
        /// with null, and safe to call twice; a handle that was never loaded is
        /// ignored rather than thrown over.
        /// </summary>
        void Release(object? ship);
    }
}

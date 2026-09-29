using System;
using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// The <c>craftCatalogue</c> capability: the save's <c>.craft</c> files,
    /// listed, measured, and loaded into live parts for an Uplink that needs the
    /// craft itself (a build queue, for example). Resolve it through
    /// <c>host.Kernel</c> as an <see cref="ICraftCatalogue"/>.
    ///
    /// <para><c>spaceCenter.savedShips</c> is the read-only listing a widget
    /// draws; this capability is what a command acts on. The core mod does the
    /// KSP half (loading a craft instantiates part prefabs that must later be
    /// destroyed) and hands the Uplink an opaque handle it never has to name,
    /// which the Uplink passes to its own mod by reflection and gives back.</para>
    ///
    /// <para>There is one provider and no election: a craft folder is a fact
    /// about the save's directory, not a model mods hold rival opinions
    /// about.</para>
    /// <internal>
    /// Implemented by Gonogo.KSP.CraftCatalogueBackend and registered from
    /// SpaceCenterUplink. It is a capability because that is the only route an
    /// Uplink has into core; an Uplink may not reference KSP, and managing Unity
    /// object lifetime by reflection from an assembly that cannot name
    /// UnityEngine.Object leaves craft standing at the world origin.
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
    /// <para>Every field is nullable and absence is a real answer: a figure that
    /// could not be measured must never arrive looking like a measured zero. A
    /// consumer deciding whether a craft fits somewhere has to be able to tell
    /// "this weighs nothing" from "nobody weighed this", because the two want
    /// opposite verdicts.</para>
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class CraftFileRecord
    {
        /// <summary>
        /// The file's own name without its extension, and the ONLY thing that
        /// addresses a craft.
        ///
        /// <para>Not <see cref="ShipName"/>, which is what an operator reads and
        /// what <c>spaceCenter.savedShips</c> publishes: KSP stores the ship name
        /// inside the file and lets it differ from the file's, so two files can
        /// carry one ship name and a command naming that would act on whichever
        /// the directory listed first. A file name is unique within its folder by
        /// construction.</para>
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
        /// <para>A separate figure rather than a correction applied to
        /// <see cref="Mass"/>, because a mod that measures a vehicle against a
        /// facility's limit is usually measuring the thing that flies: clamps
        /// stay on the ground and KSP's own <c>ShipConstruct.GetShipMass</c>
        /// offers the same choice. Equal to <see cref="Mass"/> for a craft with
        /// no clamps, which is most of them.</para>
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
        /// Parts whose tech node is not researched. Distinct from
        /// <see cref="UnpurchasedParts"/> because the two have different
        /// remedies: research versus money.
        /// </summary>
        public string[]? LockedParts { get; set; }

        /// <summary>Parts researched but not bought in the R&amp;D building.</summary>
        public string[]? UnpurchasedParts { get; set; }
    }

    /// <summary>
    /// A craft loaded into live parts, or the reason it was not.
    ///
    /// <para>Two fields rather than a nullable handle, because "there is no such
    /// craft" and "the file is corrupt" are different sentences to put in front
    /// of an operator and a consumer cannot make either one up.</para>
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
        public object? Ship { get; set; }

        /// <summary>Why nothing was loaded, in words an operator can act on. Null on success.</summary>
        public string? Failure { get; set; }

        /// <summary>
        /// The craft measured again from the parts that were just loaded, rather
        /// than from the cached listing.
        ///
        /// <para>Both exist because they are asked at different moments and a
        /// consumer needs to know which it is holding. <see cref="ICraftCatalogue.Craft"/>
        /// serves a widget drawing a list and may be a rescan behind; this serves
        /// a command about to spend money, where a part unlocked since the last
        /// rescan has to count.</para>
        /// </summary>
        public CraftFileRecord? Measured { get; set; }

        /// <summary>
        /// What the craft's own part modules say is wrong with their
        /// configuration, or null when none said anything.
        ///
        /// <para>KSP has no such concept; this is a convention mods implement, as
        /// a <c>Validate(out string error, out bool canBeResolved, out float
        /// costToResolve, out string techToResolve)</c> method on a
        /// <c>PartModule</c>. It is walked here because walking it needs the
        /// live parts, and it is reported rather than acted on because paying to
        /// resolve one is a decision that belongs to whoever is spending.</para>
        /// </summary>
        public string[]? ConfigErrors { get; set; }

        /// <summary>A successful load carrying the loaded craft.</summary>
        /// <param name="ship">The KSP <c>ShipConstruct</c>, as an opaque handle.</param>
        /// <returns>A load whose <see cref="Ship"/> is set and whose <see cref="Failure"/> is null.</returns>
        public static CraftLoad Loaded(object ship) => new CraftLoad { Ship = ship };

        /// <summary>A failed load carrying the reason.</summary>
        /// <param name="reason">Why nothing was loaded, in words an operator can act on.</param>
        /// <returns>A load whose <see cref="Failure"/> is set and whose <see cref="Ship"/> is null.</returns>
        public static CraftLoad Failed(string reason) => new CraftLoad { Failure = reason };
    }

    /// <summary>
    /// The save's craft folders: what is in them, and how to open one.
    ///
    /// <para><b>Every member is main-thread only.</b> The listing walks the disk
    /// and reads part prefabs; the load instantiates them. Neither is legal from
    /// the stream thread, so a channel mapper must not call either.</para>
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

using System;
using System.Collections.Generic;

namespace Sitrep.Contract
{
    /// <summary>
    /// The <c>craftCatalogue</c> capability: the save's <c>.craft</c> files,
    /// listed and measured without being loaded. Resolve it through
    /// <c>host.Kernel</c> as an <see cref="ICraftCatalogue"/>.
    ///
    /// <para><c>spaceCenter.savedShips</c> is the listing a widget draws; this
    /// capability carries the file name a command can address and separates the
    /// parts an install lacks from the parts a career has not researched or
    /// bought.</para>
    ///
    /// <para>There is one provider and no election: a craft folder is a fact
    /// about the save's directory, not a model mods hold rival opinions
    /// about.</para>
    /// <internal>
    /// Implemented by Gonogo.KSP.CraftCatalogueBackend and registered from
    /// SpaceCenterUplink.
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
    /// The save's craft folders: what is in them.
    ///
    /// <para><b>Main-thread only.</b> The listing walks the disk and reads part
    /// prefabs, which is not legal from the stream thread, so a channel mapper
    /// must not call it.</para>
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
    }
}

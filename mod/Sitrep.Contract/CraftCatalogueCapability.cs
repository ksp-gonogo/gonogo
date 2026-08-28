using System;
using System.Collections.Generic;

namespace Sitrep.Contract
{
    // ─────────────────────────────────────────────────────────────────────────
    // The save's craft files, as a capability rather than as a channel.
    //
    // WHAT WAS MISSING. spaceCenter.savedShips lists the craft folders and is a
    // READ: name, part count, mass, stock cost, missing parts. Nothing can act
    // on it. An Uplink that models a build queue needs the craft itself, and
    // reaching one means ShipConstruction.GetShipsPathFor, ConfigNode.Load and
    // ShipConstruct.LoadShip, which INSTANTIATES a part prefab per PART node and
    // leaves the GameObjects for somebody to destroy.
    //
    // An Uplink may not reference KSP, and every Uplink in this repo is an
    // example of what an outside author can build, so "reach it by reflection"
    // is not an answer either: Unity object lifetime managed through
    // MethodInfo.Invoke from an assembly that cannot name UnityEngine.Object is
    // how a scene ends up with a craft standing at the world origin.
    //
    // So core does the KSP half, where KSP is a compile-time reference, and
    // hands an Uplink a handle it never has to name. The Uplink passes that
    // handle to its own mod's constructor by reflection and gives it back. The
    // seam is the sanctioned one: the interface is declared here, in the only
    // assembly an Uplink may reference, and the implementation is resolved
    // through host.Kernel.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>The capability id, and the reason it is not exclusive.</summary>
    /// <remarks>
    /// One provider, core's, and no election: a craft folder is a fact about the
    /// save's directory rather than a model any mod could hold a rival opinion
    /// about. It is declared as a capability all the same because that is the
    /// only route an Uplink has into core, and a second provider would be a mod
    /// that stores craft somewhere else, which is a thing that could exist.
    /// </remarks>
    public static class CraftCatalogueCapability
    {
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

        /// <summary>The craft's bounding size in metres, x/y/z, or null when it could not be measured.</summary>
        public double? SizeX { get; set; }

        public double? SizeY { get; set; }

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
        /// answers a widget drawing a list and is allowed to be a rescan behind;
        /// this answers a command about to spend money, and a part unlocked since
        /// the last rescan has to count.</para>
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

        public static CraftLoad Loaded(object ship) => new CraftLoad { Ship = ship };

        public static CraftLoad Failed(string reason) => new CraftLoad { Failure = reason };
    }

    /// <summary>
    /// The save's craft folders: what is in them, and how to open one.
    ///
    /// <para><b>Every member is main-thread only.</b> The listing walks the disk
    /// and reads part prefabs; the load instantiates them. Neither is legal from
    /// the Courier thread, so a channel mapper must not call either.</para>
    /// </summary>
    public interface ICraftCatalogue : ISitrepProvider
    {
        /// <summary>
        /// Every craft file in the save, VAB and SPH.
        ///
        /// <para>Empty when the save has no craft; that is a real answer and the
        /// caller should say so rather than treating it as a failure. Callers
        /// should not assume it is cheap: implementations are free to cache, and
        /// this one does.</para>
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

using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.CompilerServices;
using KSP.UI.Screens;
using Sitrep.Contract;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The save's craft folders, offered to any Uplink through the
    /// <c>craftCatalogue</c> capability.
    ///
    /// <para><b>Why core owns this.</b> Listing craft is
    /// <c>ShipConstruction.GetShipsPathFor</c> plus <c>ConfigNode.Load</c>;
    /// OPENING one is <c>ShipConstruct.LoadShip</c>, which instantiates a Unity
    /// part per PART node and leaves the GameObjects for somebody to destroy. An
    /// Uplink may not reference KSP or Unity, so an Uplink that did this would be
    /// managing Unity object lifetime through <c>MethodInfo.Invoke</c> from an
    /// assembly that cannot name <c>UnityEngine.Object</c>. That is how a scene
    /// ends up with a craft standing at the world origin, once per press.</para>
    ///
    /// <para><b>Not the same thing as <c>spaceCenter.savedShips</c>.</b> That
    /// channel is a read for a widget listing what can be launched. This is a
    /// capability, it carries the FILE name a command can address, it separates
    /// the parts an install lacks from the parts a career has not researched from
    /// the parts it has not bought, and it can hand back the loaded craft. The
    /// two are kept apart rather than merged because a channel cannot open
    /// anything and a capability has no business publishing.</para>
    ///
    /// <para>The load itself is deliberately thin: it hands back the stock
    /// <c>ShipConstruct</c> and the craft's measurements, nothing more. Whatever
    /// a career mod's own part modules have to say about their configuration is
    /// a convention stock does not share, and walking it stays with whichever
    /// mod asked for the craft.</para>
    ///
    /// <para><b>Main thread only</b>, both members, and the interface says so:
    /// the listing reads part prefabs and the load instantiates them.</para>
    /// </summary>
    public sealed class CraftCatalogueBackend : ICraftCatalogue
    {
        public string ProviderId => "stock";

        /// <summary>
        /// How long a listing is served before the folders are walked again.
        ///
        /// <para>Real seconds rather than UT, unlike the saved-ships rescan this
        /// sits beside, because the thing that changes a craft folder is a player
        /// saving in the editor, which happens on a wall clock in a scene where
        /// UT does not move at all.</para>
        /// </summary>
        private const double RescanSeconds = 10.0;

        /// <summary>KSP's own extension for a craft file, without which nothing here is a craft.</summary>
        private const string CraftExtension = "*.craft";

        /// <summary>
        /// Every ship <see cref="Load"/> has handed out and nobody has released,
        /// so <see cref="Release"/> can tell one from a foreign object without
        /// naming <c>ShipConstruct</c>. Weak, so a ship its consumer dropped
        /// unreleased is not also kept alive here.
        /// </summary>
        private readonly ConditionalWeakTable<object, object> _handedOut = new ConditionalWeakTable<object, object>();

        private List<CraftFileRecord>? _cached;

        private double _scannedAt = double.NegativeInfinity;

        private string? _scannedSave;

        public IReadOnlyList<CraftFileRecord> Craft()
        {
            var save = HighLogic.SaveFolder;
            if (string.IsNullOrEmpty(save))
            {
                // No save loaded: an empty listing rather than a stale one, because
                // the craft of a game nobody is playing are not this game's craft.
                return new List<CraftFileRecord>();
            }

            var now = Time.realtimeSinceStartup;
            if (_cached != null
                && _scannedSave == save
                && now >= _scannedAt
                && now - _scannedAt < RescanSeconds)
            {
                return _cached;
            }

            var records = new List<CraftFileRecord>();
            foreach (var facility in new[] { EditorFacility.VAB, EditorFacility.SPH })
            {
                foreach (var file in FilesIn(save, facility))
                {
                    var record = Measure(file);
                    if (record != null)
                    {
                        records.Add(record);
                    }
                }
            }

            _cached = records;
            _scannedAt = now;
            _scannedSave = save;
            return records;
        }

        public CraftLoad Load(string? file, KspEditorFacility? facility)
        {
            if (string.IsNullOrEmpty(file))
            {
                return CraftLoad.Failed("no craft file was named");
            }
            if (facility == null || facility == KspEditorFacility.None)
            {
                // Never guessed. The VAB and SPH folders may each hold a file of
                // this name, and picking one would open a craft nobody asked for.
                return CraftLoad.Failed(
                    "no editor was named, and the VAB and SPH each keep their own craft folder");
            }

            var save = HighLogic.SaveFolder;
            if (string.IsNullOrEmpty(save))
            {
                return CraftLoad.Failed("no game is loaded, so there are no craft files to open");
            }

            return LoadFrom(save, file!, facility.Value);
        }

        /// <summary>
        /// The half of <see cref="Load"/> that names stock's ship types, kept out
        /// of it so the refusals above are compiled without resolving them.
        ///
        /// <para>The JIT resolves every type a method names before its first line
        /// runs, and <c>ShipConstruct</c> reaches into UnityEngine.UI, which a
        /// reference set trimmed to what the plugin compiles against does not
        /// carry.</para>
        /// </summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        private CraftLoad LoadFrom(string save, string file, KspEditorFacility facility)
        {
            string path;
            try
            {
                var folder = ShipConstruction.GetShipsPathFor(save, (EditorFacility)(int)facility);
                path = Path.Combine(folder ?? "", file + ".craft");
            }
            catch (Exception ex)
            {
                return CraftLoad.Failed("the craft folder could not be found: " + ex.Message);
            }

            if (!File.Exists(path))
            {
                return CraftLoad.Failed(
                    "no craft file named \"" + file + "\" is saved in the " + facility);
            }

            ConfigNode? node;
            try
            {
                node = ConfigNode.Load(path);
            }
            catch (Exception ex)
            {
                return CraftLoad.Failed("the craft file could not be read: " + ex.Message);
            }

            if (node == null)
            {
                return CraftLoad.Failed("the craft file could not be read");
            }

            var ship = new ShipConstruct();
            bool loaded;
            try
            {
                loaded = ship.LoadShip(node);
            }
            catch (Exception ex)
            {
                // Half a craft may already be standing, so it goes back before the
                // failure is reported.
                ReleaseParts(ship);
                return CraftLoad.Failed("the craft could not be assembled: " + ex.Message);
            }

            if (!loaded)
            {
                ReleaseParts(ship);
                return CraftLoad.Failed(
                    "KSP refused to load the craft, which usually means it was saved by a "
                    + "different version or references a part this install does not have");
            }

            _handedOut.Add(ship, ship);
            return new CraftLoad
            {
                Ship = ship,
                Measured = Measure(path) ?? new CraftFileRecord { File = file, Facility = facility },
            };
        }

        /// <summary>
        /// Destroys the parts a load instantiated.
        ///
        /// <para>Anything that is not a ship this class handed out is ignored
        /// rather than thrown over: a consumer releasing in a <c>finally</c> has
        /// no way to know whether the load got far enough, and a throw there would
        /// replace a result an operator can act on with one they cannot. A ship
        /// released once is no longer outstanding, so releasing it again is the
        /// same no-op.</para>
        /// </summary>
        public void Release(object? ship)
        {
            if (ship == null || !_handedOut.Remove(ship))
            {
                return;
            }
            ReleaseParts(ship);
        }

        /// <summary>The half of <see cref="Release"/> that names stock's ship types, apart for the reason <see cref="LoadFrom"/> is.</summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        private static void ReleaseParts(object ship)
        {
            if (!(ship is ShipConstruct construct) || construct.parts == null)
            {
                return;
            }
            foreach (var part in construct.parts)
            {
                try
                {
                    if (part != null)
                    {
                        UnityEngine.Object.Destroy(part.gameObject);
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] releasing a loaded craft part failed: " + ex);
                }
            }
            construct.parts.Clear();
        }

        /// <summary>Every <c>.craft</c> in one editor's folder, or nothing when the folder is not there.</summary>
        private static IEnumerable<string> FilesIn(string save, EditorFacility facility)
        {
            string path;
            try
            {
                path = ShipConstruction.GetShipsPathFor(save, facility);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] craft path lookup failed for " + facility + ", skipping: " + ex);
                return new string[0];
            }

            if (string.IsNullOrEmpty(path) || !Directory.Exists(path))
            {
                return new string[0];
            }

            try
            {
                return Directory.GetFiles(path, CraftExtension);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] craft folder walk failed for " + facility + ", skipping: " + ex);
                return new string[0];
            }
        }

        /// <summary>
        /// One craft file measured WITHOUT loading it: stock's own metadata
        /// loader for the name, part count and cost, a <c>ShipTemplate</c> for the
        /// size, and a walk of the PART nodes for the mass with clamps left out
        /// and for what the career can and cannot place.
        ///
        /// <para>Null when the file could not be parsed at all, which drops the
        /// row rather than publishing a craft nobody can measure.</para>
        /// </summary>
        private static CraftFileRecord? Measure(string path)
        {
            try
            {
                var root = ConfigNode.Load(path);
                if (root == null)
                {
                    return null;
                }

                var info = new CraftProfileInfo();
                info.LoadDetailsFromCraftFile(root, path);

                var record = new CraftFileRecord
                {
                    File = Path.GetFileNameWithoutExtension(path),
                    ShipName = info.shipName,
                    Facility = (KspEditorFacility)(int)info.shipFacility,
                    PartCount = info.partCount,
                    Mass = info.totalMass,
                    Cost = info.totalCost,
                };

                var template = new ShipTemplate();
                template.LoadShip(root);
                var size = template.GetShipSize();
                record.SizeX = size.x;
                record.SizeY = size.y;
                record.SizeZ = size.z;

                MeasureParts(root, record);
                return record;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] craft measurement failed for " + path + ", skipping: " + ex);
                return null;
            }
        }

        /// <summary>
        /// The part walk: mass with clamps left out, and the three ways a part can
        /// stop a craft being built.
        ///
        /// <para>Clamps are left out because that is the figure a career mod
        /// measures against a facility's limit: clamps stay on the ground. The
        /// test is KSP's own <c>LaunchClamp</c> module plus the
        /// <c>PadInfrastructure</c> tag, which is what the parts that behave like
        /// clamps without being one carry.</para>
        ///
        /// <para>Outside career every part is placeable, so the locked and
        /// unpurchased lists are empty rather than absent: nothing is withheld, and
        /// that is an answer.</para>
        /// </summary>
        private static void MeasureParts(ConfigNode root, CraftFileRecord record)
        {
            var missing = new List<string>();
            var locked = new List<string>();
            var unpurchased = new List<string>();
            var mass = 0.0;
            var measured = false;
            var career = HighLogic.CurrentGame != null
                && HighLogic.CurrentGame.Mode == Game.Modes.CAREER
                && ResearchAndDevelopment.Instance != null;

            foreach (var partNode in root.GetNodes("PART"))
            {
                var name = PartNameFrom(partNode);
                if (string.IsNullOrEmpty(name))
                {
                    continue;
                }

                var available = PartLoader.getPartInfoByName(name);
                if (available == null)
                {
                    missing.Add(name);
                    continue;
                }

                if (career)
                {
                    WithheldList(available, locked, unpurchased)?.Add(name);
                }

                if (IsClamp(available))
                {
                    continue;
                }

                float dryCost = 0f, fuelCost = 0f, dryMass = 0f, fuelMass = 0f;
                ShipConstruction.GetPartCostsAndMass(
                    partNode, available, out dryCost, out fuelCost, out dryMass, out fuelMass);
                mass += dryMass + fuelMass;
                measured = true;
            }

            record.MissingParts = missing.ToArray();
            record.LockedParts = locked.ToArray();
            record.UnpurchasedParts = unpurchased.ToArray();
            // Absent rather than zero when no part could be weighed: a craft of no
            // mass is a figure a consumer would compare against a limit, and an
            // invented one refuses a real vehicle or admits an impossible one.
            record.MassExcludingClamps = measured ? mass : (double?)null;
        }

        private static List<string>? WithheldList(AvailablePart part, List<string> locked, List<string> unpurchased)
        {
            if (!ResearchAndDevelopment.PartTechAvailable(part)) return locked;
            if (!ResearchAndDevelopment.PartModelPurchased(part)) return unpurchased;
            return null;
        }

        /// <summary>
        /// The part name inside a PART node. KSP writes it as
        /// <c>&lt;partName&gt;_&lt;id&gt;</c>, and a node without the separator is
        /// taken whole rather than thrown over: an unparsable name reads as a part
        /// the install does not have, which is the safe direction.
        /// </summary>
        internal static string PartNameFrom(ConfigNode partNode)
        {
            var value = partNode.GetValue("part");
            if (string.IsNullOrEmpty(value))
            {
                return partNode.GetValue("name") ?? "";
            }
            var separator = value.IndexOf('_');
            return separator < 0 ? value : value.Substring(0, separator);
        }

        /// <summary>
        /// Whether the part holds the craft down rather than flies with it. KSP's
        /// own launch-clamp module, plus the tag the parts that act like one
        /// without being one carry.
        /// </summary>
        private static bool IsClamp(AvailablePart available)
        {
            var prefab = available.partPrefab;
            if (prefab == null)
            {
                return false;
            }
            return prefab.FindModuleImplementing<LaunchClamp>() != null
                || (available.tags != null && available.tags.IndexOf("PadInfrastructure", StringComparison.OrdinalIgnoreCase) >= 0);
        }
    }
}

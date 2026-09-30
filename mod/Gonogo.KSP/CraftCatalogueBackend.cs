using System;
using System.Collections.Generic;
using System.IO;
using KSP.UI.Screens;
using Sitrep.Contract;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The save's craft folders, offered to any Uplink through the
    /// <c>craftCatalogue</c> capability.
    ///
    /// <para><b>Not the same thing as <c>spaceCenter.savedShips</c>.</b> That
    /// channel is a read for a widget listing what can be launched. This is a
    /// capability, it carries the FILE name a command can address, and it
    /// separates the parts an install lacks from the parts a career has not
    /// researched from the parts it has not bought.</para>
    ///
    /// <para><b>Main thread only</b>, and the interface says so: the listing
    /// reads part prefabs.</para>
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

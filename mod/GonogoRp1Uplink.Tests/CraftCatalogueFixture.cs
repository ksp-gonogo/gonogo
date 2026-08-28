using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// A stand-in craft catalogue: the capability core registers, with no KSP
    /// behind it.
    ///
    /// <para>Unlike <c>Rp0Fixture</c> this is not a reflection stand-in. The
    /// catalogue is reached through an INTERFACE declared in
    /// <c>Sitrep.Contract</c>, which is the whole point of the seam: an Uplink
    /// may not name a KSP type, so the one thing it holds is a handle it never
    /// opens. Here the handle is a plain object and the test can watch it come
    /// back.</para>
    /// </summary>
    public sealed class FakeCraftCatalogue : ICraftCatalogue
    {
        public string ProviderId => "fake";

        public readonly List<CraftFileRecord> Records = new List<CraftFileRecord>();

        /// <summary>Handles handed out, and whether each was given back.</summary>
        public readonly List<object> Loaded = new List<object>();

        public readonly List<object?> Released = new List<object?>();

        /// <summary>Set to refuse the load, the way a corrupt or absent file does.</summary>
        public string? LoadFailure;

        /// <summary>What the freshly loaded parts say about their own configuration.</summary>
        public string[]? ConfigErrors;

        /// <summary>Made to throw, to pin that an unreadable catalogue refuses rather than proceeds.</summary>
        public bool ThrowOnLoad;

        /// <summary>The last address the command asked for, so a test can prove it asked for the right one.</summary>
        public string? LastFile;

        public KspEditorFacility? LastFacility;

        public IReadOnlyList<CraftFileRecord> Craft() => Records;

        public CraftLoad Load(string? file, KspEditorFacility? facility)
        {
            LastFile = file;
            LastFacility = facility;
            if (ThrowOnLoad)
            {
                throw new InvalidOperationException("the craft folder could not be read");
            }
            if (LoadFailure != null)
            {
                return CraftLoad.Failed(LoadFailure);
            }
            var record = Records.FirstOrDefault(r => r.File == file && r.Facility == facility);
            if (record == null)
            {
                return CraftLoad.Failed("no craft file named \"" + file + "\" is saved in that editor");
            }
            var handle = new ShipConstruct
            {
                shipName = record.ShipName ?? "",
                shipFacility = record.Facility == KspEditorFacility.SPH
                    ? EditorFacility.SPH
                    : EditorFacility.VAB,
                totalCost = (float)(record.Cost ?? 0.0),
                totalMass = (float)(record.MassExcludingClamps ?? record.Mass ?? 0.0),
            };
            Loaded.Add(handle);
            return new CraftLoad
            {
                Ship = handle,
                Measured = record,
                ConfigErrors = ConfigErrors,
            };
        }

        public void Release(object? ship) => Released.Add(ship);

        /// <summary>Whether every handle handed out has been given back.</summary>
        public bool AllReleased => Loaded.All(h => Released.Contains(h));

        /// <summary>A craft the catalogue will serve, whole and unlocked.</summary>
        public CraftFileRecord Add(
            string file,
            KspEditorFacility facility = KspEditorFacility.VAB,
            double mass = 10.0,
            double cost = 40_000.0)
        {
            var record = new CraftFileRecord
            {
                File = file,
                ShipName = file,
                Facility = facility,
                PartCount = 12,
                Mass = mass,
                MassExcludingClamps = mass,
                SizeX = 3.0,
                SizeY = 20.0,
                SizeZ = 3.0,
                Cost = cost,
                MissingParts = new string[0],
                LockedParts = new string[0],
                UnpurchasedParts = new string[0],
            };
            Records.Add(record);
            return record;
        }
    }
}

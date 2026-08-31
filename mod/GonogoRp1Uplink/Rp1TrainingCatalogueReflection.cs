// RP-1's enrolable trainings, read by reflection. Same arm's-length pattern as
// Rp1CrewReflection, whose header carries the provenance rules this file follows.
//
// PROVENANCE. Every member below was read out of an ilspycmd disassembly of the
// SHIPPED RP-1 v4.6.0.0 RP0.dll. CrewHandler.TrainingTemplates is a public
// List<TrainingTemplate>, generated at load from every crewed part in the install
// and re-generated when tech completes.
//
// WHY A SEPARATE READER FROM THE COURSES. They answer different questions off the
// same handler: a course exists because somebody started it, a template exists
// because the install has the part. The course list is a handful of rows and moves
// every tick; the template list is one row per crewed part and moves when tech
// completes. Reading them together would put the second list's cost on the first
// list's cadence.
//
// MEMBERS DELIBERATELY NOT CALLED, and why:
//
//   TrainingTemplate.ACLevelRequirement
//       reaches TrainingDatabase.GetACRequirement, whose first statement is
//       ClearTracker() and which then fills the shared static unlockPathTracker.
//       A telemetry read must not move the game's scratch state: the same ruling
//       already taken on TrainingDatabase.FillBools and
//       LCOpsProject.GetTimeLeftEstAll. Rp1TrainingCommands asks it at the moment
//       of an operator press instead, which is when RP-1's own UI asks it.
//   TrainingTemplate.GetBaseTime(students)
//       with a NON-EMPTY list reaches TrainingDatabase.GetProficiencyTime, which
//       calls ClearTracker() too. With an empty list it returns the persisted
//       `time` field unchanged, so the field is read and the call skipped.
//   TrainingTemplate.GetExpiration(pcm)
//       needs a ProtoCrewMember, so it is a question about a kerbal rather than
//       about the catalogue.
//
// TrainingTemplate.IsUnlocked IS called, and it is a read: it walks partsCovered
// asking SpaceCenterManagement.TechListHas (a linear scan returning an index) and
// stock's ResearchAndDevelopment.GetTechnologyState. Neither writes anything. It
// dereferences SpaceCenterManagement.Instance without a guard, so a scene where
// that is null throws and the flag reports absent rather than false.
using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Resolves RP-1's training templates by reflection and reads them into
    /// <see cref="Rp1TrainingCatalogueRaw"/>. Nothing here touches KSP or Unity,
    /// so it runs headless against a stand-in object graph.
    /// </summary>
    public sealed class Rp1TrainingCatalogueReflection
    {
        private const string HandlerTypeName = "RP0.Crew.CrewHandler";

        /// <summary>
        /// How long a reading stands before the walk runs again.
        ///
        /// <para>Wall clock rather than UT, and that is the point: the answer moves
        /// when a tech node completes, which under warp is many thousands of UT
        /// seconds apart and under normal play is minutes. A UT window would
        /// re-walk every frame at high warp, which is the one regime where the walk
        /// is least affordable.</para>
        ///
        /// <para>It bounds a real cost. The list is one row per crewed part in the
        /// install, and <c>IsUnlocked</c> scans the research queue for each part
        /// each row covers, so a full RP-1 parts catalogue is a few hundred rows of
        /// nested scanning. The subscription gate already means nobody watching
        /// costs nothing; this means somebody watching costs it five-secondly
        /// rather than per tick.</para>
        /// </summary>
        private const double RewalkAfterSeconds = 5.0;

        private readonly Type? _handler;

        private readonly Stopwatch _sinceRead = new Stopwatch();

        private List<Rp1TrainingTemplateRaw>? _cached;

        public Rp1TrainingCatalogueReflection() => _handler = Rp1Types.Find(HandlerTypeName);

        /// <summary>RP-1's crew handler type resolved. Gated on the TYPE, never on an assembly name.</summary>
        public bool IsAvailable => _handler != null;

        /// <summary>
        /// One reading of the catalogue, or null when the last one still stands.
        ///
        /// <para>Null means "no news", not "no catalogue": the channel retains its
        /// last value, so a caller that skips the publish leaves the wire saying
        /// what it already said. An install where RP-1's handler is not live is a
        /// different answer and returns a raw whose list is null, so the channel
        /// can publish the absence its declaration promises.</para>
        /// </summary>
        public Rp1TrainingCatalogueRaw? Read(double ut)
        {
            if (_handler == null)
            {
                return null;
            }

            if (_sinceRead.IsRunning && _sinceRead.Elapsed.TotalSeconds < RewalkAfterSeconds)
            {
                return null;
            }

            var instance = Rp1Types.StaticValue(_handler, "Instance");
            var templates = instance == null ? null : ReadTemplates(instance);

            // Restarted on a completed walk only, so a scene without a live handler
            // is re-asked next tick rather than held behind the window: the answer
            // there is about the SAVE, and it changes the moment one loads.
            if (templates != null)
            {
                _cached = templates;
                _sinceRead.Restart();
            }
            else
            {
                _cached = null;
                _sinceRead.Reset();
            }

            return new Rp1TrainingCatalogueRaw { Ut = ut, Templates = _cached };
        }

        private static List<Rp1TrainingTemplateRaw>? ReadTemplates(object instance)
        {
            var list = Rp1Types.Member(instance, "TrainingTemplates");
            if (list == null)
            {
                return null;
            }

            var rows = new List<Rp1TrainingTemplateRaw>();
            foreach (var template in Rp1Types.Enumerate(list))
            {
                rows.Add(new Rp1TrainingTemplateRaw
                {
                    Id = Rp1Types.ReadString(template, "id"),
                    Name = EmptyAsAbsent(Rp1Types.ReadString(template, "name")),
                    Description = EmptyAsAbsent(Rp1Types.ReadString(template, "description")),
                    Type = Rp1Types.ReadEnumName(template, "type"),
                    Target = EmptyAsAbsent(Rp1Types.ReadString(Rp1Types.Member(template, "training"), "target")),
                    BaseTime = Rp1Types.ReadDouble(template, "time"),
                    SeatMin = Int(template, "seatMin"),
                    SeatMax = Int(template, "seatMax"),
                    Unlocked = Rp1Types.ReadBool(template, "IsUnlocked"),
                    IsTemporary = Rp1Types.ReadBool(template, "isTemporary"),
                });
            }
            return rows;
        }

        /// <summary>A seat bound as an int; RP-1 declares both as plain ints.</summary>
        private static int? Int(object? target, string name) =>
            Rp1Types.Member(target, name) is int value ? value : (int?)null;

        /// <summary>RP-1's empty string for an unset text field, as an absence.</summary>
        private static string? EmptyAsAbsent(string? value) =>
            string.IsNullOrEmpty(value) ? null : value;
    }
}

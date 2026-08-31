// Enrolling a crew on a training, and RP-1's TWO ways out of one.
//
// PROVENANCE. Every sequence below was read out of an ilspycmd disassembly of the
// SHIPPED RP-1 v4.6.0.0 RP0.dll, from RP0.Crew.TrainingGUI: the screen an
// operator would otherwise be using. No compile-time reference to RP0.dll, the
// same arm's-length reflection pattern as the rest of this Uplink.
//
// ENROL IS ONE ACT, NOT TWO, and that is RP-1's shape rather than a simplification
// of it. TrainingGUI builds a course from a template, collects students into it,
// and only calls TrainingCourses.Add once StartCourse has returned true. An
// enrolled-but-unstarted course is never persisted, so there is no course to enrol
// into and the command names a template and a crew together.
//
// The order below is TrainingGUI's own, and the order matters in one place:
// StartCourse GROUNDS every student (SetInactive for 120% of the base time), so
// anything that can fail is asked before it, and the list's Add is resolved before
// it too. A course that started and then could not be added to the roster would
// leave kerbals grounded against nothing.
//
//   1  the template, by id, off CrewHandler.TrainingTemplates
//   2  the students, by name, off HighLogic.CurrentGame.CrewRoster
//   3  new TrainingCourse(template)
//   4  ACLevelRequirement vs KCTUtilities.GetFacilityLevel(AstronautComplex)
//   5  the named crew's size against SeatMin and SeatMax
//   6  MeetsStudentReqs, then AddStudent, per kerbal
//   7  StartCourse
//   8  TrainingCourses.Add
//   9  MaintenanceHandler.ScheduleMaintenanceUpdate
//
// Steps 1-6 touch nothing RP-1 keeps: the course is a local object until step 8,
// and AddStudent only appends to its own list. So a refusal anywhere before step 7
// leaves the career exactly as it was.
//
// THE AC GATE IS ASKED HERE AND NOWHERE ELSE, which is the deliberate other half
// of the catalogue's refusal to publish it. TrainingTemplate.ACLevelRequirement
// reaches TrainingDatabase.GetACRequirement, which clears and refills a shared
// static tracker; a channel read taken every tick must not do that, and an
// operator press is exactly when RP-1's own screen does it. Note StartCourse
// itself does NOT check the tier: only the UI does, so declining to ask would
// quietly permit a course RP-1 would not offer.
//
// THE TWO WAYS OUT, and why the brief's AbortCourse is not either of them.
// AbortCourse has ONE caller in the whole assembly, CrewHandler.RemovePartCourses,
// the path that withdraws a template whose tech went away. It also returns
// immediately when the course has not started, and it does not remove the course
// from the roster. RP-1's own operator-facing controls are:
//
//   Cancel   drawn when SeatMin > 1, because removing one student would strand
//            the rest below the minimum. TrainingGUI.CancelCourse runs
//            CompleteCourse() then TrainingCourses.Remove(course). CompleteCourse
//            on a course whose Completed flag is still false SHORT-CIRCUITS its
//            entire reward block (`if (Completed && _template != null)`) and falls
//            through to one loop setting every student inactive = false. So it
//            un-grounds the crew and grants nothing, which is precisely what
//            RP-1's confirmation warns about: "they will lose any retirement
//            benefit of the training as well."
//   Remove   drawn otherwise. TrainingGUI.LeaveCourse runs
//            course.RemoveStudent(student), then removes the course from the
//            roster if that emptied it.
//
// ONE GUARD RP-1 DOES NOT NEED AND THIS DOES. Both leave paths refuse a course
// whose Completed flag is already true. RP-1's screen cannot reach one, because a
// completed course is off the roster by the time it draws again; a command can be
// sent at any moment, and CompleteCourse on a completed course runs the whole
// reward path a second time and spawns a PopupDialog from a code path nobody
// opened a screen for.
using System;
using System.Collections.Generic;
using System.Reflection;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// <c>rp1.training.enrol</c>, <c>rp1.training.cancel</c> and
    /// <c>rp1.training.remove</c>: put a crew through a training, and RP-1's two
    /// distinct ways of taking them back out.
    /// </summary>
    public sealed class Rp1TrainingCommands
    {
        public const string EnrolCommand = "rp1.training.enrol";

        public const string CancelCommand = "rp1.training.cancel";

        public const string RemoveCommand = "rp1.training.remove";

        private const string HandlerTypeName = "RP0.Crew.CrewHandler";

        private const string CourseTypeName = "RP0.Crew.TrainingCourse";

        private const string TemplateTypeName = "RP0.Crew.TrainingTemplate";

        private const string CrewMemberTypeName = "ProtoCrewMember";

        private const string UtilitiesTypeName = "RP0.KCTUtilities";

        private const string MaintenanceTypeName = "RP0.MaintenanceHandler";

        private const string HighLogicTypeName = "HighLogic";

        private const string FacilityEnumTypeName = "SpaceCenterFacility";

        /// <summary>The Astronaut Complex, named rather than cast from its ordinal.</summary>
        private const string AstronautComplex = "AstronautComplex";

        private readonly Type? _handler;

        private readonly Type? _course;

        public Rp1TrainingCommands()
        {
            _handler = Rp1Types.Find(HandlerTypeName);
            _course = Rp1Types.Find(CourseTypeName);
        }

        /// <summary>
        /// RP-1's crew handler AND its course type resolved. Both, because the
        /// enrolment constructs a course and the two leave paths call methods on
        /// one: a command declared off the handler alone would be offered on an
        /// install where the press could not do anything.
        /// </summary>
        public bool IsAvailable => _handler != null && _course != null;

        /// <summary>Start a training course with a named crew on it.</summary>
        public CommandResult Enrol(Rp1TrainingEnrolArgs? args)
        {
            try
            {
                if (string.IsNullOrEmpty(args?.TemplateId))
                {
                    return CommandResult.Fail(CommandErrorCode.Range, "A training id is required.");
                }
                if (args!.Crew == null || args.Crew.Count == 0)
                {
                    return CommandResult.Fail(CommandErrorCode.Range, "At least one kerbal is required: RP-1 has no such thing as an empty course.");
                }

                var instance = Instance();
                if (instance == null)
                {
                    return CommandResult.Fail(CommandErrorCode.ModeUnavailable, "RP-1's crew handler is not live, so there is no training to enrol on.");
                }

                var template = FindTemplate(instance, args.TemplateId!);
                if (template == null)
                {
                    return CommandResult.Fail(CommandErrorCode.NotFound, "No training with that id.");
                }

                var roster = Roster();
                if (roster == null)
                {
                    return CommandResult.Fail(CommandErrorCode.ModeUnavailable, "The crew roster could not be read.");
                }

                var students = new List<object>();
                foreach (var name in args.Crew)
                {
                    var pcm = string.IsNullOrEmpty(name) ? null : Member(roster, name);
                    if (pcm == null)
                    {
                        return CommandResult.Fail(CommandErrorCode.NotFound, "No kerbal named " + (name ?? "(none)") + " is on the roster.");
                    }
                    students.Add(pcm);
                }

                var ctor = _course == null ? null : Rp1Types.ConstructorOn(_course, TemplateTypeName, 1);
                if (ctor == null)
                {
                    return CommandResult.Fail(CommandErrorCode.ModeUnavailable, "RP-1's training course could not be constructed.");
                }
                var course = ctor.Invoke(new[] { template });

                var gate = CheckAstronautComplex(course);
                if (gate != null)
                {
                    return gate;
                }

                var seats = CheckSeatBounds(course, students.Count);
                if (seats != null)
                {
                    return seats;
                }

                var enrolled = AddStudents(course, args.Crew, students);
                if (enrolled != null)
                {
                    return enrolled;
                }

                var courses = Rp1Types.Member(instance, "TrainingCourses");
                var add = courses == null ? null : Rp1Types.InstanceMethod(courses, "Add", 1);
                var start = Rp1Types.InstanceMethod(course, "StartCourse", 0);
                if (add == null || start == null)
                {
                    return CommandResult.Fail(CommandErrorCode.ModeUnavailable, "RP-1's training roster does not expose a way to start a course.");
                }

                // Everything that can refuse has refused by here, because this is
                // the line that grounds the crew.
                if (!(start.Invoke(course, null) is bool started) || !started)
                {
                    return CommandResult.Fail(CommandErrorCode.WrongState, "RP-1 declined to start the course.");
                }

                add.Invoke(courses, new[] { course });
                ScheduleUpkeepUpdate();
                return CommandResult.Ok();
            }
            catch (Exception e)
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, "Enrolling failed: " + Rp1Types.ExceptionReason(e));
            }
        }

        /// <summary>
        /// End the whole course a kerbal is on, taking every student off it.
        ///
        /// <para>RP-1 draws this control when <c>SeatMin</c> is above one, and it
        /// is permitted below that too: cancelling a course nobody else is on
        /// cannot strand anybody. What is NOT permitted is the reverse, which is
        /// why <see cref="Remove"/> refuses above the minimum.</para>
        /// </summary>
        public CommandResult Cancel(Rp1TrainingLeaveArgs? args) => Leave(args, whole: true);

        /// <summary>Take one kerbal off their course, leaving it running for the rest.</summary>
        public CommandResult Remove(Rp1TrainingLeaveArgs? args) => Leave(args, whole: false);

        private CommandResult Leave(Rp1TrainingLeaveArgs? args, bool whole)
        {
            var what = whole ? "cancel" : "remove";
            try
            {
                if (string.IsNullOrEmpty(args?.CrewName))
                {
                    return CommandResult.Fail(CommandErrorCode.Range, "A kerbal's name is required: it is how RP-1 addresses both of its training controls.");
                }

                var instance = Instance();
                if (instance == null)
                {
                    return CommandResult.Fail(CommandErrorCode.ModeUnavailable, "RP-1's crew handler is not live, so there is no course to " + what + ".");
                }

                var courses = Rp1Types.Member(instance, "TrainingCourses");
                var found = FindCourseFor(courses, args!.CrewName!);
                if (found.Course == null)
                {
                    return CommandResult.Fail(CommandErrorCode.NotFound, args.CrewName + " is not on a training course.");
                }

                var remove = Rp1Types.InstanceMethod(courses!, "Remove", 1);
                if (remove == null)
                {
                    return CommandResult.Fail(CommandErrorCode.ModeUnavailable, "RP-1's training roster does not expose a way to take a course off it.");
                }

                return whole
                    ? CancelWhole(found.Course, courses!, remove)
                    : RemoveOne(found, courses!, remove);
            }
            catch (Exception e)
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, "Failed to " + what + " the course: " + Rp1Types.ExceptionReason(e));
            }
        }

        /// <summary>
        /// RP-1's Cancel, in RP-1's order: un-ground the crew, then drop the
        /// course.
        /// </summary>
        private static CommandResult CancelWhole(object course, object courses, MethodInfo remove)
        {
            var complete = Rp1Types.InstanceMethod(course, "CompleteCourse", 0);
            if (complete == null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable, "RP-1's training course does not expose a cancel.");
            }
            complete.Invoke(course, null);
            remove.Invoke(courses, new[] { course });
            ScheduleUpkeepUpdate();
            return CommandResult.Ok();
        }

        /// <summary>
        /// RP-1's Remove, plus the refusal RP-1 expresses by not drawing the
        /// button at all.
        /// </summary>
        private static CommandResult RemoveOne(Enrolment found, object courses, MethodInfo remove)
        {
            var seatMin = Rp1Types.Member(found.Course, "SeatMin") is int min ? min : 1;
            if (seatMin > 1)
            {
                return CommandResult.Fail(
                    CommandErrorCode.WrongState,
                    "This course needs " + seatMin + " students, so taking one out would strand the rest below its minimum. Cancel the whole course instead.");
            }

            var leave = Rp1Types.InstanceMethodOn(found.Course!, "RemoveStudent", CrewMemberTypeName, 1);
            if (leave == null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable, "RP-1's training course does not expose a way to take a student off it.");
            }
            leave.Invoke(found.Course, new[] { found.Student });

            // RP-1 drops a course its last student just left. RemoveStudent has
            // already un-grounded everyone by then, so this is bookkeeping.
            if (Count(Rp1Types.Member(found.Course, "Students")) == 0)
            {
                remove.Invoke(courses, new[] { found.Course });
            }
            ScheduleUpkeepUpdate();
            return CommandResult.Ok();
        }

        /// <summary>A kerbal and the course they are on, which is at most one.</summary>
        private readonly struct Enrolment
        {
            public Enrolment(object? course, object? student)
            {
                Course = course;
                Student = student;
            }

            public object? Course { get; }

            public object? Student { get; }
        }

        /// <summary>
        /// The course carrying this kerbal, and the kerbal object off the course's
        /// own student list.
        /// </summary>
        /// <remarks>
        /// <para>Taken from the course rather than looked up on the roster on
        /// purpose: <c>RemoveStudent</c> is a reference comparison
        /// (<c>Students.Contains(student)</c>), so the object that must be handed
        /// back is the one the course is holding.</para>
        ///
        /// <para><b>A COMPLETED course is skipped, and that one line carries both
        /// safety properties this file needs.</b> It is the only route to
        /// <c>CompleteCourse</c>, so a completed course cannot reach it a second
        /// time and re-grant its retirement extension. And <c>CompleteCourse</c>
        /// leaves the student list in place, so a kerbal who finished one course
        /// and started another is on two: skipping the finished one is what makes
        /// the live one the answer rather than whichever came first.</para>
        ///
        /// <para>So a kerbal whose course has just completed reads as "not on a
        /// training course", which is what they are.</para>
        /// </remarks>
        private static Enrolment FindCourseFor(object? courses, string name)
        {
            foreach (var course in Rp1Types.Enumerate(courses))
            {
                if (Rp1Types.ReadBool(course, "Completed") == true)
                {
                    continue;
                }
                foreach (var student in Rp1Types.Enumerate(Rp1Types.Member(course, "Students")))
                {
                    if (string.Equals(Rp1Types.ReadString(student, "name"), name, StringComparison.Ordinal))
                    {
                        return new Enrolment(course, student);
                    }
                }
            }
            return new Enrolment(null, null);
        }

        /// <summary>
        /// RP-1's own Astronaut Complex gate, asked before a course is offered a
        /// single student.
        ///
        /// <para>Refuses rather than proceeding when either half is unreadable.
        /// The alternative would be to start a course RP-1's own screen refuses to
        /// create, silently, because <c>StartCourse</c> does not check the tier
        /// itself.</para>
        /// </summary>
        private static CommandResult? CheckAstronautComplex(object course)
        {
            var required = Rp1Types.Member(course, "ACLevelRequirement") is int level ? level : (int?)null;
            var current = AstronautComplexLevel();
            if (required == null || current == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's Astronaut Complex requirement could not be read, and enrolling past it would start a course RP-1's own screen would not offer.");
            }
            if (required.Value > current.Value)
            {
                return CommandResult.Fail(
                    CommandErrorCode.WrongState,
                    "This training needs an Astronaut Complex of level " + (required.Value + 1) + " or higher.");
            }
            return null;
        }

        /// <summary>
        /// The Astronaut Complex's tier as RP-1 counts it: an index, not stock's
        /// normalised fraction. RP-1 asks <c>KCTUtilities.GetFacilityLevel</c>
        /// everywhere it prices or gates on a facility, and that method is the one
        /// that converts.
        /// </summary>
        private static int? AstronautComplexLevel()
        {
            try
            {
                var utilities = Rp1Types.Find(UtilitiesTypeName);
                var facility = Rp1Types.Find(FacilityEnumTypeName);
                if (utilities == null || facility == null)
                {
                    return null;
                }
                var method = Rp1Types.StaticMethodOn(utilities, "GetFacilityLevel", FacilityEnumTypeName, 1);
                if (method == null)
                {
                    return null;
                }
                return method.Invoke(null, new[] { Enum.Parse(facility, AstronautComplex) }) is int level ? level : (int?)null;
            }
            catch (Exception)
            {
                // Enum.Parse throws on a renamed member and the invoke throws
                // outside a career. Both are "the gate could not be read", which
                // the caller turns into a refusal rather than a pass.
                return null;
            }
        }

        /// <summary>
        /// Every named kerbal onto the course, or a refusal naming the first RP-1
        /// will not take.
        /// </summary>
        /// <remarks>
        /// <c>MeetsStudentReqs</c> is asked because <c>AddStudent</c> checks
        /// nothing but the seat maximum and a duplicate: it would silently accept a
        /// kerbal who is grounded, off-world, an applicant rather than crew, or
        /// barred by the training's own prerequisite. Refusing the whole command
        /// rather than dropping that kerbal, because a course quietly starting one
        /// seat short is the failure an operator cannot see.
        /// </remarks>
        private static CommandResult? AddStudents(object course, IReadOnlyList<string> names, IReadOnlyList<object> students)
        {
            var meets = Rp1Types.InstanceMethodOn(course, "MeetsStudentReqs", CrewMemberTypeName, 1);
            var add = Rp1Types.InstanceMethodOn(course, "AddStudent", CrewMemberTypeName, 1);
            if (meets == null || add == null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable, "RP-1's training course does not expose a way to enrol a student.");
            }

            for (var i = 0; i < students.Count; i++)
            {
                if (!(meets.Invoke(course, new[] { students[i] }) is bool eligible) || !eligible)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.WrongState,
                        names[i] + " cannot take this training: RP-1 refuses a kerbal who is already training, grounded, off-world, not yet crew, or missing the training's own prerequisite.");
                }
                add.Invoke(course, new[] { students[i] });
            }
            return null;
        }

        /// <summary>
        /// The two seat bounds, as RP-1 states them on its own new-course tab, and
        /// asked BEFORE a single student is added.
        /// </summary>
        /// <remarks>
        /// Both bounds are enforced further down anyway and neither says anything
        /// when it fires: <c>AddStudent</c> is silent about a seat maximum, and so
        /// is <c>MeetsStudentReqs</c>, which would refuse an over-capacity crew as
        /// though the kerbal were ineligible. Asking here is what turns "RP-1
        /// refuses this kerbal" into "this course seats four".
        ///
        /// <para>A <c>SeatMax</c> of zero or less is RP-1's "no maximum", and it is
        /// the course property's own default when a template has gone away.</para>
        /// </remarks>
        private static CommandResult? CheckSeatBounds(object course, int requested)
        {
            var max = Rp1Types.Member(course, "SeatMax") is int seatMax ? seatMax : 0;
            if (max > 0 && requested > max)
            {
                return CommandResult.Fail(
                    CommandErrorCode.Range,
                    "This training seats " + max + " and " + requested + " were named.");
            }

            var min = Rp1Types.Member(course, "SeatMin") is int seatMin ? seatMin : 1;
            if (requested < min)
            {
                return CommandResult.Fail(
                    CommandErrorCode.Range,
                    "This training needs " + min + " students and " + requested + " were named.");
            }
            return null;
        }

        /// <summary>
        /// Tell RP-1 its upkeep is stale. Best effort, and deliberately not a
        /// failure: a course that started and a maintenance figure that is an
        /// in-game hour behind is a worse outcome to report as an error than to
        /// let RP-1's own hourly recompute fix.
        /// </summary>
        private static void ScheduleUpkeepUpdate()
        {
            try
            {
                var type = Rp1Types.Find(MaintenanceTypeName);
                var instance = type == null ? null : Rp1Types.StaticValue(type, "Instance");
                if (instance == null)
                {
                    return;
                }
                Rp1Types.InstanceMethod(instance, "ScheduleMaintenanceUpdate", 0)?.Invoke(instance, null);
            }
            catch (Exception)
            {
                // See the summary: a stale upkeep figure is not worth failing a
                // command that already succeeded.
            }
        }

        private object? Instance() => _handler == null ? null : Rp1Types.StaticValue(_handler, "Instance");

        /// <summary>The template carrying this id, off RP-1's own generated list.</summary>
        private static object? FindTemplate(object instance, string id)
        {
            foreach (var template in Rp1Types.Enumerate(Rp1Types.Member(instance, "TrainingTemplates")))
            {
                if (string.Equals(Rp1Types.ReadString(template, "id"), id, StringComparison.Ordinal))
                {
                    return template;
                }
            }
            return null;
        }

        /// <summary>The save's kerbal roster, KSP's rather than RP-1's.</summary>
        private static object? Roster()
        {
            var highLogic = Rp1Types.Find(HighLogicTypeName);
            var game = highLogic == null ? null : Rp1Types.StaticValue(highLogic, "CurrentGame");
            return Rp1Types.Member(game, "CrewRoster");
        }

        /// <summary>
        /// One kerbal off the roster by name, or null.
        /// </summary>
        /// <remarks>
        /// The indexer rather than a walk, and the string overload specifically:
        /// <c>KerbalRoster</c> declares one taking an int beside it, and it returns
        /// null for a name it does not hold rather than throwing. RP-1's own
        /// <c>AddStudent(string)</c> overload goes through the same indexer and
        /// adds the null it gets back, which is why this asks first.
        /// </remarks>
        private static object? Member(object roster, string name)
        {
            var indexer = Rp1Types.InstanceMethodOn(roster, "get_Item", "System.String", 1);
            return indexer?.Invoke(roster, new object[] { name });
        }

        /// <summary>How many are in one of RP-1's collections.</summary>
        private static int Count(object? collection)
        {
            var n = 0;
            foreach (var _ in Rp1Types.Enumerate(collection))
            {
                n++;
            }
            return n;
        }
    }
}

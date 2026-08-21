using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Expansions.Serenity;
using Gonogo.KSP;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Gonogo.KSP.Tests.Robotics
{
    /// <summary>
    /// The <c>robotics.servos</c> capture, exercised end to end from real
    /// Breaking Ground servo modules to the payload the Topic publishes:
    /// <see cref="ServoCapture"/> produces the raw entries and
    /// <see cref="BreakingGroundViewProvider.BuildRobotics"/> maps them, so a
    /// servo missing here is a servo an operator never sees.
    ///
    /// <para>The modules are real <c>Expansions.Serenity</c> types, constructed
    /// headlessly against the reference assemblies. They never join a scene and
    /// nothing calls into physics; the fields this reads are plain
    /// <c>KSPField</c>s. That is the whole reason
    /// <c>KspHost.BuildPartsRobotics</c>' per-part half was carved out into
    /// <see cref="ServoCapture"/>: the surrounding walk needs a live
    /// <c>Vessel</c> and can never be entered from a test.</para>
    /// </summary>
    public class ServoCaptureTests
    {
        private static IDictionary<string, object?>[] Publish(params BaseServo[] servos)
        {
            var raw = ServoCapture.BuildEntries(servos, "Robotic Part", "77");
            var snapshot = new KspSnapshot
            {
                Ut = 0.0,
                Values = new Dictionary<string, object?>
                {
                    ["parts"] = new Dictionary<string, object?> { ["robotics"] = raw },
                },
            };

            var published = BreakingGroundViewProvider.BuildRobotics(snapshot);
            var list = Assert.IsType<List<object?>>(published);
            return list.Select(e => Assert.IsType<Dictionary<string, object?>>(e))
                       .Cast<IDictionary<string, object?>>()
                       .ToArray();
        }

        /// <summary>
        /// The defect this suite was written for. <c>ModuleRoboticRotationServo</c>
        /// is a SIBLING of <c>ModuleRoboticServoHinge</c> under
        /// <see cref="BaseServo"/>, not a subclass, so the per-kind scan the
        /// capture used to do never saw one: a craft's rotation servos were
        /// dropped before they reached the wire, while the actuator - which
        /// already resolved through <see cref="BaseServo"/> - would happily
        /// lock or unlock them.
        /// </summary>
        [Fact]
        public void ARotationServoReachesThePublishedPayload()
        {
            var hinge = new ModuleRoboticServoHinge { currentAngle = 10f, targetAngle = 20f, traverseVelocity = 30f };
            var rotation = new ModuleRoboticRotationServo { currentAngle = 135f, targetAngle = 180f, traverseVelocity = 45f };

            var published = Publish(hinge, rotation);

            var entry = Assert.Single(published, e => (string?)e["type"] == "rotationServo");
            Assert.Equal(135.0, (double?)entry["currentAngle"]);
            Assert.Equal(180.0, (double?)entry["targetAngle"]);
            Assert.Equal(45.0, (double?)entry["traverseVelocity"]);
            Assert.Equal(2, published.Length);
        }

        [Fact]
        public void EachKindKeepsTheReadingsOnlyItHas()
        {
            // normalizedOutput is computed (transformRateOfMotion / rpmLimit),
            // not a field, so it is read here rather than staged.
            var rotor = new ModuleRoboticServoRotor
            {
                currentRPM = 12.5f, rpmLimit = 60f,
                brakePercentage = 100f, rotateCounterClockwise = true, maxTorque = 30f,
            };
            var piston = new ModuleRoboticServoPiston { currentExtension = 0.4f, targetExtension = 0.9f, traverseVelocity = 1.5f };

            var published = Publish(rotor, piston);

            var rotorEntry = Assert.Single(published, e => (string?)e["type"] == "rotor");
            Assert.Equal(12.5, (double?)rotorEntry["currentRPM"]);
            Assert.Equal(30.0, (double?)rotorEntry["maxTorque"]);
            Assert.Equal(true, (bool?)rotorEntry["counterClockwise"]);
            Assert.Equal(0.0, (double?)rotorEntry["normalizedOutput"]);
            // A rotor spins; it has no position to be at.
            Assert.Null(rotorEntry["currentAngle"]);
            Assert.Null(rotorEntry["currentExtension"]);

            var pistonEntry = Assert.Single(published, e => (string?)e["type"] == "piston");
            // 0.4f and 0.9f do not survive the widen to double exactly.
            Assert.Equal(0.4, ((double?)pistonEntry["currentExtension"])!.Value, 6);
            Assert.Equal(0.9, ((double?)pistonEntry["targetExtension"])!.Value, 6);
            Assert.Null(pistonEntry["currentAngle"]);
            Assert.Null(pistonEntry["currentRPM"]);
        }

        [Fact]
        public void EveryServoCarriesTheCommonLockAndMotorState()
        {
            var published = Publish(new ModuleRoboticRotationServo());
            // Without this the loop below passes by never running.
            Assert.NotEmpty(published);

            foreach (var entry in published)
            {
                Assert.Equal("Robotic Part", entry["partName"]);
                Assert.Equal("77", entry["partId"]);
                Assert.NotNull(entry["servoIsLocked"]);
                Assert.NotNull(entry["servoIsMotorized"]);
                Assert.NotNull(entry["servoMotorIsEngaged"]);
                Assert.NotNull(entry["servoMotorLimit"]);
            }
        }

        /// <summary>
        /// The guard against the defect coming back. The set of servo kinds is
        /// read out of the GAME's own assembly rather than written down here,
        /// so a kind KSP adds fails this test until the capture names it and
        /// gives it whatever readings it alone has. A written-down list is what
        /// went wrong the first time and it would go wrong again.
        ///
        /// <para>The <c>>= 4</c> floor guards the INSTRUMENT, not the
        /// behaviour: reflecting over a 10MB assembly with a five-DLL reference
        /// set can come back short, and a discovery loop that found nothing
        /// would otherwise pass by having asked nothing.</para>
        /// </summary>
        [Fact]
        public void EveryServoKindTheGameShipsIsNamedByTheCapture()
        {
            var kinds = ConcreteServoTypes()
                .Select(t =>
                {
                    var servo = (BaseServo)Activator.CreateInstance(t)!;
                    var entry = (IDictionary<string, object?>)Assert.Single(ServoCapture.BuildEntries(new[] { servo }, "p", "1"))!;
                    return (Type: t, Kind: (string?)entry["type"]);
                })
                .ToList();

            Assert.True(kinds.Count >= 4,
                $"only {kinds.Count} BaseServo subclasses were reachable by reflection: the discovery, not the capture, is what failed here");

            var unnamed = kinds.Where(k => k.Kind == null || k.Kind == ServoCapture.UnnamedKind).ToList();
            Assert.True(unnamed.Count == 0,
                "these servo kinds reach the wire with no kind of their own, so no readout can tell them apart: "
                + string.Join(", ", unnamed.Select(u => u.Type.Name)));

            var duplicated = kinds.GroupBy(k => k.Kind).Where(g => g.Count() > 1).ToList();
            Assert.True(duplicated.Count == 0,
                "two servo kinds share one wire type: "
                + string.Join("; ", duplicated.Select(g => g.Key + " <- " + string.Join(", ", g.Select(k => k.Type.Name)))));
        }

        /// <summary>
        /// The half of the capture no test can enter: <c>BuildPartsRobotics</c>
        /// walks a live <c>Vessel</c>, so which modules it asks each part for
        /// is only visible in the source. Asking for a concrete subclass is the
        /// original defect, and it is invisible to every other check here
        /// because the servo never arrives to be dropped.
        /// </summary>
        [Fact]
        public void TheCaptureAsksEachPartForTheBaseServo()
        {
            var source = ReadKspHostSource();
            var start = source.IndexOf("private static List<object?>? BuildPartsRobotics", StringComparison.Ordinal);
            Assert.True(start >= 0, "BuildPartsRobotics was not found in KspHost.cs: this guard can no longer see what it checks");
            var end = source.IndexOf("\n        }", start, StringComparison.Ordinal);
            Assert.True(end > start, "could not find the end of BuildPartsRobotics");
            var body = source.Substring(start, end - start);

            Assert.Contains("GetModules<BaseServo>()", body, StringComparison.Ordinal);
            var perKind = body.IndexOf("GetModules<ModuleRobotic", StringComparison.Ordinal);
            Assert.True(perKind < 0,
                "the robotics capture asks a part for a NAMED servo kind. Every kind it does not name is dropped before it reaches the wire, "
                + "which is exactly how rotation servos were lost. Ask for BaseServo and let ServoCapture do the naming.");
        }

        /// <summary>
        /// Every concrete <see cref="BaseServo"/> in the game assembly.
        /// <c>GetTypes</c> throws on a partially-referenced assembly and hands
        /// back what it did load, which is what the caller's floor is for.
        /// </summary>
        private static List<Type> ConcreteServoTypes()
        {
            Type?[] all;
            try
            {
                all = typeof(BaseServo).Assembly.GetTypes();
            }
            catch (ReflectionTypeLoadException ex)
            {
                all = ex.Types;
            }

            return all.Where(t => t != null && !t.IsAbstract && typeof(BaseServo).IsAssignableFrom(t))
                      .Select(t => t!)
                      .ToList();
        }

        /// <summary>
        /// KspHost.cs, found by walking up from the test binary. The walk fails
        /// loudly rather than skipping: a source guard that cannot find its
        /// source has not checked anything, and silently reporting a pass is
        /// the failure mode it exists to avoid.
        /// </summary>
        private static string ReadKspHostSource()
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            var searched = new List<string>();
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "mod", "Gonogo.KSP", "KspHost.cs");
                searched.Add(candidate);
                if (File.Exists(candidate))
                {
                    return File.ReadAllText(candidate);
                }
                dir = dir.Parent;
            }

            throw new FileNotFoundException(
                "KspHost.cs not found walking up from " + AppContext.BaseDirectory
                + ". Looked at: " + string.Join(", ", searched));
        }
    }
}

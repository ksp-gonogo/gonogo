using System.Collections.Generic;
using Expansions.Serenity;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>parts.robotics</c> capture's per-part half: given one part's
    /// Breaking Ground servo modules, produce the raw wire entries
    /// <c>Sitrep.Host.BreakingGroundViewProvider.BuildRobotics</c> maps onto
    /// the <c>robotics.servos</c> Topic.
    ///
    /// <para>Carved out of <see cref="KspHost"/> so it depends on nothing but
    /// <see cref="BaseServo"/> and its subclasses - the same discipline as
    /// <c>CommNetOcclusion.cs</c> and <c>PlanOwner.cs</c>, and for a sharper
    /// reason here: <c>KspHost.BuildPartsRobotics</c> walks a live
    /// <c>Vessel</c>, so a headless test can never enter it, while the kind
    /// mapping this file owns is exactly the part that has been wrong.</para>
    /// </summary>
    public static class ServoCapture
    {
        /// <summary>
        /// The kind published for a <see cref="BaseServo"/> whose concrete
        /// class this capture does not recognise: a part pack's own servo, or
        /// one a later KSP adds. It reaches the operator with every reading
        /// <see cref="BaseServo"/> itself carries, which is the whole of what
        /// can honestly be said about it.
        /// </summary>
        public const string UnnamedKind = "servo";

        /// <summary>
        /// Every servo on one part, as raw wire entries. Discovery of WHICH
        /// modules these are is the caller's <c>GetModules&lt;BaseServo&gt;</c>
        /// call: this takes the base type so a servo kind can never be lost
        /// before it arrives.
        /// </summary>
        public static List<object?> BuildEntries(IEnumerable<BaseServo>? servos, string partName, string? partId)
        {
            var entries = new List<object?>();
            if (servos == null)
            {
                return entries;
            }

            foreach (var servo in servos)
            {
                // `is null`, not `== null`: BaseServo inherits UnityEngine.Object's
                // overloaded operator, which calls a module with no native peer
                // null even though the reference is live. Everything read below
                // is a plain managed field, so a module whose GameObject has
                // gone still has readings worth publishing, and a servo the
                // operator can see is the whole point of this file.
                if (servo is null)
                {
                    continue;
                }

                var entry = BuildServoEntry(servo, partName, partId);
                if (entry != null)
                {
                    entries.Add(entry);
                }
            }

            return entries;
        }

        private static Dictionary<string, object?>? BuildServoEntry(BaseServo servo, string partName, string? partId)
        {
            var entry = new Dictionary<string, object?>
            {
                ["partName"] = partName,
                ["partId"] = partId,
                ["type"] = null,
                ["servoIsLocked"] = servo.servoIsLocked,
                ["servoIsMotorized"] = servo.servoIsMotorized,
                ["servoMotorIsEngaged"] = servo.servoMotorIsEngaged,
                ["servoMotorLimit"] = (double)servo.servoMotorLimit,
                ["motorState"] = servo.motorState,
                ["currentAngle"] = (double?)null,
                ["targetAngle"] = (double?)null,
                ["traverseVelocity"] = (double?)null,
                ["currentRPM"] = (double?)null,
                ["rpmLimit"] = (double?)null,
                ["normalizedOutput"] = (double?)null,
                ["brakePercentage"] = (double?)null,
                ["currentExtension"] = (double?)null,
                ["targetExtension"] = (double?)null,
                ["counterClockwise"] = (bool?)null,
                ["maxTorque"] = (double?)null,
            };

            if (servo is ModuleRoboticServoRotor rotor)
            {
                entry["type"] = "rotor";
                entry["currentRPM"] = (double)rotor.currentRPM;
                entry["rpmLimit"] = (double)rotor.rpmLimit;
                entry["normalizedOutput"] = (double)rotor.normalizedOutput;
                entry["brakePercentage"] = (double)rotor.brakePercentage;
                entry["counterClockwise"] = rotor.rotateCounterClockwise;
                entry["maxTorque"] = (double)rotor.maxTorque;
                return entry;
            }

            if (servo is ModuleRoboticServoHinge hinge)
            {
                entry["type"] = "hinge";
                entry["currentAngle"] = (double)hinge.currentAngle;
                entry["targetAngle"] = (double)hinge.targetAngle;
                entry["traverseVelocity"] = (double)hinge.traverseVelocity;
                return entry;
            }

            if (servo is ModuleRoboticServoPiston piston)
            {
                entry["type"] = "piston";
                entry["traverseVelocity"] = (double)piston.traverseVelocity;
                entry["currentExtension"] = (double)piston.currentExtension;
                entry["targetExtension"] = (double)piston.targetExtension;
                return entry;
            }

            // Any other BaseServo subclass is dropped, which is what the three
            // per-kind GetModules<T> calls this was extracted from did between
            // them.
            return null;
        }
    }
}

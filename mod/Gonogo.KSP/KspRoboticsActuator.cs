using System;
using Expansions.Serenity;
using Sitrep.Contract;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The real <see cref="IRoboticsActuator"/> — the actuation counterpart of
    /// <see cref="KspHost.BuildPartsRobotics"/>'s read scan. Resolves the
    /// target part by <c>flightID.ToString()</c> across
    /// <c>FlightGlobals.ActiveVessel.parts</c> (the same join key the read side
    /// stamps on each <c>parts.robotics</c> entry), dispatches on the concrete
    /// Breaking Ground servo subtype (<see cref="ModuleRoboticServoRotor"/>/
    /// <see cref="ModuleRoboticServoHinge"/>/<see cref="ModuleRoboticServoPiston"/>,
    /// all subclasses of <see cref="BaseServo"/>), and applies the change.
    ///
    /// <para><b>Field writes go through <c>BaseField.SetValue</c>, never a bare
    /// assignment.</b> Every actuating servo field (<c>rpmLimit</c>,
    /// <c>brakePercentage</c>, <c>rotateCounterClockwise</c>,
    /// <c>servoMotorLimit</c>, <c>targetAngle</c>, <c>targetExtension</c>) is a
    /// <c>KSPField</c> whose live effect is driven by an <c>OnValueModified</c>
    /// callback wired in the module's <c>OnStart</c> (e.g. rotor
    /// <c>rpmLimit -&gt; ModifyRPMLimits</c>, <c>rotateCounterClockwise -&gt;
    /// ModifyDirection</c>, hinge <c>targetAngle -&gt; ModifyTargetAngle</c>).
    /// A bare <c>module.rpmLimit = value</c> sets the backing field but never
    /// fires that callback, so a running servo silently ignores it.
    /// <c>BaseField.SetValue(value, host)</c> assigns the field AND invokes
    /// <c>OnValueModified</c>, so the change actually takes effect — confirmed
    /// against this KSP version's decompiled <c>BaseField.SetValue</c>. The
    /// four lock/motor operations (<c>EngageServoLock</c>/<c>DisengageServoLock</c>/
    /// <c>EngageMotor</c>/<c>DisengageMotor</c>) are real methods, not fields,
    /// so those are direct calls.</para>
    ///
    /// <para>Like <see cref="KspVesselActuator"/>, every method here runs on the
    /// Unity main thread (the <see cref="ChannelEngine"/> command pump marshals
    /// handlers onto <c>GonogoAddon.FixedUpdate</c>), and every failure is a
    /// typed <see cref="CommandResult"/> rather than a thrown exception.</para>
    /// </summary>
    public sealed class KspRoboticsActuator : IRoboticsActuator
    {
        public CommandResult SetServoTarget(string partId, double value) => WithServo(partId, servo =>
        {
            // A rotor spins continuously and has no target; a non-motorized
            // servo can't be driven to one either. Both are ModeUnavailable
            // rather than a silent no-op.
            if (servo is ModuleRoboticServoRotor)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }
            if (!servo.servoIsMotorized)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            if (servo is ModuleRoboticServoHinge hinge)
            {
                hinge.Fields["targetAngle"].SetValue((float)value, hinge);
                return CommandResult.Ok();
            }
            if (servo is ModuleRoboticServoPiston piston)
            {
                piston.Fields["targetExtension"].SetValue((float)value, piston);
                return CommandResult.Ok();
            }

            return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
        });

        public CommandResult SetServoMotor(string partId, bool engaged) => WithServo(partId, servo =>
        {
            if (!servo.servoIsMotorized)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }
            if (engaged)
            {
                servo.EngageMotor();
            }
            else
            {
                servo.DisengageMotor();
            }
            return CommandResult.Ok();
        });

        public CommandResult SetServoLock(string partId, bool locked) => WithServo(partId, servo =>
        {
            if (locked)
            {
                servo.EngageServoLock();
            }
            else
            {
                servo.DisengageServoLock();
            }
            return CommandResult.Ok();
        });

        public CommandResult SetRotorRpmLimit(string partId, double value) => WithRotor(partId, rotor =>
        {
            rotor.Fields["rpmLimit"].SetValue((float)value, rotor);
            return CommandResult.Ok();
        });

        // The torque-limit percentage maps to BaseServo.servoMotorLimit (0–100),
        // NOT ModuleRoboticServoRotor.maxTorque — see the robotics command brief.
        public CommandResult SetRotorTorqueLimit(string partId, double value) => WithRotor(partId, rotor =>
        {
            rotor.Fields["servoMotorLimit"].SetValue((float)value, rotor);
            return CommandResult.Ok();
        });

        public CommandResult SetRotorBrake(string partId, double value) => WithRotor(partId, rotor =>
        {
            rotor.Fields["brakePercentage"].SetValue((float)value, rotor);
            return CommandResult.Ok();
        });

        public CommandResult SetRotorMotor(string partId, bool engaged) => WithRotor(partId, rotor =>
        {
            if (!rotor.servoIsMotorized)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }
            if (engaged)
            {
                rotor.EngageMotor();
            }
            else
            {
                rotor.DisengageMotor();
            }
            return CommandResult.Ok();
        });

        public CommandResult SetRotorLock(string partId, bool locked) => WithRotor(partId, rotor =>
        {
            if (locked)
            {
                rotor.EngageServoLock();
            }
            else
            {
                rotor.DisengageServoLock();
            }
            return CommandResult.Ok();
        });

        // "Reverse" flips the spin direction — rotateCounterClockwise, whose
        // OnValueModified callback (ModifyDirection) is what actually re-drives
        // the running rotor. inverted is a separate axis-invert flag and is NOT
        // what the reverse button targets. Read the live value through the field
        // and write its negation back through the same field so the callback
        // fires.
        public CommandResult ReverseRotor(string partId) => WithRotor(partId, rotor =>
        {
            var field = rotor.Fields["rotateCounterClockwise"];
            var current = field.GetValue<bool>(rotor);
            field.SetValue(!current, rotor);
            return CommandResult.Ok();
        });

        /// <summary>
        /// Resolves <paramref name="partId"/> to a part on the active vessel and
        /// hands its first <see cref="BaseServo"/> module to
        /// <paramref name="action"/>. <see cref="CommandErrorCode.NoVessel"/>
        /// when there's no active vessel, <see cref="CommandErrorCode.NotFound"/>
        /// when no part carries the id or the part has no servo module.
        /// </summary>
        private static CommandResult WithServo(string partId, Func<BaseServo, CommandResult> action)
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || vessel.parts == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            var part = FindPart(vessel, partId);
            if (part == null || part.Modules == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            var servos = part.Modules.GetModules<BaseServo>();
            if (servos == null || servos.Count == 0 || servos[0] == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            return action(servos[0]);
        }

        /// <summary>
        /// Rotor-specific twin of <see cref="WithServo"/>. A part that resolves
        /// but is a hinge/piston rather than a rotor is a subtype mismatch and
        /// comes back <see cref="CommandErrorCode.ModeUnavailable"/> — an
        /// unknown id is still <see cref="CommandErrorCode.NotFound"/>.
        /// </summary>
        private static CommandResult WithRotor(string partId, Func<ModuleRoboticServoRotor, CommandResult> action)
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || vessel.parts == null)
            {
                return CommandResult.Fail(CommandErrorCode.NoVessel);
            }

            var part = FindPart(vessel, partId);
            if (part == null || part.Modules == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            var rotors = part.Modules.GetModules<ModuleRoboticServoRotor>();
            if (rotors == null || rotors.Count == 0 || rotors[0] == null)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }

            return action(rotors[0]);
        }

        private static Part? FindPart(Vessel vessel, string partId)
        {
            foreach (var part in vessel.parts)
            {
                if (part == null)
                {
                    continue;
                }
                // Mirror the read side's join key (KspHost.BuildPartsRobotics):
                // flightID is 0 until the part loads into flight, so skip the
                // uninitialized sentinel rather than matching "0".
                if (part.flightID != 0 && part.flightID.ToString() == partId)
                {
                    return part;
                }
            }
            return null;
        }
    }
}

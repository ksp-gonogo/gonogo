using System;
using System.Reflection;

namespace Gonogo.KSP
{
    /// <summary>
    /// The parts of the Breaking Ground captures that can be decided WITHOUT a
    /// live <c>Vessel</c>, carved out of <see cref="KspHost"/> for the same
    /// reason <see cref="ServoCapture"/> was: the surrounding walks need a real
    /// vessel and a headless test can never enter them, while the decisions
    /// here are exactly the parts that have been wrong.
    ///
    /// <para>Both decisions answer the same question: can this reader tell "the
    /// game said no" from "we could not find out". Breaking Ground's types are
    /// obfuscation-risky and read reflectively, so a failed read is a routine
    /// event rather than an impossible one, and a failed read reported as a
    /// definite <c>false</c> is what put "No robotic parts on this vessel" on a
    /// craft that has them and painted a powered base red.</para>
    ///
    /// <para>Carries NO KSP or Unity type, deliberately, which is what lets the
    /// test project compile it unconditionally (the same reasoning as
    /// <c>KscLightTimeMath.cs</c>). That is why a failed read is REPORTED to
    /// the caller rather than logged here: <c>UnityEngine.Debug</c> would put
    /// this file behind the KspManaged gate, where a machine without the
    /// reference assemblies runs none of its tests and says nothing about
    /// it.</para>
    /// </summary>
    public static class BreakingGroundReads
    {
        /// <summary>
        /// Reads a public instance FIELD or get-PROPERTY named
        /// <paramref name="name"/> off <paramref name="instance"/>, reporting
        /// whether the READ SUCCEEDED separately from what it read.
        ///
        /// <para>Returns false when the member is absent (renamed, obfuscated,
        /// a different KSP version) or when reading it threw, and true when the
        /// member was read, INCLUDING when what it read was null. That is the
        /// whole distinction: <c>null</c> alone cannot tell "this experiment
        /// has no cluster" from "we could not ask", and a caller that treats
        /// the second as the first states a fact it does not have.</para>
        ///
        /// <para>Field takes precedence over property, because some members
        /// surfaced as one or the other across KSP versions.</para>
        ///
        /// <para><paramref name="failure"/> carries why a false came back, for
        /// the caller to log. Null whenever the read succeeded.</para>
        /// </summary>
        public static bool TryMember(
            Type type,
            object instance,
            string name,
            out object? value,
            out string? failure
        )
        {
            value = null;
            failure = null;
            try
            {
                var field = type.GetField(name, BindingFlags.Public | BindingFlags.Instance);
                if (field != null)
                {
                    value = field.GetValue(instance);
                    return true;
                }

                var property = type.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
                if (property != null && property.CanRead)
                {
                    value = property.GetValue(instance);
                    return true;
                }

                failure = type.Name + "." + name + ": no public field or readable property";
                return false;
            }
            catch (Exception ex)
            {
                failure = type.Name + "." + name + ": read threw: " + ex;
                return false;
            }
        }

        /// <summary>
        /// The three-state answer for <c>robotics.available</c>, from what the
        /// per-part walk managed to read.
        ///
        /// <list type="bullet">
        /// <item>a servo found anywhere is a definite <c>true</c>, and outranks
        /// an unreadable neighbour: one proven robotic part is proof</item>
        /// <item>an unreadable part with no servo found is <c>null</c>, because
        /// "no robotic parts" is a claim about EVERY part and one of them did
        /// not answer</item>
        /// <item>a part list that could not be read at all is <c>null</c> for
        /// the same reason, and is NOT the same as an empty one</item>
        /// <item>every part read, none carrying a servo, is a definite
        /// <c>false</c>: the craft genuinely has none</item>
        /// </list>
        ///
        /// <para>The contract field is <c>bool?</c> and
        /// <c>SnapshotDict.GetBool</c> carries null end to end, so the null has
        /// somewhere to go; before this it could not be produced.</para>
        /// </summary>
        public static bool? RoboticsAvailable(
            bool partListRead,
            bool anyServoFound,
            bool anyPartUnreadable
        )
        {
            if (anyServoFound)
            {
                return true;
            }

            if (!partListRead || anyPartUnreadable)
            {
                return null;
            }

            return false;
        }

        /// <summary>
        /// Whether a deployed experiment is attached to a science cluster:
        /// <c>true</c>/<c>false</c> when the cluster member was read, and
        /// <c>null</c> when the read itself failed.
        ///
        /// <para>The conflation this replaces was <c>cluster != null</c>, which
        /// answered a definite "not connected" for a reflective read that never
        /// happened. Downstream that reached the operator as a deployed base
        /// painted red and <c>Unpowered</c>, indistinguishable from an
        /// experiment genuinely sitting unattached.</para>
        /// </summary>
        public static bool? ControllerConnected(bool clusterRead, object? cluster) =>
            clusterRead ? cluster != null : (bool?)null;
    }
}

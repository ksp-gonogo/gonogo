using System;
using Sitrep.Contract;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The three live KSP reads <see cref="Sitrep.Host.Comms.CommsModelPolicy"/>
    /// needs, and nothing else: whether this save models a comms network at all,
    /// and, when it does not, the two facts about the craft that stop being
    /// answerable from a link.
    ///
    /// <para>The rules built on these are in
    /// <c>Sitrep.Host.Comms.CommsModelPolicy</c>, KSP-free and headless-tested;
    /// this is the carve-out that keeps them that way, the same discipline
    /// <see cref="CommNetOcclusion"/> already applies to the occlusion rule.</para>
    ///
    /// <para>MAIN-THREAD, like every other live read in this assembly.</para>
    /// </summary>
    internal static class CommsModelPresence
    {
        /// <summary>
        /// Whether this save models a comms network: the stock CommNet
        /// difficulty option, which is the same field
        /// <c>CommNetScenario.CommNetEnabled</c> reads
        /// (<c>HighLogic.CurrentGame.Parameters.Difficulty.EnableCommNet</c>).
        ///
        /// <para>THREE-STATE, and <c>null</c> is doing real work: no game is
        /// loaded (the main menu), or the read threw. <c>CommNetScenario</c>'s
        /// own accessor collapses that case to <c>false</c>, which for it is
        /// harmless because nothing is flying, but here a <c>false</c> means
        /// "switch delay off and report every craft connected", and inferring
        /// that from a null game would be a guess. Only a definite <c>false</c>
        /// changes anything downstream.</para>
        /// </summary>
        internal static bool? Present
        {
            get
            {
                try
                {
                    var difficulty = HighLogic.CurrentGame?.Parameters?.Difficulty;
                    return difficulty?.EnableCommNet;
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("[Gonogo] CommsModelPresence read failed (treating as unknown): " + ex.Message);
                    return null;
                }
            }
        }

        /// <summary>
        /// The active craft's control tier as KSP itself computes it. With the
        /// CommNet option off, <c>Vessel.GetControlLevel</c> skips the CommNet
        /// branch entirely and walks the craft's own <c>Part.isControlSource</c>
        /// instead, and <c>CurrentControlLevel</c> is where that walk's answer
        /// lands. Reading it rather than the dead <c>CommNetVessel</c> is what
        /// stops gonogo reporting no control over a craft the game is perfectly
        /// happy to fly.
        ///
        /// <para>An unloaded or absent craft has no answer, and KSP zeroes its
        /// own <c>controlLevel</c> in that case too, so
        /// <see cref="CommsControlSource.None"/> here is stock's own value, not
        /// a substituted one.</para>
        /// </summary>
        internal static CommsControlSource LocalControl()
        {
            var vessel = ActiveVesselScope.Current;
            if (vessel == null || !vessel.loaded)
            {
                return CommsControlSource.None;
            }
            switch (vessel.CurrentControlLevel)
            {
                case Vessel.ControlLevel.FULL:
                    return CommsControlSource.Full;
                case Vessel.ControlLevel.PARTIAL_MANNED:
                case Vessel.ControlLevel.PARTIAL_UNMANNED:
                    return CommsControlSource.Partial;
                default:
                    return CommsControlSource.None;
            }
        }

        /// <summary>
        /// Which craft the readings are about and how current it is, for the
        /// no-comms-model wrapper to stamp its own payloads with.
        ///
        /// <para>Built here rather than borrowed from a backend: the shared
        /// derivation moved onto <c>CommsBackendBase</c> as a PROTECTED instance
        /// member, which is right for a backend stamping its own payloads and
        /// unreachable from a wrapper that is not one. Same two fields off the
        /// same <see cref="ActiveVesselScope.Current"/> read, so the two cannot
        /// disagree about a craft.</para>
        /// </summary>
        internal static PayloadMeta Meta()
        {
            var vessel = ActiveVesselScope.Current;
            var id = vessel?.id.ToString();
            return new PayloadMeta
            {
                Source = id != null ? "vessel:" + id : "game",
                Quality = id != null && vessel!.loaded ? Quality.Loaded : Quality.OnRails,
            };
        }
    }
}

using System;
using UnityEngine;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// Puts the antenna fallback chains in the save and takes them out again.
    ///
    /// <para><b>This is what makes a chain intent rather than a session setting.</b>
    /// A chain is set precisely so that a craft keeps working when nobody is
    /// watching it, and an operator who set one before logging off has every right
    /// to expect it to still be there. Without this the register would be emptied
    /// by the next load, and the antenna would sit on whatever entry the walk had
    /// last reached, with nothing left to move it again.</para>
    ///
    /// <para>Registered for the three scenes a chain can be set from or observed
    /// in, so the node survives a save taken from any of them and not only from
    /// flight. The walk itself runs from the Uplink's own tick, not from here:
    /// this module is the save half and nothing else.</para>
    ///
    /// <para>The register is a STATIC, and deliberately: this module is created
    /// and destroyed by the game once per scene, while the Uplink's command
    /// handler and its tick are registered once at startup and hold the register
    /// for the life of the process. OnAwake clears it so a second save loaded in
    /// one session cannot inherit the first one's chains.</para>
    /// </summary>
    [KSPScenario(ScenarioCreationOptions.AddToAllGames, GameScenes.FLIGHT, GameScenes.SPACECENTER, GameScenes.TRACKSTATION)]
    public sealed class RaChainScenario : ScenarioModule
    {
        private static readonly RaChainRegister Register = new RaChainRegister();

        /// <summary>The process-lifetime register the Uplink's command handler and tick both hold.</summary>
        internal static RaChainRegister Chains => Register;

        public override void OnAwake()
        {
            base.OnAwake();
            Register.Clear();
        }

        public override void OnLoad(ConfigNode node)
        {
            base.OnLoad(node);
            try
            {
                RaChainPersistence.Load(Register, node);
            }
            catch (Exception ex)
            {
                Debug.LogError("[GonogoRealAntennasUplink] RaChainScenario.OnLoad failed: " + ex);
            }
        }

        public override void OnSave(ConfigNode node)
        {
            base.OnSave(node);
            try
            {
                RaChainPersistence.Save(Register, node);
            }
            catch (Exception ex)
            {
                Debug.LogError("[GonogoRealAntennasUplink] RaChainScenario.OnSave failed: " + ex);
            }
        }
    }
}

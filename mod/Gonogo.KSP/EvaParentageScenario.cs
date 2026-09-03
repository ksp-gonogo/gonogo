using System;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// Puts <see cref="ActiveVesselScope"/>'s kerbal-to-craft relations in the save
    /// and takes them out again. Without this a quickload during an EVA loses the
    /// relation and the kerbal becomes the reported vessel, which is the whole thing
    /// the seam exists to stop.
    ///
    /// <para>Unlike <c>SilenceTrackerScenario</c> this does not own the state it
    /// persists: the book belongs to <see cref="ActiveVesselScope"/>, which is a
    /// static read from channel mappers that outlive any scene. So OnAwake CLEARS
    /// the book instead of rebuilding it - the incoming save's own relations arrive
    /// through OnLoad a moment later, and a kerbal from the save being left behind
    /// is not in this world.</para>
    ///
    /// <para>Registered for the same three scenes as the other Gonogo scenarios so
    /// the node survives a save taken from any of them, not only from flight.</para>
    /// </summary>
    [KSPScenario(ScenarioCreationOptions.AddToAllGames, GameScenes.FLIGHT, GameScenes.SPACECENTER, GameScenes.TRACKSTATION)]
    public sealed class EvaParentageScenario : ScenarioModule
    {
        public override void OnAwake()
        {
            base.OnAwake();
            ActiveVesselScope.Reset();
        }

        public override void OnLoad(ConfigNode node)
        {
            base.OnLoad(node);
            try
            {
                EvaParentagePersistence.Load(ActiveVesselScope.Book, node);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] EvaParentageScenario.OnLoad failed: " + ex);
            }
        }

        public override void OnSave(ConfigNode node)
        {
            base.OnSave(node);
            try
            {
                EvaParentagePersistence.Save(ActiveVesselScope.Book, node);
            }
            catch (Exception ex)
            {
                Debug.LogError("[Gonogo] EvaParentageScenario.OnSave failed: " + ex);
            }
        }
    }
}

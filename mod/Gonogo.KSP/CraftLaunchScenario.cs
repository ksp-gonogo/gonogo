using System;

namespace Gonogo.KSP
{
    /// <summary>
    /// Puts <see cref="CraftLaunchLog"/> in the save and takes it out again. The
    /// book is a process-wide static, written by the launch hook while a flight
    /// loads, so a load merges the saved launches into it: the hook can fire
    /// before or after this module's own load, and a launch recorded first must
    /// survive the other order. The book is the record of the loaded game, so
    /// it is emptied when a different game is loaded (a quickload, a revert,
    /// another save), never on a scene change within one.
    ///
    /// <para>Registered for the three scenes the other Gonogo scenarios use, so a
    /// save taken from any of them keeps it.</para>
    /// </summary>
    [KSPScenario(ScenarioCreationOptions.AddToAllGames, GameScenes.FLIGHT, GameScenes.SPACECENTER, GameScenes.TRACKSTATION)]
    public sealed class CraftLaunchScenario : ScenarioModule
    {
        public override void OnLoad(ConfigNode node)
        {
            base.OnLoad(node);
            try
            {
                CraftLaunchLog.Current.Adopt(HighLogic.CurrentGame);
                CraftLaunchLogPersistence.Load(CraftLaunchLog.Current, node);
            }
            catch (Exception ex)
            {
                GonogoLog.Error("CraftLaunchScenario.OnLoad failed", ex);
            }
        }

        public override void OnSave(ConfigNode node)
        {
            base.OnSave(node);
            try
            {
                CraftLaunchLogPersistence.Save(CraftLaunchLog.Current, node);
            }
            catch (Exception ex)
            {
                GonogoLog.Error("CraftLaunchScenario.OnSave failed", ex);
            }
        }
    }
}

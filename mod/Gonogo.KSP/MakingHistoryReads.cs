using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// The decisions in the Making History capture that need no live mission,
    /// carved out of <see cref="MissionCapture"/> so a headless test can reach
    /// them. Carries no KSP or Unity type, which is what lets the test project
    /// compile it unconditionally.
    /// </summary>
    public static class MakingHistoryReads
    {
        /// <summary>
        /// Which of the loaded missions to report, as an index into the list, or
        /// -1 when there is none.
        ///
        /// <para>A mission that is running wins. Failing that, one that has just
        /// ended, so the outcome stays visible until the game leaves the mission.
        /// Failing that, the first one loaded, which is a mission that has been
        /// set up but not started.</para>
        /// </summary>
        public static int PickMission(IReadOnlyList<(bool Started, bool Ended)> missions)
        {
            if (missions.Count == 0)
            {
                return -1;
            }

            for (var i = 0; i < missions.Count; i++)
            {
                if (missions[i].Started && !missions[i].Ended)
                {
                    return i;
                }
            }

            for (var i = 0; i < missions.Count; i++)
            {
                if (missions[i].Ended)
                {
                    return i;
                }
            }

            return 0;
        }
    }
}

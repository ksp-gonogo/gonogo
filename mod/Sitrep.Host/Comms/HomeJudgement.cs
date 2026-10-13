namespace Sitrep.Host.Comms
{
    /// <summary>
    /// How the home centre judges a craft from what has reached it: in contact,
    /// silent, declared lost, or gone. Only home declares a craft lost, because
    /// the career's books are kept there.
    /// </summary>
    public static class HomeJudgement
    {
        /// <summary>
        /// How many judgements in a row must find a craft past its wait before it
        /// is declared lost. One judgement is made each tick, so under warp the
        /// clock can step past the wait in one tick, and a declaration is never
        /// made on a single look.
        /// </summary>
        public const int OverdueJudgementsToDeclare = 2;

        /// <summary>
        /// The instant past which home may declare a silent craft lost, or null
        /// while home has no forecast for it.
        ///
        /// <para>The forecast's deadline is in the craft's own time. A report of
        /// contact made just before it is still on its way home for as long as
        /// the longest route by which word of the craft reaches home, so home
        /// waits that long past it: <paramref name="allowanceSeconds"/>. When
        /// home has heard of contact after the ground lost the craft, from a
        /// crewed centre, the forecast's span runs again from that contact.</para>
        /// </summary>
        public static double? Wait(CentreContact contact, CraftForecast? forecast, double allowanceSeconds)
        {
            if (forecast?.DeadlineUt is not double deadline || forecast.OnsetUt is not double onset)
            {
                return null;
            }
            if (contact.LastContactUt is double last && last > onset)
            {
                deadline += last - onset;
            }
            return deadline + allowanceSeconds;
        }

        /// <summary>
        /// Moves <paramref name="verdict"/> on by one judgement at
        /// <paramref name="nowUt"/>. Returns whether its state changed.
        /// </summary>
        /// <param name="verdict">The craft's verdict, changed in place.</param>
        /// <param name="contact">Home's consolidated contact with the craft, or null when no word of it has reached home.</param>
        /// <param name="forecast">The forecast for the craft as heard at home, or null when none has reached it.</param>
        /// <param name="allowanceSeconds">How long word of the craft can still be on its way home: see <see cref="Wait"/>.</param>
        /// <param name="nowUt">Home's clock.</param>
        public static bool Judge(HomeVerdict verdict, CentreContact? contact, CraftForecast? forecast, double allowanceSeconds, double nowUt)
        {
            if (contact == null)
            {
                return false;
            }
            var was = verdict.State;
            switch (contact.Value.State)
            {
                case CentreContactState.Gone:
                    verdict.Overdue = 0;
                    verdict.State = HomeVerdictState.Gone;
                    break;
                case CentreContactState.InContact:
                    verdict.Overdue = 0;
                    if (was == HomeVerdictState.Lost)
                    {
                        verdict.WithdrawnUt = nowUt;
                    }
                    verdict.State = HomeVerdictState.Nominal;
                    break;
                default:
                    if (was == HomeVerdictState.Lost || was == HomeVerdictState.Gone)
                    {
                        break;
                    }
                    var wait = Wait(contact.Value, forecast, allowanceSeconds);
                    verdict.Overdue = wait != null && nowUt >= wait.Value ? verdict.Overdue + 1 : 0;
                    if (verdict.Overdue >= OverdueJudgementsToDeclare)
                    {
                        verdict.State = HomeVerdictState.Lost;
                        verdict.DeclaredLostUt = nowUt;
                        verdict.LostSeq++;
                    }
                    else
                    {
                        verdict.State = HomeVerdictState.Silent;
                    }
                    break;
            }
            return verdict.State != was;
        }
    }
}

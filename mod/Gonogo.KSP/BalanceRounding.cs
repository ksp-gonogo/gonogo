using System;

namespace Gonogo.KSP
{
    /// <summary>
    /// A career balance as the game keeps it. KSP accumulates funds, reputation and science
    /// through single-precision arithmetic, so a balance of 32948 reads back as
    /// 32947.9990234375. Rounded to hundredths, a balance that did not change reads the same
    /// every time and is not sent again.
    /// </summary>
    internal static class BalanceRounding
    {
        public static double Round(double balance) => Math.Round(balance, 2, MidpointRounding.AwayFromZero);
    }
}

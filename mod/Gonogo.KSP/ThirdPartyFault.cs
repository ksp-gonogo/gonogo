using System;

namespace Gonogo.KSP
{
    /// <summary>
    /// Turns an exception thrown by code this mod does not own (a part module's
    /// KSPEvent, an action-group provider) into the sentence one refused request
    /// carries. The message getter is read defensively: a hostile exception can
    /// throw from it.
    /// </summary>
    internal static class ThirdPartyFault
    {
        public static string Describe(string what, Exception ex)
        {
            string message;
            try
            {
                message = ex.Message;
            }
            catch (Exception)
            {
                message = ex.GetType().Name;
            }
            return what + " threw: " + message;
        }
    }
}

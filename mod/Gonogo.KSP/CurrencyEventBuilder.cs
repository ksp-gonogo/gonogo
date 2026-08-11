using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// Builds the wire dicts for the source-attributed currency events
    /// (<c>currency.&lt;guid&gt;.science</c>). Same self-flattening producer pattern
    /// the other wire builders here use: the <c>Sitrep.Contract</c> POCO is the
    /// TYPING mirror TS codegen reflects over, and <c>JsonWriter</c> walks this
    /// dictionary to make the bytes. camelCase keys match the generated TS shape.
    /// </summary>
    public static class CurrencyEventBuilder
    {
        public static Dictionary<string, object?> BuildScienceCredit(
            string vesselId,
            string vesselName,
            double amount,
            string subjectId,
            string subjectTitle,
            double ut) =>
            new Dictionary<string, object?>
            {
                ["vesselId"] = vesselId,
                ["vesselName"] = vesselName,
                ["amount"] = amount,
                ["subjectId"] = subjectId,
                ["subjectTitle"] = subjectTitle,
                ["ut"] = ut,
            };
    }
}

using System.Collections.Generic;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What a crewed command centre knows of its contact with every craft it
    /// knows of, as of one instant. It is sent home over the centre's own link,
    /// so the home centre knows what a remote centre knew one of that centre's
    /// signal delays home later.
    /// </summary>
    public sealed class CentreReport
    {
        public CentreReport(string centre, double capturedUt, IReadOnlyDictionary<string, CentreContact> contacts)
        {
            Centre = centre;
            CapturedUt = capturedUt;
            Contacts = contacts;
        }

        /// <summary>The reporting centre, as <c>vessel:&lt;guid&gt;</c>.</summary>
        public string Centre { get; }

        /// <summary>The instant the centre knew this.</summary>
        public double CapturedUt { get; }

        /// <summary>The centre's contact with each craft it knows of, by node id.</summary>
        public IReadOnlyDictionary<string, CentreContact> Contacts { get; }
    }
}

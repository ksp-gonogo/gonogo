#nullable disable
using System;

namespace Sitrep.Vendor.Fleck
{
    public class ConnectionNotAvailableException : Exception
    {
        public ConnectionNotAvailableException() : base()
        {
        }

        public ConnectionNotAvailableException(string message) : base(message)
        {
        }

        public ConnectionNotAvailableException(string message, Exception innerException)
            : base(message, innerException)
        {
        }
    }
}

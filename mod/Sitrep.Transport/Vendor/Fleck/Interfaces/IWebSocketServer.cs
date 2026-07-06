#nullable disable
using System;

namespace Sitrep.Vendor.Fleck
{
    public interface IWebSocketServer : IDisposable
    {
        void Start(Action<IWebSocketConnection> config);
    }
}

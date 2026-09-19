using CommNet;
using Gonogo.KSP;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// That <see cref="CommNetBackend.RouteBetween"/> hands back the same node
    /// objects it already walked, not just their geometry.
    ///
    /// <para>A break in a route can only be recorded against a named node
    /// (<c>INetwork.DropPath</c>), and naming one costs a walk over every
    /// vessel in the game per node. <see cref="CommsRouteHop.FromHandle"/> and
    /// <see cref="CommsRouteHop.ToHandle"/> let a caller defer that walk until
    /// it actually needs a name, so this checks the handles are the exact same
    /// <see cref="CommNode"/> references the route was solved over: since the
    /// backend's private node-naming is a function of the node reference
    /// alone, that identity is what guarantees a later name lookup on the
    /// handle gives the same id as one on the original node. The naming
    /// itself is not called from here, it walks <c>FlightGlobals.Vessels</c>
    /// and throws outside a running game.</para>
    /// </summary>
    public class CommNetBackendRouteHopHandleTests
    {
        private sealed class TestNetwork : CommNetwork
        {
            internal CommNode AddNodeAt(Vector3d position)
            {
                var node = new CommNode { precisePosition = position };
                node.SetNet(this);
                nodes.Add(node);
                return node;
            }

            internal void Join(CommNode a, CommNode b, double strength)
            {
                var link = new CommLink
                {
                    a = a,
                    b = b,
                    signalStrength = strength,
                    strengthAR = strength,
                    strengthBR = strength,
                    strengthRR = strength,
                };
                a.Add(b, link);
                b.Add(a, link);
                links.Add(link);
            }
        }

        [Fact]
        public void RouteBetweenCarriesTheBackendsOwnNodeHandles()
        {
            var net = new TestNetwork();
            var origin = net.AddNodeAt(new Vector3d(0.0, 0.0, 0.0));
            var target = net.AddNodeAt(new Vector3d(1000.0, 0.0, 0.0));
            net.Join(origin, target, 1.0);

            var hops = new CommNetBackend().RouteBetween(origin, target);

            var hop = Assert.Single(hops!);
            // Assert.Same is avoided here: xUnit's failure-message formatter
            // walks a CommNode as the IEnumerable of links it is, and a
            // formatted CommNode recurses into the very link objects that
            // point back at it, so a genuine mismatch stack-overflows the
            // test host instead of reporting FAIL.
            Assert.True(ReferenceEquals(origin, hop.FromHandle), "FromHandle is not the origin node");
            Assert.True(ReferenceEquals(target, hop.ToHandle), "ToHandle is not the target node");
        }
    }
}

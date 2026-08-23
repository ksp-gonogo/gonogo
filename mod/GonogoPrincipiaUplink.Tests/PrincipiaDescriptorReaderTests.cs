using System;
using System.IO;
using System.Linq;
using System.Text;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    public class PrincipiaDescriptorReaderTests
    {
        /// <summary>
        /// A minimal but REAL `FileDescriptorProto` prefix: field 1 (name) carrying
        /// the file name, then field 2 (package). Built rather than pasted so the
        /// length prefixes cannot drift out of step with the payloads.
        /// </summary>
        private static byte[] Descriptor(string package = "principia.serialization")
        {
            var name = Encoding.ASCII.GetBytes("serialization/journal.proto");
            var pkg = Encoding.ASCII.GetBytes(package);
            var bytes = new byte[2 + name.Length + 2 + pkg.Length];
            var i = 0;
            bytes[i++] = 0x0A;
            bytes[i++] = (byte)name.Length;
            Array.Copy(name, 0, bytes, i, name.Length);
            i += name.Length;
            bytes[i++] = 0x12;
            bytes[i++] = (byte)pkg.Length;
            Array.Copy(pkg, 0, bytes, i, pkg.Length);
            return bytes;
        }

        private static Stream Binary(byte[] before, byte[] descriptor, byte[] after)
        {
            var all = before.Concat(descriptor).Concat(after).ToArray();
            return new MemoryStream(all);
        }

        private static byte[] Filler(int count, byte value = 0xCC) =>
            Enumerable.Repeat(value, count).ToArray();

        [Fact]
        public void FindsTheDescriptorAndReportsWhereItStarts()
        {
            var descriptor = Descriptor();
            var read = PrincipiaDescriptorReader.Read(
                Binary(Filler(4096), descriptor, Filler(4096)));

            Assert.True(read.Found);
            Assert.Equal(4096, read.Offset);
            Assert.Equal(descriptor.Length, read.Length);
            Assert.Null(read.Reason);
        }

        [Fact]
        public void TheHashIsOfTheDescriptorAndNothingAroundIt()
        {
            // The same descriptor in two different binaries must hash the same, or
            // the hash names the file rather than the interface and cannot identify
            // a release across the six builds that share one.
            var descriptor = Descriptor();
            var a = PrincipiaDescriptorReader.Read(Binary(Filler(64), descriptor, Filler(64)));
            var b = PrincipiaDescriptorReader.Read(
                Binary(Filler(9001, 0x11), descriptor, Filler(3, 0x22)));

            Assert.Equal(a.Sha256, b.Sha256);
            Assert.NotEqual(a.Offset, b.Offset);
        }

        [Fact]
        public void ADifferentDescriptorHashesDifferently()
        {
            // The control for the test above: equal hashes would be worthless if
            // everything hashed equally.
            var a = PrincipiaDescriptorReader.Read(Binary(Filler(64), Descriptor(), Filler(64)));
            var b = PrincipiaDescriptorReader.Read(
                Binary(Filler(64), Descriptor("principia.serialization.v2"), Filler(64)));

            Assert.NotEqual(a.Sha256, b.Sha256);
        }

        [Fact]
        public void StopsAtTheFirstByteThatIsNotAFieldRatherThanRunningOn()
        {
            // 0xCC is field 25, which a FileDescriptorProto does not have, so the
            // descriptor ends before it. Getting this wrong would fold arbitrary
            // machine code into the hash and make it differ between builds that
            // share an interface.
            var descriptor = Descriptor();
            var read = PrincipiaDescriptorReader.Read(
                Binary(Filler(16), descriptor, Filler(4096)));

            Assert.Equal(descriptor.Length, read.Length);
        }

        [Fact]
        public void RefusesADescriptorWhoseLastFieldRunsPastTheEndOfTheFile()
        {
            // MEASURED on the real binary, and the reason the boundary test is a
            // walk rather than a re-encode: truncating the descriptor by one byte
            // leaves something a re-encode reproduces EXACTLY, because the final
            // field's declared length runs off the end and the copy silently comes
            // up short. Only the overshoot is detectable.
            var descriptor = Descriptor();
            var read = PrincipiaDescriptorReader.Read(
                Binary(Filler(16), descriptor.Take(descriptor.Length - 1).ToArray(), Array.Empty<byte>()));

            Assert.False(read.Found);
            Assert.NotNull(read.Reason);
            Assert.Contains("past the end", read.Reason!, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public void FindsAMarkerLyingAcrossTwoScanChunks()
        {
            // The scan reads in chunks and carries a tail so a marker split across
            // the join is still seen. Without the carry this returns not-found on a
            // perfectly good binary, and not-found is indistinguishable from a file
            // that genuinely has no descriptor.
            const int chunk = 1024 * 1024;
            var descriptor = Descriptor();
            var read = PrincipiaDescriptorReader.Read(
                Binary(Filler(chunk - 5), descriptor, Filler(64)));

            Assert.True(read.Found);
            Assert.Equal(chunk - 5, read.Offset);
            Assert.Equal(descriptor.Length, read.Length);
        }

        [Fact]
        public void SaysSoWhenThereIsNoDescriptorAtAll()
        {
            var read = PrincipiaDescriptorReader.Read(new MemoryStream(Filler(65536)));

            Assert.False(read.Found);
            Assert.NotNull(read.Reason);
            Assert.Null(read.Sha256);
        }

        [Fact]
        public void TheFileNameAloneIsNotTheMarker()
        {
            // The name appears in log strings and symbol tables too. The marker
            // carries protobuf's own tag and length bytes so a bare mention is not
            // mistaken for the descriptor's first field.
            var mention = Encoding.ASCII.GetBytes("opening serialization/journal.proto for write");
            var read = PrincipiaDescriptorReader.Read(
                new MemoryStream(Filler(32).Concat(mention).Concat(Filler(32)).ToArray()));

            Assert.False(read.Found);
        }

        [Fact]
        public void RefusesAStreamItCannotSeekRatherThanReadingItWrong()
        {
            var read = PrincipiaDescriptorReader.Read(new NonSeekableStream(Descriptor()));

            Assert.False(read.Found);
            Assert.Contains("seek", read.Reason!, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public void NoStreamIsRefused()
        {
            var read = PrincipiaDescriptorReader.Read(null);
            Assert.False(read.Found);
            Assert.NotNull(read.Reason);
        }

        private sealed class NonSeekableStream : MemoryStream
        {
            public NonSeekableStream(byte[] bytes) : base(bytes) { }
            public override bool CanSeek => false;
        }
    }
}

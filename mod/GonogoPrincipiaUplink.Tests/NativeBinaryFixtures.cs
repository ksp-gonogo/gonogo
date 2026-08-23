using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// Builds the smallest byte sequences that are genuinely an ELF, a PE and a
    /// Mach-O, so the export reader is driven against real headers rather than a
    /// double of them.
    ///
    /// <para>The alternative was checking the reader in against the shipped
    /// Principia builds, which are 270 MB of a third party's and can never be
    /// committed. These run everywhere, including CI, and they can express the
    /// cases the shipped builds do not contain: an import mixed in with the
    /// exports, a stripped module, a byte order nobody ships.</para>
    ///
    /// <para>Each builder places its tables at offsets that differ from the
    /// addresses naming them, so a reader that confuses the two fails here.</para>
    /// </summary>
    internal static class NativeBinaryFixtures
    {
        /// <summary>Where <see cref="Elf"/> puts <c>.dynsym</c> in its section table.</summary>
        private const int DynsymIndex = 2;

        /// <summary>
        /// Names <see cref="Pe"/> plants past the end of its export name table.
        /// Anything that reports one of these read further than the directory said
        /// it should.
        /// </summary>
        internal static readonly string[] TrapExports =
        {
            "principia__PastTheEndA",
            "principia__PastTheEndB",
        };

        /// <summary>
        /// A 64-bit little-endian shared object carrying a <c>.dynsym</c>.
        /// <paramref name="imported"/> become undefined symbols and
        /// <paramref name="local"/> locally-bound ones, neither of which a loader
        /// would let another module bind to.
        /// </summary>
        internal static byte[] Elf(
            IEnumerable<string> exported,
            IEnumerable<string>? imported = null,
            IEnumerable<string>? local = null,
            IEnumerable<string>? hidden = null,
            bool countInFirstSection = false,
            bool stringTableLast = true,
            byte elfClass = 2,
            byte byteOrder = 1)
        {
            var strings = new StringTable();
            var symbols = new List<byte[]>();
            // Index 0 of a symbol table is reserved and always zeroed.
            symbols.Add(new byte[24]);

            foreach (var name in exported)
            {
                symbols.Add(ElfSymbol(strings.Add(name), (1 << 4) | 2, 0, 1));
            }
            foreach (var name in imported ?? new string[0])
            {
                symbols.Add(ElfSymbol(strings.Add(name), (1 << 4) | 2, 0, 0));
            }
            foreach (var name in local ?? new string[0])
            {
                symbols.Add(ElfSymbol(strings.Add(name), (0 << 4) | 2, 0, 1));
            }
            foreach (var name in hidden ?? new string[0])
            {
                // Globally bound and defined, but STV_HIDDEN, so the dynamic linker
                // will not hand it to anyone. Everything about it except the
                // visibility byte reads as an export.
                symbols.Add(ElfSymbol(strings.Add(name), (1 << 4) | 2, 2, 1));
            }

            var stringBytes = strings.ToArray();
            const int headerSize = 64;
            const int sectionSize = 64;
            const int sectionCount = 4;
            // .dynsym names its string table by index, and it is never the one after
            // it. Putting .dynstr at either end, with a decoy holding the other,
            // means no fixed index reads the names correctly and the sh_link has to
            // be followed.
            var stringIndex = stringTableLast ? 3 : 1;
            var decoyIndex = stringTableLast ? 1 : 3;
            long stringOffset = headerSize;
            var symbolOffset = Align8(stringOffset + stringBytes.Length);
            var symbolBytes = symbols.Count * 24;
            var sectionOffset = Align8(symbolOffset + symbolBytes);

            var file = new byte[sectionOffset + sectionCount * sectionSize];
            file[0] = 0x7F;
            file[1] = (byte)'E';
            file[2] = (byte)'L';
            file[3] = (byte)'F';
            file[4] = elfClass;
            file[5] = byteOrder;
            file[6] = 1;
            PutU16(file, 0x10, 3);
            PutU16(file, 0x12, 0x3E);
            PutU32(file, 0x14, 1);
            PutU64(file, 0x28, (ulong)sectionOffset);
            PutU16(file, 0x34, headerSize);
            PutU16(file, 0x3A, sectionSize);
            PutU16(file, 0x3C, countInFirstSection ? (ushort)0 : (ushort)sectionCount);
            PutU16(file, 0x3E, (ushort)stringIndex);

            Array.Copy(stringBytes, 0, file, (int)stringOffset, stringBytes.Length);
            var at = (int)symbolOffset;
            foreach (var symbol in symbols)
            {
                Array.Copy(symbol, 0, file, at, 24);
                at += 24;
            }

            var section0 = (int)sectionOffset;
            if (countInFirstSection)
            {
                PutU64(file, section0 + 32, sectionCount);
            }

            var dynsym = section0 + DynsymIndex * sectionSize;
            PutU32(file, dynsym + 4, 11);
            PutU64(file, dynsym + 24, (ulong)symbolOffset);
            PutU64(file, dynsym + 32, (ulong)symbolBytes);
            PutU32(file, dynsym + 40, (uint)stringIndex);
            PutU64(file, dynsym + 56, 24);

            var dynstr = section0 + stringIndex * sectionSize;
            PutU32(file, dynstr + 4, 3);
            PutU64(file, dynstr + 24, (ulong)stringOffset);
            PutU64(file, dynstr + 32, (ulong)stringBytes.Length);

            // The decoy is a string table's type over the SYMBOLS, so following the
            // wrong index yields names made of machine words rather than nothing.
            var decoy = section0 + decoyIndex * sectionSize;
            PutU32(file, decoy + 4, 3);
            PutU64(file, decoy + 24, (ulong)symbolOffset);
            PutU64(file, decoy + 32, (ulong)symbolBytes);

            return file;
        }

        /// <summary>An ELF with a section table holding no <c>.dynsym</c>.</summary>
        internal static byte[] StrippedElf()
        {
            var file = Elf(new[] { "principia__AdvanceTime" });
            // Retype .dynsym as SHT_PROGBITS, which is what stripping leaves.
            var sectionOffset = (long)ReadU64(file, 0x28);
            PutU32(file, (int)sectionOffset + DynsymIndex * 64 + 4, 1);
            return file;
        }

        /// <summary>
        /// A 64-bit PE with one section and an export directory. The section's
        /// address and its file offset deliberately differ, so a reader that treats
        /// an address as an offset reads the wrong bytes.
        /// </summary>
        internal static byte[] Pe(IEnumerable<string> exported, bool namesByOrdinalOnly = false)
        {
            const int peOffset = 0x80;
            const int optionalSize = 240;
            const int sectionTableOffset = peOffset + 24 + optionalSize;
            const uint sectionRva = 0x1000;
            const int sectionFileOffset = 0x400;

            var names = new List<string>(exported);
            var strings = new StringTable();
            var nameOffsets = new List<int>();
            foreach (var name in names)
            {
                nameOffsets.Add(strings.Add(name));
            }
            // Two more strings than the directory names, sitting immediately after
            // the name table. A module exports more functions than it names, so a
            // reader that counts by NumberOfFunctions walks two entries too far, and
            // these are what it picks up.
            var trapA = strings.Add(TrapExports[0]);
            var trapB = strings.Add(TrapExports[1]);
            var stringBytes = strings.ToArray();

            const int nameTableAt = 40;
            var trapTableAt = nameTableAt + names.Count * 4;
            var ordinalsAt = trapTableAt + 8;
            var stringsAt = ordinalsAt + names.Count * 2;
            var sectionBytes = new byte[stringsAt + stringBytes.Length];

            PutU32(sectionBytes, 16, 1);
            PutU32(sectionBytes, 20, (uint)names.Count + 2);
            PutU32(sectionBytes, 24, namesByOrdinalOnly ? 0u : (uint)names.Count);
            // The code addresses, out in a .text this fixture does not have, which
            // is where they belong and which makes them useless as name addresses.
            PutU32(sectionBytes, 28, 0x2000);
            PutU32(sectionBytes, 32, namesByOrdinalOnly ? 0u : sectionRva + nameTableAt);
            PutU32(sectionBytes, 36, sectionRva + (uint)ordinalsAt);
            for (var i = 0; i < names.Count; i++)
            {
                PutU32(sectionBytes, nameTableAt + i * 4, sectionRva + (uint)(stringsAt + nameOffsets[i]));
                PutU16(sectionBytes, ordinalsAt + i * 2, (ushort)i);
            }
            PutU32(sectionBytes, trapTableAt, sectionRva + (uint)(stringsAt + trapA));
            PutU32(sectionBytes, trapTableAt + 4, sectionRva + (uint)(stringsAt + trapB));
            Array.Copy(stringBytes, 0, sectionBytes, stringsAt, stringBytes.Length);

            var file = new byte[sectionFileOffset + sectionBytes.Length];
            file[0] = (byte)'M';
            file[1] = (byte)'Z';
            PutU32(file, 0x3C, peOffset);

            file[peOffset] = (byte)'P';
            file[peOffset + 1] = (byte)'E';
            PutU16(file, peOffset + 4, 0x8664);
            PutU16(file, peOffset + 6, 1);
            PutU16(file, peOffset + 20, optionalSize);
            PutU16(file, peOffset + 22, 0x2022);

            var optional = peOffset + 24;
            PutU16(file, optional, 0x20B);
            PutU32(file, optional + 32, 0x1000);
            PutU32(file, optional + 36, 0x200);
            PutU32(file, optional + 108, 16);
            PutU32(file, optional + 112, sectionRva);
            PutU32(file, optional + 116, (uint)sectionBytes.Length);

            var rdata = Encoding.ASCII.GetBytes(".rdata");
            Array.Copy(rdata, 0, file, sectionTableOffset, rdata.Length);
            PutU32(file, sectionTableOffset + 8, (uint)sectionBytes.Length);
            PutU32(file, sectionTableOffset + 12, sectionRva);
            PutU32(file, sectionTableOffset + 16, (uint)sectionBytes.Length);
            PutU32(file, sectionTableOffset + 20, sectionFileOffset);

            Array.Copy(sectionBytes, 0, file, sectionFileOffset, sectionBytes.Length);
            return file;
        }

        /// <summary>
        /// A 64-bit little-endian Mach-O carrying <c>LC_SYMTAB</c>. Every name goes
        /// in with the leading underscore the Mach-O C ABI puts there, because that
        /// is what the shipped macOS build holds and stripping it back off is the
        /// reader's job.
        /// </summary>
        internal static byte[] MachO(
            IEnumerable<string> exported,
            IEnumerable<string>? imported = null,
            IEnumerable<string>? local = null,
            IEnumerable<string>? debug = null,
            uint magic = 0xFEEDFACF,
            bool withoutSymbolTable = false)
        {
            var strings = new StringTable();
            var symbols = new List<byte[]>();
            foreach (var name in exported)
            {
                symbols.Add(MachSymbol(strings.Add("_" + name), 0x0F, 1));
            }
            foreach (var name in imported ?? new string[0])
            {
                symbols.Add(MachSymbol(strings.Add("_" + name), 0x01, 0));
            }
            foreach (var name in local ?? new string[0])
            {
                // N_SECT without N_EXT: defined here and visible to nobody, which is
                // what a `static` function compiles to.
                symbols.Add(MachSymbol(strings.Add("_" + name), 0x0E, 1));
            }
            foreach (var name in debug ?? new string[0])
            {
                // A debug record whose low bits ALSO spell out N_SECT | N_EXT. Any
                // bit of N_STAB means the byte is a stab type and its low bits mean
                // nothing else, so this entry is only excluded by reading N_STAB
                // first. Picked deliberately: the stab types Apple defines are all
                // even, so a realistic one is thrown out by the N_EXT test instead
                // and leaves the N_STAB rule unmeasured.
                symbols.Add(MachSymbol(strings.Add("_" + name), 0x2F, 1));
            }
            var stringBytes = strings.ToArray();

            // An LC_UUID ahead of LC_SYMTAB, so the walk has to step over something
            // to reach it rather than finding it first.
            const int filler = 24;
            var commandBytes = filler + (withoutSymbolTable ? 0 : 24);
            var symbolOffset = Align8(32 + commandBytes);
            var stringOffset = symbolOffset + symbols.Count * 16;

            var file = new byte[stringOffset + stringBytes.Length];
            PutU32(file, 0, magic);
            PutU32(file, 4, 0x01000007);
            PutU32(file, 8, 3);
            PutU32(file, 12, 6);
            PutU32(file, 16, withoutSymbolTable ? 1u : 2u);
            PutU32(file, 20, (uint)commandBytes);

            PutU32(file, 32, 0x1B);
            PutU32(file, 36, filler);
            if (!withoutSymbolTable)
            {
                var symtab = 32 + filler;
                PutU32(file, symtab, 0x2);
                PutU32(file, symtab + 4, 24);
                PutU32(file, symtab + 8, (uint)symbolOffset);
                PutU32(file, symtab + 12, (uint)symbols.Count);
                PutU32(file, symtab + 16, (uint)stringOffset);
                PutU32(file, symtab + 20, (uint)stringBytes.Length);
            }

            var at = (int)symbolOffset;
            foreach (var symbol in symbols)
            {
                Array.Copy(symbol, 0, file, at, 16);
                at += 16;
            }
            Array.Copy(stringBytes, 0, file, (int)stringOffset, stringBytes.Length);
            return file;
        }

        private static byte[] ElfSymbol(int nameOffset, byte info, byte other, ushort section)
        {
            var symbol = new byte[24];
            PutU32(symbol, 0, (uint)nameOffset);
            symbol[4] = info;
            symbol[5] = other;
            PutU16(symbol, 6, section);
            PutU64(symbol, 8, 0x1000);
            PutU64(symbol, 16, 16);
            return symbol;
        }

        private static byte[] MachSymbol(int nameOffset, byte type, byte section)
        {
            var symbol = new byte[16];
            PutU32(symbol, 0, (uint)nameOffset);
            symbol[4] = type;
            symbol[5] = section;
            PutU64(symbol, 8, 0x1000);
            return symbol;
        }

        /// <summary>
        /// A string table in the shape all three formats use: NUL-terminated names,
        /// with offset zero reserved for the empty name.
        /// </summary>
        private sealed class StringTable
        {
            private readonly MemoryStream _bytes = new MemoryStream();

            public StringTable()
            {
                _bytes.WriteByte(0);
            }

            public int Add(string name)
            {
                var at = (int)_bytes.Position;
                var encoded = Encoding.ASCII.GetBytes(name);
                _bytes.Write(encoded, 0, encoded.Length);
                _bytes.WriteByte(0);
                return at;
            }

            public byte[] ToArray() => _bytes.ToArray();
        }

        private static long Align8(long value) => (value + 7) & ~7L;

        private static void PutU16(byte[] b, int at, ushort value)
        {
            b[at] = (byte)value;
            b[at + 1] = (byte)(value >> 8);
        }

        private static void PutU32(byte[] b, int at, uint value)
        {
            b[at] = (byte)value;
            b[at + 1] = (byte)(value >> 8);
            b[at + 2] = (byte)(value >> 16);
            b[at + 3] = (byte)(value >> 24);
        }

        private static void PutU64(byte[] b, int at, ulong value)
        {
            PutU32(b, at, (uint)value);
            PutU32(b, at + 4, (uint)(value >> 32));
        }

        private static ulong ReadU64(byte[] b, int at)
        {
            ulong value = 0;
            for (var i = 7; i >= 0; i--)
            {
                value = (value << 8) | b[at + i];
            }
            return value;
        }
    }
}

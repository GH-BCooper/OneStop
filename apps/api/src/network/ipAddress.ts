// IP address parsing and classification (17-online-media-network-tools.md).
//
// Two jobs, one table: telling the user what kind of address they typed, and telling `ssrf.ts`
// whether a resolved address is one OneStop is allowed to connect to. Keeping both on the same
// data means the "is this private?" answer can never drift between the two.
export type IpVersion = 4 | 6;

export interface ParsedIp {
  version: IpVersion;
  /** The address written back in its canonical form. */
  text: string;
  /** IPv4 as a uint32; IPv6 as the full 128-bit value. */
  value: bigint;
  /** IPv6 only: the top 64 bits, which is what the bundled country table is keyed on. */
  hi: bigint;
}

export interface IpClass {
  /** "public", or the name of the special-purpose block it falls in. */
  scope:
    | "public"
    | "loopback"
    | "private"
    | "link-local"
    | "shared"
    | "multicast"
    | "reserved"
    | "unspecified"
    | "documentation"
    | "carrier-grade-nat"
    | "benchmarking"
    | "unique-local"
    | "ipv4-mapped";
  /** True when OneStop must refuse to connect to it (SSRF defence, CLAUDE.md §6). */
  routable: boolean;
  description: string;
}

const V4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseIpv4(text: string): ParsedIp | null {
  const m = V4_RE.exec(text.trim());
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  const value = BigInt(
    ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!,
  );
  return { version: 4, text: parts.join("."), value, hi: value };
}

export function parseIpv6(text: string): ParsedIp | null {
  let raw = text.trim().replace(/^\[|\]$/g, "");
  if (!raw.includes(":")) return null;
  const zone = raw.indexOf("%");
  if (zone >= 0) raw = raw.slice(0, zone);

  // An IPv4-mapped tail ("::ffff:1.2.3.4") is rewritten to two hex groups first.
  const tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(raw);
  if (tail) {
    const v4 = parseIpv4(tail[1]!);
    if (!v4) return null;
    const n = Number(v4.value);
    raw = `${raw.slice(0, tail.index)}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }

  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0]!.split(":");
  const rest = halves.length === 2 ? (halves[1] === "" ? [] : halves[1]!.split(":")) : null;
  const groups =
    rest === null
      ? head
      : [...head, ...Array<string>(8 - head.length - rest.length).fill("0"), ...rest];
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return { version: 6, text: canonicalIpv6(value), value, hi: value >> 64n };
}

/** RFC 5952 form: lower case, no leading zeros, longest run of zero groups collapsed once. */
export function canonicalIpv6(value: bigint): string {
  const groups: number[] = [];
  for (let i = 7; i >= 0; i--) groups.push(Number((value >> BigInt(i * 16)) & 0xffffn));
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] !== 0) continue;
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) {
      bestLen = j - i;
      bestStart = i;
    }
    i = j;
  }
  const text = groups.map((g) => g.toString(16));
  if (bestLen < 2) return text.join(":");
  return `${text.slice(0, bestStart).join(":")}::${text.slice(bestStart + bestLen).join(":")}`;
}

export function parseIp(text: string): ParsedIp | null {
  return parseIpv4(text) ?? parseIpv6(text);
}

const v4Block = (cidr: string): [bigint, bigint] => {
  const [base, bitsText] = cidr.split("/");
  const start = parseIpv4(base!)!.value;
  const bits = Number(bitsText);
  const size = 1n << BigInt(32 - bits);
  return [start, start + size - 1n];
};

const V4_SPECIAL: { range: [bigint, bigint]; cls: IpClass }[] = (
  [
    ["0.0.0.0/8", "unspecified", "this network — not a real destination"],
    ["10.0.0.0/8", "private", "a private network address (RFC 1918)"],
    ["100.64.0.0/10", "carrier-grade-nat", "a carrier-grade NAT address (RFC 6598)"],
    ["127.0.0.0/8", "loopback", "the loopback address of the machine asking"],
    ["169.254.0.0/16", "link-local", "a link-local address (RFC 3927)"],
    ["172.16.0.0/12", "private", "a private network address (RFC 1918)"],
    ["192.0.0.0/24", "reserved", "an IETF protocol assignment"],
    ["192.0.2.0/24", "documentation", "reserved for documentation (TEST-NET-1)"],
    ["192.88.99.0/24", "reserved", "the deprecated 6to4 relay anycast block"],
    ["192.168.0.0/16", "private", "a private network address (RFC 1918)"],
    ["198.18.0.0/15", "benchmarking", "reserved for network benchmarking"],
    ["198.51.100.0/24", "documentation", "reserved for documentation (TEST-NET-2)"],
    ["203.0.113.0/24", "documentation", "reserved for documentation (TEST-NET-3)"],
    ["224.0.0.0/4", "multicast", "a multicast group, not a single host"],
    ["240.0.0.0/4", "reserved", "reserved for future use"],
  ] as const
).map(([cidr, scope, description]) => ({
  range: v4Block(cidr),
  cls: { scope, routable: false, description } as IpClass,
}));

export function classifyIp(ip: ParsedIp): IpClass {
  if (ip.version === 4) {
    for (const { range, cls } of V4_SPECIAL) {
      if (ip.value >= range[0] && ip.value <= range[1]) return cls;
    }
    return { scope: "public", routable: true, description: "a public, routable address" };
  }
  const hi16 = Number(ip.value >> 112n);
  if (ip.value === 0n)
    return { scope: "unspecified", routable: false, description: "the unspecified address (::)" };
  if (ip.value === 1n)
    return { scope: "loopback", routable: false, description: "the IPv6 loopback address (::1)" };
  // ::ffff:0:0/96 — an IPv4 address in IPv6 clothing; judge it as the IPv4 address it wraps.
  if (ip.value >> 32n === 0xffffn) {
    const inner = classifyIp({
      version: 4,
      text: "",
      value: ip.value & 0xffffffffn,
      hi: ip.value & 0xffffffffn,
    });
    return inner.routable
      ? { scope: "ipv4-mapped", routable: true, description: "an IPv4 address written as IPv6" }
      : inner;
  }
  if ((hi16 & 0xfe00) === 0xfc00)
    return {
      scope: "unique-local",
      routable: false,
      description: "a unique local address (fc00::/7)",
    };
  if ((hi16 & 0xffc0) === 0xfe80)
    return {
      scope: "link-local",
      routable: false,
      description: "a link-local address (fe80::/10)",
    };
  if ((hi16 & 0xff00) === 0xff00)
    return {
      scope: "multicast",
      routable: false,
      description: "a multicast group, not a single host",
    };
  if (ip.value >> 96n === 0x20010db8n)
    return {
      scope: "documentation",
      routable: false,
      description: "reserved for documentation (2001:db8::/32)",
    };
  // 2001:2::/48 — the IPv6 benchmarking block (RFC 5180).
  if (ip.value >> 80n === 0x200100020000n)
    return {
      scope: "benchmarking",
      routable: false,
      description: "reserved for network benchmarking",
    };
  return { scope: "public", routable: true, description: "a public, routable address" };
}

/** The one question `ssrf.ts` and the lookups both ask. */
export function isPubliclyRoutable(text: string): boolean {
  const ip = parseIp(text);
  return ip ? classifyIp(ip).routable : false;
}

/** The reverse-DNS name of an address: "8.8.8.8" -> "8.8.8.8.in-addr.arpa". */
export function reverseName(ip: ParsedIp): string {
  if (ip.version === 4) return `${ip.text.split(".").reverse().join(".")}.in-addr.arpa`;
  const hex = ip.value.toString(16).padStart(32, "0");
  return `${[...hex].reverse().join(".")}.ip6.arpa`;
}

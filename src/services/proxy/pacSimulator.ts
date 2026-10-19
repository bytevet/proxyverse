import { IPv4, IPv6, isValidCIDR, parseCIDR } from "ipaddr.js";

export const UNKNOWN = undefined;

/** The network address and mask of a CIDR, as PAC's isInNet takes them. */
export function cidrNetMask(
  cidr: string
): { ip: string; mask: string } | undefined {
  if (!isValidCIDR(cidr)) return;
  try {
    const [ip, prefix] = parseCIDR(cidr);
    const mask = (ip.kind() == "ipv4" ? IPv4 : IPv6).subnetMaskFromPrefixLength(
      prefix
    );
    return { ip: ip.toString(), mask: mask.toNormalizedString() };
  } catch (e) {
    console.error(e);
  }
}

/** isInNet for a CIDR: UNKNOWN for hostnames, false for an invalid CIDR. */
export function isInCIDR(host: string, cidr: string) {
  const net = cidrNetMask(cidr);
  return net ? isInNet(host, net.ip, net.mask) : false;
}

// copy from Mozilla's implementation
// https://github.com/mozilla/pjs/blob/cbcb610a8cfb035c37fe3103fc2a2eb3b214921a/netwerk/base/src/nsProxyAutoConfig.js#L4

export function shExpMatch(url: string, pattern: string) {
  const re = new RegExp(
    "^" +
      pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") +
      "$",
  );
  return re.test(url);
}

/** The URL regex rule `pattern` as a RegExp, or undefined if it's invalid. */
export function urlRegExp(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern);
  } catch {
    return;
  }
}

export function isInNet(ipaddr: string, pattern: string, maskstr: string) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ipaddr);
  if (match == null) {
    // Can't resolve hostnames to IPs in extension context (no DNS access)
    return UNKNOWN;
  }
  if (
    +match[1] > 255 ||
    +match[2] > 255 ||
    +match[3] > 255 ||
    +match[4] > 255
  ) {
    return UNKNOWN;
  }
  const host = convert_addr(ipaddr);
  const pat = convert_addr(pattern);
  const mask = convert_addr(maskstr);
  return (host & mask) == (pat & mask);
}

function convert_addr(ipchars: string) {
  const bytes = ipchars.split(".");
  return (
    ((+bytes[0] & 0xff) << 24) |
    ((+bytes[1] & 0xff) << 16) |
    ((+bytes[2] & 0xff) << 8) |
    (+bytes[3] & 0xff)
  );
}

export function isPlainHostName(host: string) {
  return host.search("\\.") == -1;
}

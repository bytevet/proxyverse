export const UNKNOWN = undefined;

// copy from Mozilla's implementation
// https://github.com/mozilla/pjs/blob/cbcb610a8cfb035c37fe3103fc2a2eb3b214921a/netwerk/base/src/nsProxyAutoConfig.js#L4

export function shExpMatch(url: string, pattern: string) {
  pattern = pattern.replace(/\./g, "\\.");
  pattern = pattern.replace(/\*/g, ".*");
  pattern = pattern.replace(/\?/g, ".");
  var newRe = new RegExp("^" + pattern + "$");

  return newRe.test(url);
}

export function isInNet(ipaddr: string, pattern: string, maskstr: string) {
  var test = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ipaddr);
  if (test == null) {
    // ipaddr = dnsResolve(ipaddr);
    // if (ipaddr == null) return false;

    // Due to Chrome's limitation, we can't resolve the IP address here.
    // We just return false.
    return UNKNOWN;
  } else if (
    +test[1] > 255 ||
    +test[2] > 255 ||
    +test[3] > 255 ||
    +test[4] > 255
  ) {
    return UNKNOWN; // not an IP address
  }
  var host = convert_addr(ipaddr);
  var pat = convert_addr(pattern);
  var mask = convert_addr(maskstr);
  return (host & mask) == (pat & mask);
}

function convert_addr(ipchars: string) {
  var bytes = ipchars.split(".");
  var result =
    ((+bytes[0] & 0xff) << 24) |
    ((+bytes[1] & 0xff) << 16) |
    ((+bytes[2] & 0xff) << 8) |
    (+bytes[3] & 0xff);
  return result;
}

export function isPlainHostName(host: string) {
  return host.search("\\.") == -1;
}

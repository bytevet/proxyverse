import { expect, test, describe } from "vitest";
import { isInNet, UNKNOWN } from "@/services/proxy/pacSimulator";

describe("isInNet function", () => {
  describe("valid IP addresses that match the subnet", () => {
    test("should return true for IP in /24 subnet", () => {
      expect(isInNet("192.168.31.100", "192.168.31.0", "255.255.255.0")).toBe(
        true
      );
      expect(isInNet("192.168.1.1", "192.168.1.0", "255.255.255.0")).toBe(true);
      expect(isInNet("192.168.1.254", "192.168.1.0", "255.255.255.0")).toBe(
        true
      );
    });

    test("should return true for IP in /16 subnet", () => {
      expect(isInNet("192.168.100.50", "192.168.0.0", "255.255.0.0")).toBe(
        true
      );
      expect(isInNet("192.168.255.255", "192.168.0.0", "255.255.0.0")).toBe(
        true
      );
    });

    test("should return true for IP in /8 subnet", () => {
      expect(isInNet("10.100.200.50", "10.0.0.0", "255.0.0.0")).toBe(true);
      expect(isInNet("10.255.255.255", "10.0.0.0", "255.0.0.0")).toBe(true);
    });

    test("should return true for exact match with /32 subnet", () => {
      expect(isInNet("192.168.1.1", "192.168.1.1", "255.255.255.255")).toBe(
        true
      );
    });

    test("should return true for any IP with /0 subnet (all match)", () => {
      expect(isInNet("1.2.3.4", "0.0.0.0", "0.0.0.0")).toBe(true);
      expect(isInNet("255.255.255.255", "0.0.0.0", "0.0.0.0")).toBe(true);
    });

    test("should return true for localhost in 127.0.0.0/8", () => {
      expect(isInNet("127.0.0.1", "127.0.0.0", "255.0.0.0")).toBe(true);
      expect(isInNet("127.255.255.255", "127.0.0.0", "255.0.0.0")).toBe(true);
    });
  });

  describe("valid IP addresses that don't match the subnet", () => {
    test("should return false for IP outside /24 subnet", () => {
      expect(isInNet("192.168.2.100", "192.168.1.0", "255.255.255.0")).toBe(
        false
      );
      expect(isInNet("192.169.1.100", "192.168.1.0", "255.255.255.0")).toBe(
        false
      );
      expect(isInNet("193.168.1.100", "192.168.1.0", "255.255.255.0")).toBe(
        false
      );
    });

    test("should return false for IP outside /16 subnet", () => {
      expect(isInNet("192.169.1.100", "192.168.0.0", "255.255.0.0")).toBe(
        false
      );
      expect(isInNet("193.168.1.100", "192.168.0.0", "255.255.0.0")).toBe(
        false
      );
    });

    test("should return false for IP outside /8 subnet", () => {
      expect(isInNet("11.100.200.50", "10.0.0.0", "255.0.0.0")).toBe(false);
    });

    test("should return false for different IP with /32 subnet", () => {
      expect(isInNet("192.168.1.2", "192.168.1.1", "255.255.255.255")).toBe(
        false
      );
    });
  });

  describe("invalid IP addresses (should return UNKNOWN)", () => {
    test("should return UNKNOWN for hostnames", () => {
      expect(isInNet("example.com", "192.168.1.0", "255.255.255.0")).toBe(
        UNKNOWN
      );
      expect(isInNet("localhost", "127.0.0.0", "255.0.0.0")).toBe(UNKNOWN);
      expect(
        isInNet("subdomain.example.com", "192.168.1.0", "255.255.255.0")
      ).toBe(UNKNOWN);
    });

    test("should return UNKNOWN for IPs with out-of-range octets", () => {
      expect(isInNet("256.168.1.1", "192.168.1.0", "255.255.255.0")).toBe(
        UNKNOWN
      );
      expect(isInNet("192.256.1.1", "192.168.1.0", "255.255.255.0")).toBe(
        UNKNOWN
      );
      expect(isInNet("192.168.256.1", "192.168.1.0", "255.255.255.0")).toBe(
        UNKNOWN
      );
      expect(isInNet("192.168.1.256", "192.168.1.0", "255.255.255.0")).toBe(
        UNKNOWN
      );
      expect(isInNet("999.999.999.999", "192.168.1.0", "255.255.255.0")).toBe(
        UNKNOWN
      );
    });

    test("should return UNKNOWN for IPs with wrong format", () => {
      expect(isInNet("192.168.1", "192.168.1.0", "255.255.255.0")).toBe(
        UNKNOWN
      );
      expect(isInNet("192.168", "192.168.1.0", "255.255.255.0")).toBe(UNKNOWN);
      expect(isInNet("192", "192.168.1.0", "255.255.255.0")).toBe(UNKNOWN);
      expect(isInNet("192.168.1.1.1", "192.168.1.0", "255.255.255.0")).toBe(
        UNKNOWN
      );
    });

    test("should return UNKNOWN for empty string", () => {
      expect(isInNet("", "192.168.1.0", "255.255.255.0")).toBe(UNKNOWN);
    });

    test("should return UNKNOWN for non-numeric values", () => {
      expect(isInNet("abc.def.ghi.jkl", "192.168.1.0", "255.255.255.0")).toBe(
        UNKNOWN
      );
      expect(isInNet("192.168.1.a", "192.168.1.0", "255.255.255.0")).toBe(
        UNKNOWN
      );
    });

    test("should return UNKNOWN for IPs with leading zeros that exceed 255", () => {
      // Note: JavaScript parseInt("0256") = 256, so this should be caught
      expect(isInNet("0256.168.1.1", "192.168.1.0", "255.255.255.0")).toBe(
        UNKNOWN
      );
    });
  });

  describe("edge cases and boundary values", () => {
    test("should handle all zeros", () => {
      expect(isInNet("0.0.0.0", "0.0.0.0", "255.255.255.255")).toBe(true);
      expect(isInNet("0.0.0.1", "0.0.0.0", "255.255.255.0")).toBe(true);
    });

    test("should handle all 255s", () => {
      expect(
        isInNet("255.255.255.255", "255.255.255.255", "255.255.255.255")
      ).toBe(true);
      expect(isInNet("255.255.255.254", "255.255.255.0", "255.255.255.0")).toBe(
        true
      );
    });

    test("should handle boundary values in subnet", () => {
      // First IP in subnet
      expect(isInNet("192.168.1.0", "192.168.1.0", "255.255.255.0")).toBe(true);
      // Last IP in subnet
      expect(isInNet("192.168.1.255", "192.168.1.0", "255.255.255.0")).toBe(
        true
      );
      // IP just before subnet
      expect(isInNet("192.168.0.255", "192.168.1.0", "255.255.255.0")).toBe(
        false
      );
      // IP just after subnet
      expect(isInNet("192.168.2.0", "192.168.1.0", "255.255.255.0")).toBe(
        false
      );
    });

    test("should handle single octet subnet masks", () => {
      // /24 mask
      expect(isInNet("192.168.1.50", "192.168.1.0", "255.255.255.0")).toBe(
        true
      );
      // /16 mask
      expect(isInNet("192.168.50.100", "192.168.0.0", "255.255.0.0")).toBe(
        true
      );
      // /8 mask
      expect(isInNet("192.50.100.200", "192.0.0.0", "255.0.0.0")).toBe(true);
    });

    test("should handle non-standard subnet masks", () => {
      // /25 subnet (255.255.255.128)
      expect(isInNet("192.168.1.50", "192.168.1.0", "255.255.255.128")).toBe(
        true
      );
      expect(isInNet("192.168.1.200", "192.168.1.0", "255.255.255.128")).toBe(
        false
      );
      // /17 subnet (255.255.128.0)
      expect(isInNet("192.168.50.100", "192.168.0.0", "255.255.128.0")).toBe(
        true
      );
      expect(isInNet("192.168.200.100", "192.168.0.0", "255.255.128.0")).toBe(
        false
      );
    });
  });

  describe("real-world scenarios", () => {
    test("should match private network ranges", () => {
      // 10.0.0.0/8
      expect(isInNet("10.1.2.3", "10.0.0.0", "255.0.0.0")).toBe(true);
      // 172.16.0.0/12
      expect(isInNet("172.16.1.1", "172.16.0.0", "255.240.0.0")).toBe(true);
      expect(isInNet("172.31.255.255", "172.16.0.0", "255.240.0.0")).toBe(true);
      expect(isInNet("172.32.1.1", "172.16.0.0", "255.240.0.0")).toBe(false);
      // 192.168.0.0/16
      expect(isInNet("192.168.1.1", "192.168.0.0", "255.255.0.0")).toBe(true);
    });

    test("should handle loopback addresses", () => {
      expect(isInNet("127.0.0.1", "127.0.0.0", "255.0.0.0")).toBe(true);
      expect(isInNet("127.255.255.255", "127.0.0.0", "255.0.0.0")).toBe(true);
    });

    test("should handle multicast addresses", () => {
      // 224.0.0.0/4
      expect(isInNet("224.0.0.1", "224.0.0.0", "240.0.0.0")).toBe(true);
      expect(isInNet("239.255.255.255", "224.0.0.0", "240.0.0.0")).toBe(true);
    });
  });

  describe("mask validation", () => {
    test("should work with valid masks", () => {
      expect(isInNet("192.168.1.1", "192.168.1.0", "255.255.255.0")).toBe(true);
      expect(isInNet("192.168.1.1", "192.168.1.0", "255.255.0.0")).toBe(true);
      expect(isInNet("192.168.1.1", "192.168.1.0", "255.0.0.0")).toBe(true);
    });

    test("should handle invalid mask format (but function doesn't validate mask)", () => {
      // Note: The function doesn't validate the mask format,
      // it just uses it in the bitwise operation
      // Invalid masks get converted to 0 by convert_addr, which matches everything
      // This test documents the current behavior
      expect(isInNet("192.168.1.1", "192.168.1.0", "invalid")).toBe(true); // Invalid mask becomes 0, which matches all IPs
    });
  });
});

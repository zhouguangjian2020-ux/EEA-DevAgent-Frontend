type SecureRandomApi = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

const HEX = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, "0"));

/**
 * Creates a RFC 4122 version 4 UUID without relying on randomUUID(), which is
 * unavailable in some non-secure HTTP contexts such as an intranet IP address.
 * The fallback still uses Web Crypto's cryptographically secure random bytes.
 */
export function createUuid(cryptoApi: SecureRandomApi | undefined = (globalThis as typeof globalThis & { crypto?: SecureRandomApi }).crypto): string {
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues !== "function") {
    throw new Error("\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u652f\u6301\u5b89\u5168\u968f\u673a\u6570\uff0c\u65e0\u6cd5\u751f\u6210\u8bf7\u6c42 ID\u3002\u8bf7\u4f7f\u7528\u652f\u6301 Web Crypto \u7684\u6d4f\u89c8\u5668\u6216 HTTPS \u8bbf\u95ee\u3002");
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  // RFC 4122 version 4 and RFC 9562 variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) => HEX[value]).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

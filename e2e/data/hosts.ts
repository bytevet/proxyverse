let counter = 0;
const unique = () => `${process.pid}-${Date.now().toString(36)}-${++counter}`;

/**
 * A site host name no other test uses (*.test resolves to the direct
 * server), so late requests of an earlier test can't show up in this test's
 * request log.
 */
export function freshHost(prefix = "site") {
  return `${prefix}-${unique()}.test`;
}

/**
 * A host name for a test proxy no other test uses (*.proxy.internal
 * resolves to 127.0.0.1). Chrome caches proxy credentials per proxy host for
 * the lifetime of the browser, which the worker shares between tests.
 */
export function freshProxyHost() {
  return `proxy-${unique()}.proxy.internal`;
}

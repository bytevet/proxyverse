let counter = 0;

/**
 * A host name no other test uses (*.test resolves to 127.0.0.1), e.g.:
 * - a site, so late requests of an earlier test can't show up in this
 *   test's request log;
 * - a proxy host, as Chrome caches proxy credentials per proxy host for the
 *   lifetime of the browser, which the worker shares between tests.
 */
export function freshHost(prefix = "site") {
  return `${prefix}-${process.pid}-${Date.now().toString(36)}-${++counter}.test`;
}

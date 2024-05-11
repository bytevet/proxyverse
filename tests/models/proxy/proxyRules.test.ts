import { describe, expect, test } from '@jest/globals';
import { genSimpleProxyCfg } from "@/models/proxy/proxyRules.ts"
import { ProfileConfig } from '@/models/profile';

describe('testing genSimpleProxyCfg for direct and system', () => {
  test('proxy config mode', () => {
    const cfg = genSimpleProxyCfg('direct')
    expect(cfg.mode).toBe('direct');
  });
});

describe('testing bypass list', () => {
  test('bypass list with ipv6', () => {
    const profile: ProfileConfig = {
      profileID: '',
      color: '',
      profileName: '',
      proxyType: 'proxy',
      proxyRules: {
        default: {
          scheme: 'http',
          host: '127.0.0.1',
          port: 8080,
        },
        https: {
          scheme: 'direct',
          host: '',
        },
        bypassList: [
          '<local>',
          '127.0.0.1',
          '192.168.0.1/16',
          '[::1]',
          'fefe:13::abc/33',
        ]
      },
      pacScript: {}
    }
    const cfg = genSimpleProxyCfg(profile)
    expect(cfg.pacScript?.data).toMatch(/.*?isInNet\(host, '192\.168\.0\.1', '255\.255\.0\.0'\).*?/)
    expect(cfg.pacScript?.data).toMatch(/.*?isInNet\(host, 'fefe:13::abc', 'ffff:ffff:8000:0:0:0:0:0'\).*?/)
  })
})
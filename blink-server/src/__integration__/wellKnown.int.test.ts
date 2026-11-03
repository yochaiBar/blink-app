/**
 * /.well-known app-link files, served from env so invite links open the app.
 */
import { useTestServer } from './support/server';

const server = useTestServer();

describe('/.well-known', () => {
  it('serves apple-app-site-association for the configured app id', async () => {
    const res = await server.api().get('/.well-known/apple-app-site-association');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.applinks.details[0]).toMatchObject({
      appIDs: ['RW54G9U2AP.com.yochaibar.blinks'],
      components: [{ '/': '/join/*' }],
    });
  });

  it('serves assetlinks.json with every configured fingerprint', async () => {
    const res = await server.api().get('/.well-known/assetlinks.json');

    expect(res.status).toBe(200);
    expect(res.body[0].target).toEqual({
      namespace: 'android_app',
      package_name: 'com.yochaibar.blinks',
      sha256_cert_fingerprints: ['AA:BB:CC', 'DD:EE:FF'],
    });
  });
});

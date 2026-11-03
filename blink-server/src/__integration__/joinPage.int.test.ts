/**
 * GET /join/:code — the invite-link landing page for people without the app,
 * and the legal pages' contact address (env SUPPORT_EMAIL).
 */
import { useTestServer } from './support/server';

const server = useTestServer();

describe('GET /join/:code', () => {
  it('invites to the group, opens the app by scheme and offers the download link, escaped', async () => {
    const res = await server.api().get('/join/a1b2c3d4e5f6');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(res.text).toContain("You're invited to a Blinks group");
    expect(res.text).toContain('href="blink://join/A1B2C3D4E5F6"');
    // APP_DOWNLOAD_URL (from env) is escaped into the attribute.
    expect(res.text).toContain('href="https://testflight.apple.com/join/abc&quot;&lt;x&gt;"');
    expect(res.text).not.toContain('"<x>');
  });

  it('refuses anything that is not an invite code', async () => {
    for (const code of ['%3Cscript%3E', 'abc', 'a'.repeat(17), 'abc-def']) {
      const res = await server.api().get(`/join/${code}`);
      expect(res.status).toBe(404);
      expect(res.text).toContain("This invite link isn't valid");
      expect(res.text).not.toContain('<script>');
    }
  });
});

describe('legal pages', () => {
  it('give the configured support address and no other domain', async () => {
    for (const path of ['/privacy', '/terms']) {
      const res = await server.api().get(path);
      expect(res.status).toBe(200);
      expect(res.text).toContain('mailto:help@example.com');
      expect(res.text).not.toContain('{{SUPPORT_EMAIL}}');
    }
  });
});

import { Router } from 'express';
import { env } from '../config/env';

/** The paths invite links use: https://<link domain>/join/CODE. */
const INVITE_PATH = '/join/*';

type AppLinksEnv = Pick<typeof env, 'APPLE_TEAM_ID' | 'IOS_BUNDLE_ID' | 'ANDROID_PACKAGE' | 'ANDROID_CERT_SHA256'>;

/** iOS universal links (apple-app-site-association); null until the app id is configured. */
export function appleAppSiteAssociation(config: AppLinksEnv) {
  if (!config.APPLE_TEAM_ID || !config.IOS_BUNDLE_ID) return null;
  const appID = `${config.APPLE_TEAM_ID}.${config.IOS_BUNDLE_ID}`;
  return {
    applinks: {
      // `components` for iOS 13+, `paths` for older ones.
      details: [{ appIDs: [appID], appID, components: [{ '/': INVITE_PATH }], paths: [INVITE_PATH] }],
    },
  };
}

/** Android app links (assetlinks.json); null until the package and fingerprints are configured. */
export function assetLinks(config: AppLinksEnv) {
  const fingerprints = (config.ANDROID_CERT_SHA256 ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  if (!config.ANDROID_PACKAGE || fingerprints.length === 0) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: config.ANDROID_PACKAGE,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

// GET /.well-known/* — the OS fetches these from the link domain (plain
// JSON, no redirects) to decide whether invite links open the app.
const router = Router();

router.get('/apple-app-site-association', (_req, res) => {
  const body = appleAppSiteAssociation(env);
  if (!body) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.type('application/json').json(body);
});

router.get('/assetlinks.json', (_req, res) => {
  const body = assetLinks(env);
  if (!body) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(body);
});

export default router;

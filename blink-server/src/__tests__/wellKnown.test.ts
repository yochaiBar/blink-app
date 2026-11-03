import './setup';
import { appleAppSiteAssociation, assetLinks } from '../routes/wellKnown';

describe('app-link files', () => {
  it('are absent until configured', () => {
    expect(appleAppSiteAssociation({})).toBeNull();
    expect(appleAppSiteAssociation({ APPLE_TEAM_ID: 'RW54G9U2AP' })).toBeNull();
    expect(assetLinks({ ANDROID_PACKAGE: 'com.yochaibar.blinks' })).toBeNull();
    expect(assetLinks({ ANDROID_PACKAGE: 'com.yochaibar.blinks', ANDROID_CERT_SHA256: ' , ' })).toBeNull();
  });
});

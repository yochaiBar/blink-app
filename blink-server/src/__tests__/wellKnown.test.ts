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

describe('join landing page', () => {
  it('omits the get-the-app line until a download link is configured', () => {
    const { renderJoinPage } = jest.requireActual('../routes/joinPage');
    expect(renderJoinPage('ABC123')).not.toContain('Get the app');
    expect(renderJoinPage('ABC123', 'https://apps.example/blinks')).toContain('href="https://apps.example/blinks"');
  });
});

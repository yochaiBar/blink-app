import crypto from 'crypto';
import { Router } from 'express';
import { env } from '../config/env';
import { escapeHtml } from '../utils/html';

// Invite codes are 12 hex characters today (routes/groups.ts); accept any
// short alphanumeric code, case-insensitively, and nothing else.
const INVITE_CODE = /^[A-Za-z0-9]{4,16}$/;

const STYLE = `
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #0A0A0F; color: #F5F5F7; font-family: -apple-system, system-ui, sans-serif; }
  main { max-width: 360px; padding: 32px 24px; text-align: center; }
  h1 { font-size: 24px; margin: 0 0 8px; }
  p { color: #9B99AA; line-height: 1.5; }
  .code { font-family: ui-monospace, monospace; letter-spacing: 2px; color: #F5F5F7; }
  .open { display: inline-block; margin-top: 16px; padding: 14px 28px; border-radius: 999px;
          background: #FF6B4A; color: #fff; text-decoration: none; font-weight: 600; }
  a { color: #FF6B4A; }
`;
const STYLE_HASH = crypto.createHash('sha256').update(STYLE).digest('base64');
const CSP = `default-src 'none'; style-src 'sha256-${STYLE_HASH}'`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

/**
 * The page an invite link shows when the app isn't installed (with the app,
 * the OS opens it instead — routes/wellKnown.ts). `downloadUrl` adds a
 * get-the-app line.
 */
export function renderJoinPage(code: string, downloadUrl?: string): string {
  const safeCode = escapeHtml(code.toUpperCase());
  const getApp = downloadUrl
    ? `<p>Don't have Blinks yet? <a href="${escapeHtml(downloadUrl)}">Get the app</a>, then tap the link again.</p>`
    : '';
  return page(
    "You're invited to Blinks",
    `<h1>You're invited to a Blinks group</h1>
<p>Invite code <span class="code">${safeCode}</span></p>
<a class="open" href="blink://join/${safeCode}">Open in Blinks</a>
${getApp}`,
  );
}

export function renderInvalidJoinPage(): string {
  return page('Invite not found', `<h1>This invite link isn't valid</h1><p>Ask your friend to send it again.</p>`);
}

// GET /join/:code — invite links (https://<link domain>/join/CODE) land here
// in a browser. No lookup: the code is only shown back, never resolved.
const router = Router();

router.get('/:code', (req, res) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.type('html');
  const code = req.params.code;
  if (!INVITE_CODE.test(code)) {
    res.status(404).send(renderInvalidJoinPage());
    return;
  }
  res.send(renderJoinPage(code, env.APP_DOWNLOAD_URL));
});

export default router;

// HTML pages shown to people who open a SkyDrop share link.

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const LOGO = `<span class="logo"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.7 1.5A4 4 0 0 0 6.5 19z"/></svg></span>`;

const STYLE = `
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:clamp(15px,14px + .4vw,17px);scrollbar-width:none}
html::-webkit-scrollbar{display:none}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;
  font-family:Calibri,Carlito,Lato,"Segoe UI",system-ui,sans-serif;color:#0f172a;overflow-x:hidden;
  background:radial-gradient(900px 500px at 15% -10%,#38bdf8 0%,transparent 60%),radial-gradient(800px 500px at 100% 110%,#6366f1 0%,transparent 55%),linear-gradient(160deg,#0b1f3a,#0e3a6b)}
.card{width:100%;max-width:440px;background:#fff;border-radius:20px;padding:28px 24px;box-shadow:0 25px 60px rgba(2,12,40,.45)}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.2rem}
.logo{display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#0ea5e9,#4f46e5)}
h1{font-size:1.45rem;margin:18px 0 4px}
.sub{color:#64748b;margin-bottom:18px}
.box{background:#f1f6fc;border:1px solid #dce6f2;border-radius:14px;padding:14px 16px;margin-bottom:18px}
.label{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;margin-bottom:2px}
.value{font-weight:700;word-break:break-word}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid #dce6f2}
.exp{color:#b45309}
.btn{display:block;width:100%;padding:13px 16px;border:0;border-radius:12px;background:linear-gradient(135deg,#0ea5e9,#4f46e5);
  color:#fff;text-align:center;text-decoration:none;font:inherit;font-weight:700;cursor:pointer}
.btn:hover{filter:brightness(1.06)}
.btn:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #0284c7;outline-offset:2px}
input[type=password],input[type=text]{width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:10px;font:inherit;margin:6px 0 10px}
.err{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:10px;padding:10px 12px;margin-bottom:14px}
.lock{display:flex;align-items:center;gap:10px;margin-bottom:14px;color:#334155}
.lock svg{flex:none}
.show{display:flex;align-items:center;gap:8px;color:#475569;font-size:.95rem;margin-bottom:14px}
.foot{text-align:center;color:#94a3b8;font-size:.85rem;margin-top:16px}
.big{font-size:3.2rem;font-weight:700;color:#dc2626;line-height:1}
`;

function shell(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main class="card">
${body}
</main>
</body>
</html>`;
}

function expiredPage() {
  return shell(
    '410 Gone - Link Expired',
    `<div class="brand">${LOGO}<span>SkyDrop</span></div>
<p class="big" style="margin-top:22px">410</p>
<h1>Link Expired or Invalid</h1>
<p class="sub">This share link has expired, was stopped by its owner, or never existed. Ask the sender for a new link.</p>
<a class="btn" href="/">Go to SkyDrop</a>`
  );
}

/**
 * opts: token, fileName, sizeBytes, sharedBy, expiresAt (Date),
 *       protectedFile (bool), error (string), locked (bool)
 */
function landingPage(opts) {
  const expiresOn = new Date(opts.expiresAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const size = formatBytes(opts.sizeBytes);
  const token = esc(opts.token);

  const fileRow = opts.protectedFile
    ? `<div class="label">File</div><div class="value">Protected file</div>`
    : `<div class="label">File name${size ? ` (${esc(size)})` : ''}</div><div class="value">${esc(opts.fileName)}</div>`;

  const error = opts.error ? `<div class="err" role="alert">${esc(opts.error)}</div>` : '';

  let action;
  if (opts.protectedFile) {
    action = opts.locked
      ? ''
      : `<form method="POST" action="/share/${token}/download" autocomplete="off">
<div class="lock"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><span>The sender asked for a PIN or password.</span></div>
<label class="label" for="pw">PIN or password</label>
<input id="pw" name="password" type="password" required maxlength="64" autocomplete="off" autofocus>
<label class="show"><input type="checkbox" onchange="document.getElementById('pw').type=this.checked?'text':'password'"> Show</label>
<button class="btn" type="submit">Unlock and download</button>
</form>`;
  } else {
    action = `<a class="btn" href="/share/${token}?download=1">Download file</a>`;
  }

  return shell(
    opts.protectedFile ? 'Protected file - SkyDrop' : `${opts.fileName} - SkyDrop`,
    `<div class="brand">${LOGO}<span>SkyDrop</span></div>
<h1>A file was shared with you</h1>
<p class="sub">Check the details, then download.</p>
${error}
<div class="box">
  ${fileRow}
  <div class="grid">
    <div><div class="label">Shared by</div><div class="value">${esc(opts.sharedBy)}</div></div>
    <div><div class="label">Link expires</div><div class="value exp">${esc(expiresOn)}</div></div>
  </div>
</div>
${action}
<p class="foot">Shared securely with SkyDrop</p>`
  );
}

module.exports = { expiredPage, landingPage };

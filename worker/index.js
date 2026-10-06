// aref.dev on Cloudflare. The Worker sends the bare domain to www, handles the
// contact form (emailing each inquiry through Cloudflare Email Sending), and
// serves everything else from the static assets (see wrangler.jsonc).

const TYPES = new Set(['AI system', 'Web app', 'Website', 'Something else']);
const LIMITS = { name: 120, email: 200, type: 40, message: 5000 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // One canonical address: https://www.aref.dev
    if (url.hostname === 'aref.dev' || url.protocol === 'http:') {
      url.hostname = url.hostname === 'aref.dev' ? 'www.aref.dev' : url.hostname;
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === '/api/contact') return contact(request, env, url);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    const response = await env.ASSETS.fetch(request);
    // The workers.dev address is only a backup; keep it out of search results
    if (url.hostname.endsWith('.workers.dev')) {
      const backup = new Response(response.body, response);
      backup.headers.set('X-Robots-Tag', 'noindex');
      return backup;
    }
    return response;
  },
};

async function contact(request, env, url) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });

  // The form lives on this same site, so only accept posts from it
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'Origin not allowed' }, 403);

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Spam: a filled honeypot, or a form sent faster than a person can type.
  // Answer "ok" so bots learn nothing, but send nothing.
  if (data.company || Number(data.elapsed) < 3000) return json({ ok: true });

  const clean = {};
  for (const [key, max] of Object.entries(LIMITS)) clean[key] = String(data[key] ?? '').trim().slice(0, max);
  const problems = [];
  if (!clean.name) problems.push('name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) problems.push('email');
  if (!TYPES.has(clean.type)) problems.push('type');
  if (clean.message.length < 10) problems.push('message');
  if (problems.length) return json({ error: 'Invalid fields', fields: problems }, 422);

  const rows = [
    ['Name', clean.name],
    ['Email', clean.email],
    ['Building', clean.type],
    ['Page', String(data.page || '').slice(0, 300)],
  ];
  const text = `${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${clean.message}`;
  const html = `
    <table style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;border-collapse:collapse">
      ${rows.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:#85858a">${k}</td><td>${escapeHtml(v)}</td></tr>`).join('')}
    </table>
    <p style="font:15px/1.6 -apple-system,Segoe UI,sans-serif;white-space:pre-wrap;margin-top:16px">${escapeHtml(clean.message)}</p>`;

  try {
    await env.EMAIL.send({
      from: { email: env.FROM_EMAIL, name: 'aref.dev' },
      to: env.TO_EMAIL,
      replyTo: { email: clean.email, name: clean.name },
      subject: `Project inquiry: ${clean.type} · ${clean.name}`,
      text,
      html,
    });
  } catch (error) {
    console.error('Email send failed', error.code, error.message);
    return json({ error: 'Could not send' }, 502);
  }
  return json({ ok: true });
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

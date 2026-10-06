// Contact form → email. Receives the portfolio's inquiry form as JSON and
// sends it to my inbox through Resend, with the visitor as the reply-to.
//
// Secrets/vars (see wrangler.toml and README.md):
//   RESEND_API_KEY  secret, from resend.com
//   TO_EMAIL        where inquiries go
//   FROM_EMAIL      a sender on a domain verified in Resend
//   ALLOWED_ORIGINS comma-separated origins allowed to post

const TYPES = new Set(['AI system', 'Web app', 'Website', 'Something else']);
const LIMITS = { name: 120, email: 200, type: 40, message: 5000 };

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);
    if (!allowed.includes(origin)) return json({ error: 'Origin not allowed' }, 403, cors);

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400, cors);
    }

    // Spam: a filled honeypot or a form sent faster than a person can type.
    // Answer "ok" so bots don't learn anything, but send nothing.
    if (data.company || Number(data.elapsed) < 3000) return json({ ok: true }, 200, cors);

    const clean = {};
    for (const [key, max] of Object.entries(LIMITS)) {
      clean[key] = String(data[key] ?? '').trim().slice(0, max);
    }
    const problems = [];
    if (!clean.name) problems.push('name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) problems.push('email');
    if (!TYPES.has(clean.type)) problems.push('type');
    if (clean.message.length < 10) problems.push('message');
    if (problems.length) return json({ error: 'Invalid fields', fields: problems }, 422, cors);

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

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.FROM_EMAIL,
        to: [env.TO_EMAIL],
        reply_to: clean.email,
        subject: `Project inquiry: ${clean.type} · ${clean.name}`,
        text,
        html,
      }),
    });

    if (!res.ok) {
      console.error('Resend failed', res.status, await res.text());
      return json({ error: 'Could not send' }, 502, cors);
    }
    return json({ ok: true }, 200, cors);
  },
};

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

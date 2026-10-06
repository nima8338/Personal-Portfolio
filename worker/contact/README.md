# Contact form Worker

Sends the portfolio's inquiry form to your inbox through [Resend](https://resend.com). Until it's deployed, the form opens a pre-filled email instead, so nothing is broken in the meantime.

## Deploy

1. In Resend, verify `aref.dev` (Domains → Add domain, then add the DNS records it gives you).
2. From this folder:

   ```sh
   npx wrangler login
   npx wrangler secret put RESEND_API_KEY
   npx wrangler deploy
   ```

3. Copy the Worker URL it prints (or attach a custom domain such as `contact.aref.dev`) into `FORM_ENDPOINT` at the top of the inquiry form section in `script.js`.

## Spam protection

- A hidden "company" field that people never fill in but bots do.
- Submissions sent less than 3 seconds after the page loads are dropped.
- Only the origins in `ALLOWED_ORIGINS` can post.

If spam still gets through, add [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/).

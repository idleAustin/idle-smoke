# Security Policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Please do not open a public issue or pull request for a security problem.

Include the affected route or file, steps to reproduce, and the impact you observed. Reports are handled on a best-effort basis.

## Supported versions

Only the latest release from `main`, deployed at `idlemullet.com/idle-smoke`, receives security fixes. Staging builds (`idle-smoke-staging`) are not supported.

## What is protected

| Area | Control |
|------|---------|
| Player sessions | A random 256-bit bearer token is issued to the client. Only its SHA-256 hash is stored. |
| Passwords | Salted PBKDF2-SHA256, compared in constant time. |
| Apple / Google sign-in | The RS256 ID token is verified against the provider's JWKS keys. |
| Score fields | `POST /players` rejects client-supplied totals (`smoked`, `lifetime_smoked`, `unlocked_environments`, and similar). Shift totals always come from the server-side replay. |
| Request size | Bodies over 16 KB are rejected. |
| Abuse | 120 requests per minute per IP. |
| Admin routes | `/api/v1/admin/*` is gated by `ADMIN_PASSCODE` and `ADMIN_EMAILS`. |
| Account data | `DELETE /api/v1/players/me` deletes the player. Their shifts and sign-in records cascade. |
| Response headers | Both the Express server and the Worker set `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`. |

## Known limitations

These are accepted trade-offs today. They are listed so reports can focus on new issues.

- **Score integrity is plausibility, not proof.** On `POST /api/v1/shifts/finish` the server replays the submitted drag offsets and rejects any that are malformed, out of order, or outside 0 to 15,000 ms. It does not prove the drags happened. A scripted client can submit a plausible score within those bounds, and the finish handler does not compare the offsets with server-side elapsed time.
- **Rate limiting is per process.** The counter lives in memory, so each Node process and each Worker isolate counts separately. Treat it as best-effort, and add a Cloudflare rate-limiting rule if you need a hard limit.
- **Password hashing uses 50,000 PBKDF2 iterations.** That is below current OWASP guidance for PBKDF2-SHA256. Cloudflare Workers reject counts above 100,000, so the most it can be raised to there is 100,000, with a rehash on next login.

## Secrets

Secrets and OAuth client IDs are stored in Doppler (`dev`, `stg`, `prd`) and never committed. `.gitignore` excludes `.env*`, key files, and local SQLite state. If you find a committed secret, report it as a vulnerability and rotate it.

## Automated scanning

Snyk runs on every push and pull request to `main` and weekly on Mondays. See `.github/workflows/snyk.yml`.

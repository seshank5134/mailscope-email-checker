# MailScope — Email Deliverability Checker

A small Flask web application that screens a user-provided list of email addresses and labels each as **Likely to be delivered**, **Likely to bounce**, or **Unknown**.

## What it checks

1. **Basic format:** rejects common syntax errors.
2. **DNS mail routing:** checks MX records and uses the domain's A/AAAA address as a fallback when there is no MX record.
   The reserved `.invalid` suffix is recognized locally as non-deliverable, even when DNS is unreachable.
3. **Optional SMTP recipient probe:** if selected, connects to a domain's mail server and issues `MAIL FROM` / `RCPT TO` commands only. It never issues `DATA` and does not send an email message.
4. **Honest uncertainty:** a server may hide whether a mailbox exists, use catch-all addresses, or defer checks. In these cases, the result is `Unknown`.

## Result meanings

- **Likely to be delivered:** an SMTP server accepted the recipient command. This is not a guarantee of inbox delivery.
- **Likely to bounce:** the address has an obvious format problem, its domain has no usable mail route, or an SMTP server explicitly rejects the recipient.
- **Unknown:** the domain has mail routing but mailbox existence was not confirmed, or DNS/SMTP checks were blocked, timed out, or gave an ambiguous response.

## Run locally

Requires Python 3.10+.

```bash
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000. SMTP probing is off by default. If you understand the limitations and your network permits direct SMTP, set `ALLOW_SMTP_PROBE=true` before starting the app.

## Run tests

```bash
python -m unittest discover -s tests -v
```

## Deploy to Render

1. Push this repository to GitHub.
2. In Render, choose **New → Web Service** and connect the repository.
3. Render can use the included `render.yaml`, or set:
   - Build command: `pip install -r requirements.txt`
   - Start command: `gunicorn app:app`
4. Wait for the deploy to finish and open the public `onrender.com` URL.

## Deployment limitations

Render's free web services block outbound traffic to SMTP ports 25, 465 and 587. For that reason, this project keeps SMTP probing disabled by default and reports **Unknown** when a user requests SMTP probing in a deployment where `ALLOW_SMTP_PROBE` is not enabled. Format and DNS mail-routing checks still work when DNS access is available. For local experiments on a network you control, set `ALLOW_SMTP_PROBE=true` before starting the app. Do not treat DNS or SMTP acceptance as a delivery guarantee.

## Privacy and responsible use

- The application does not write email addresses to a database or application file.
- It accepts at most 20 addresses per request and limits request size.
- Do not use this tool to send messages. It sends no email messages.
- Use only addresses you are authorized to check. Avoid repeated bulk probing; remote mail servers may block or rate-limit checks.

## Project structure

```text
mailscope-email-checker/
├── app.py
├── requirements.txt
├── render.yaml
├── README.md
├── templates/
│   └── index.html
└── static/
    ├── app.js
    └── styles.css
```

## Known limitations

- Mailbox verification is inherently unreliable because many providers intentionally hide recipient existence.
- SMTP replies vary between providers; accepted recipients may still bounce later.
- Syntax checks are intentionally practical and do not accept every obscure RFC-valid address.
- There is no guarantee of final delivery, inbox placement, or deliverability reputation.

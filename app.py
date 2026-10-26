import os
import re
import socket
import smtplib
from email.utils import parseaddr

import dns.exception
import dns.resolver
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024  # Keep request bodies small.

MAX_EMAILS = 20
DNS_TIMEOUT = 3.0
SMTP_TIMEOUT = 4.0
# Keep SMTP probes off by default; free Render services block outbound SMTP ports.
ALLOW_SMTP_PROBE = os.getenv("ALLOW_SMTP_PROBE", "false").lower() in ("1", "true", "yes")
# A syntactically plausible mailbox; detailed RFC edge cases are intentionally
# not accepted because this is a practical screening tool, not an RFC parser.
LOCAL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$")
DOMAIN_LABEL_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")


def parse_email(raw):
    value = raw.strip()
    if not value or len(value) > 254 or value.count("@") != 1:
        return None
    local, domain = value.rsplit("@", 1)
    if (not local or len(local) > 64 or not LOCAL_RE.fullmatch(local)
            or local.startswith(".") or local.endswith(".") or ".." in local):
        return None
    domain = domain.rstrip(".")
    if not domain or len(domain) > 253 or "." not in domain:
        return None
    labels = domain.split(".")
    if any(not label or len(label) > 63 or not DOMAIN_LABEL_RE.fullmatch(label) for label in labels):
        return None
    return f"{local}@{domain.lower()}", domain.lower()


def get_mail_hosts(domain):
    """Return (hosts, status): status is ok, no_route, or unknown."""
    # RFC 2606 reserves .invalid for names that are guaranteed not to exist.
    # Classifying it locally also avoids turning a known-invalid test address
    # into Unknown when the current network cannot reach a DNS resolver.
    if domain.lower().endswith(".invalid"):
        return [], "no_route"

    resolver = dns.resolver.Resolver()
    resolver.timeout = DNS_TIMEOUT
    resolver.lifetime = DNS_TIMEOUT
    try:
        answers = resolver.resolve(domain, "MX")
        hosts = sorted((int(r.preference), str(r.exchange).rstrip(".")) for r in answers)
        # A sole null MX explicitly says the domain does not accept email.
        if len(hosts) == 1 and hosts[0][1] == "":
            return [], "no_route"
        return [host for _, host in hosts if host], "ok"
    except dns.resolver.NXDOMAIN:
        return [], "no_route"
    except dns.resolver.NoAnswer:
        # RFC 5321 implicit MX fallback: if no MX exists, try the domain's A record.
        try:
            resolver.resolve(domain, "A")
            return [domain], "ok"
        except dns.resolver.NXDOMAIN:
            return [], "no_route"
        except (dns.resolver.NoAnswer, dns.exception.Timeout, dns.resolver.NoNameservers):
            try:
                resolver.resolve(domain, "AAAA")
                return [domain], "ok"
            except dns.resolver.NXDOMAIN:
                return [], "no_route"
            except Exception:
                return [], "unknown"
    except (dns.exception.Timeout, dns.resolver.NoNameservers, dns.exception.DNSException):
        return [], "unknown"


def smtp_probe(address, hosts):
    """Try SMTP RCPT TO only; never issue DATA and never send a message."""
    for host in hosts[:2]:
        try:
            with smtplib.SMTP(host, 25, timeout=SMTP_TIMEOUT) as server:
                server.ehlo_or_helo_if_needed()
                code, _ = server.mail("")  # Null reverse-path; no message is sent.
                if code >= 500:
                    continue
                code, message = server.rcpt(address)
                if 200 <= code < 300:
                    return "likely_delivered", "The mail server accepted RCPT TO; this does not guarantee final delivery."
                if code in (550, 551, 553):
                    return "likely_bounce", "The mail server explicitly rejected the recipient during this check."
                # 4xx, catch-all policies, policy blocks and ambiguous replies stay unknown.
        except (OSError, smtplib.SMTPException, socket.timeout):
            continue
    return "unknown", "The recipient could not be confirmed. The server may block SMTP probes or hide mailbox existence."


def classify(raw, try_smtp):
    parsed = parse_email(raw)
    if not parsed:
        return {
            "email": raw.strip(), "status": "likely_bounce",
            "label": "Likely to bounce", "reason": "The address does not pass this tool's basic email-format checks."
        }

    address, domain = parsed
    hosts, dns_status = get_mail_hosts(domain)
    if dns_status == "no_route":
        return {
            "email": address, "status": "likely_bounce",
            "label": "Likely to bounce", "reason": "The domain appears not to have usable mail routing (MX or fallback address)."
        }
    if dns_status == "unknown":
        return {
            "email": address, "status": "unknown", "label": "Unknown",
            "reason": "DNS could not be checked reliably. A temporary DNS or network failure is not proof of a bad address."
        }
    if try_smtp and not ALLOW_SMTP_PROBE:
        return {
            "email": address, "status": "unknown", "label": "Unknown",
            "reason": "This deployment has SMTP probing disabled because the host may block outbound SMTP. Mail routing exists, but mailbox existence cannot be confirmed here."
        }
    if try_smtp:
        status, reason = smtp_probe(address, hosts)
        labels = {"likely_delivered": "Likely to be delivered", "likely_bounce": "Likely to bounce", "unknown": "Unknown"}
        return {"email": address, "status": status, "label": labels[status], "reason": reason}
    return {
        "email": address, "status": "unknown", "label": "Unknown",
        "reason": "The domain has mail routing, but this DNS-only check cannot confirm that the individual mailbox exists."
    }


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/api/check")
def check():
    payload = request.get_json(silent=True) or {}
    raw_text = payload.get("emails", "")
    if not isinstance(raw_text, str):
        return jsonify({"error": "Enter email addresses as text, one per line or separated by commas/semicolons."}), 400

    candidates = [item.strip() for item in re.split(r"[\n,;]+", raw_text) if item.strip()]
    if not candidates:
        return jsonify({"error": "Paste at least one email address to check."}), 400
    if len(candidates) > MAX_EMAILS:
        return jsonify({"error": f"Please check no more than {MAX_EMAILS} addresses per request."}), 400

    try_smtp = bool(payload.get("smtp_check", False))
    results = [classify(item, try_smtp) for item in candidates]
    counts = {key: sum(1 for row in results if row["status"] == key)
              for key in ("likely_delivered", "likely_bounce", "unknown")}
    return jsonify({"results": results, "counts": counts, "smtp_requested": try_smtp})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), debug=False)

import unittest
from unittest.mock import patch
import app as mail_app


class EmailParsingTests(unittest.TestCase):
    def test_valid_address(self):
        self.assertEqual(mail_app.parse_email("User.Name@example.com"),
                         ("User.Name@example.com", "example.com"))

    def test_domain_is_normalized(self):
        self.assertEqual(mail_app.parse_email("user@EXAMPLE.COM"),
                         ("user@example.com", "example.com"))

    def test_invalid_addresses(self):
        for value in ("", "missing-at-sign", "a@@example.com", ".a@example.com",
                      "a..b@example.com", "a@-bad.example", "a@example"):
            with self.subTest(value=value):
                self.assertIsNone(mail_app.parse_email(value))


class APIValidationTests(unittest.TestCase):
    def setUp(self):
        self.client = mail_app.app.test_client()

    def test_empty_request(self):
        response = self.client.post("/api/check", json={"emails": "  "})
        self.assertEqual(response.status_code, 400)

    def test_limit_is_enforced(self):
        response = self.client.post("/api/check", json={"emails": "\n".join(
            f"user{i}@example.com" for i in range(21)
        )})
        self.assertEqual(response.status_code, 400)

    @patch("app.get_mail_hosts", return_value=([], "no_route"))
    def test_missing_mail_route_is_likely_bounce(self, _mock_dns):
        response = self.client.post("/api/check", json={"emails": "user@example.com"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["results"][0]["status"], "likely_bounce")

    @patch("app.get_mail_hosts", return_value=(["mx.example.com"], "ok"))
    def test_dns_only_with_mx_is_unknown(self, _mock_dns):
        response = self.client.post("/api/check", json={"emails": "user@example.com"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["results"][0]["status"], "unknown")

    def test_health_endpoint(self):
        self.assertEqual(self.client.get("/health").json["status"], "ok")

    def test_reserved_invalid_domain_is_likely_bounce_without_dns(self):
        response = self.client.post("/api/check", json={"emails": "user@example.invalid"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["results"][0]["status"], "likely_bounce")


if __name__ == "__main__":
    unittest.main()

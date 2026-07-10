import unittest
from unittest.mock import patch

import httpx

import tools


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class ToolContractTests(unittest.TestCase):
    def tearDown(self):
        tools.auth_token_var.set("")
        tools.user_id_var.set(0)

    @patch("tools.httpx.get")
    def test_search_returns_facts_and_excludes_sensitive_listing_fields(self, get):
        get.return_value = FakeResponse(
            200,
            {
                "products": [
                    {
                        "id": 7,
                        "title": "Fixture Racket",
                        "price": 220,
                        "phoneNumber": "0123456789",
                        "image": "secret-image-url",
                        "weightCategory": "5U",
                        "flexibilityCategory": "High Flexibility",
                        "balanceCategory": "Head Light",
                        "sellerId": 3,
                        "sellerName": "Fixture Seller",
                        "rating": 4.5,
                    }
                ],
                "total": 1,
            },
        )
        result = tools.search_listings.invoke({"max_price": 300, "racket_only": True})
        listing = result["data"]["listings"][0]
        self.assertTrue(result["ok"])
        self.assertEqual(listing["url"], "/products/7")
        self.assertNotIn("phoneNumber", listing)
        self.assertNotIn("phone", listing)
        self.assertNotIn("image", listing)
        self.assertEqual(result["meta"]["rating_scope"], "listing")

    @patch("tools.httpx.get")
    def test_public_seller_profile_uses_allowlist(self, get):
        get.return_value = FakeResponse(
            200,
            {
                "id": 3,
                "username": "seller",
                "firstName": "Sell",
                "lastName": "Er",
                "bio": "Public bio",
                "email": "private@example.com",
                "phoneNo": "0123456789",
            },
        )
        result = tools.get_seller_profile.invoke({"seller_id": 3})
        seller = result["data"]["seller"]
        self.assertNotIn("email", seller)
        self.assertNotIn("phone", seller)
        self.assertNotIn("rating", seller)

    def test_spoofed_user_id_without_token_cannot_open_private_tool(self):
        tools.user_id_var.set(99)
        tools.auth_token_var.set("")
        result = tools.get_my_profile.invoke({})
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "AUTH_REQUIRED")

    @patch("tools.httpx.get")
    def test_order_forbidden_is_typed_and_bearer_token_is_forwarded(self, get):
        get.return_value = FakeResponse(403, {"error": "forbidden"})
        tools.auth_token_var.set("trusted-token")
        result = tools.get_order_detail.invoke({"order_id": 12})
        self.assertEqual(result["error"]["code"], "FORBIDDEN")
        self.assertEqual(
            get.call_args.kwargs["headers"],
            {"Authorization": "Bearer trusted-token"},
        )

    @patch("tools.httpx.get", side_effect=httpx.TimeoutException("slow"))
    def test_backend_timeout_is_structured(self, _get):
        result = tools.get_listing_detail.invoke({"listing_id": 1})
        self.assertEqual(result["error"]["code"], "TIMEOUT")


if __name__ == "__main__":
    unittest.main()

import os
import time
import hmac
import hashlib
import json
import urllib.request
import urllib.parse
from http.server import BaseHTTPRequestHandler

# ---- Configuration (set these as Environment Variables in Vercel, not here) ----
BINANCE_API_KEY = os.environ.get("BINANCE_API_KEY")
BINANCE_API_SECRET = os.environ.get("BINANCE_API_SECRET")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET")  # shared secret you also put in your TradingView alert JSON

# Use the real endpoint for live trading, or the testnet endpoint while testing:
BINANCE_BASE_URL = "https://api.binance.com"
# BINANCE_BASE_URL = "https://testnet.binance.vision"  # <-- use this for testnet


def sign_params(params: dict) -> str:
    """Binance requires an HMAC-SHA256 signature of the query string, using your API secret."""
    query_string = urllib.parse.urlencode(params)
    signature = hmac.new(
        BINANCE_API_SECRET.encode("utf-8"),
        query_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{query_string}&signature={signature}"


def place_binance_order(symbol: str, side: str, quantity: str, order_type: str = "MARKET"):
    """Places a market order on Binance Spot. Raises on error."""
    endpoint = f"{BINANCE_BASE_URL}/api/v3/order"

    params = {
        "symbol": symbol.upper(),
        "side": side.upper(),         # "BUY" or "SELL"
        "type": order_type,           # "MARKET" or "LIMIT" etc.
        "quantity": quantity,
        "timestamp": int(time.time() * 1000),
        "recvWindow": 5000,
    }

    signed_query = sign_params(params)
    url = f"{endpoint}?{signed_query}"

    req = urllib.request.Request(url, method="POST")
    req.add_header("X-MBX-APIKEY", BINANCE_API_KEY)

    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        raise RuntimeError(f"Binance API error {e.code}: {error_body}")


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_length)

        try:
            payload = json.loads(raw_body)
        except json.JSONDecodeError:
            self._send_json(400, {"error": "invalid JSON body"})
            return

        # --- Verify the shared secret, sent as a field inside the TradingView alert JSON ---
        if payload.get("secret") != WEBHOOK_SECRET:
            self._send_json(401, {"error": "unauthorized"})
            return

        symbol = payload.get("symbol")
        side = payload.get("side")
        quantity = payload.get("quantity")

        if not all([symbol, side, quantity]):
            self._send_json(400, {"error": "missing symbol, side, or quantity"})
            return

        try:
            result = place_binance_order(symbol, side, str(quantity))
            self._send_json(200, {"ok": True, "order": result})
        except Exception as e:
            self._send_json(500, {"ok": False, "error": str(e)})

    def do_GET(self):
        # Simple health check so you can confirm the endpoint is live in a browser
        self._send_json(200, {"status": "webhook is live"})

    def _send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

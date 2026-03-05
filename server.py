from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests as http_req
import hashlib, time, threading

app = Flask(__name__, static_folder='static', static_url_path='/static')
CORS(app)

# ---- Config ----
SALT = "T9do@SM1?xGn5"
SUFFIX = "/api/stream.php"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"

# ---- Performance: connection pool + cache ----
session = http_req.Session()
adapter = http_req.adapters.HTTPAdapter(pool_connections=10, pool_maxsize=20)
session.mount('https://', adapter)

cache = {}
CACHE_TTL = 300  # 5 min
cache_lock = threading.Lock()


def make_token(ts):
    return hashlib.md5(f"{SALT}{ts}{SUFFIX}".encode()).hexdigest()


def cache_get(key):
    with cache_lock:
        entry = cache.get(key)
        if entry and time.time() - entry['t'] < CACHE_TTL:
            return entry['data']
        if entry:
            del cache[key]
    return None


def cache_set(key, data):
    with cache_lock:
        cache[key] = {'data': data, 't': time.time()}
        # Evict old entries if cache grows too large
        if len(cache) > 200:
            oldest = min(cache, key=lambda k: cache[k]['t'])
            del cache[oldest]


@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


@app.route('/api/fetch', methods=['POST'])
def fetch_video():
    body = request.get_json(silent=True) or {}
    url = (body.get('url') or '').strip()
    if not url:
        return jsonify({"ok": False, "error": "URL is required"}), 400

    # Check cache first
    cached = cache_get(url)
    if cached:
        return jsonify({"ok": True, "data": cached, "cached": True})

    ts = str(int(time.time()))
    token = make_token(ts)

    try:
        r = session.post(
            f"https://playterabox.com/api/fetch-video?token={token}&t={ts}",
            headers={
                "accept": "*/*",
                "content-type": "application/json",
                "origin": "https://playterabox.com",
                "referer": f"https://playterabox.com/terabox-video-downloading?url={http_req.utils.quote(url, safe='')}",
                "user-agent": UA,
            },
            json={"url": url},
            timeout=15,
        )
        data = r.json()
        if r.status_code != 200 or data.get("status") != "success":
            return jsonify({"ok": False, "error": data.get("error") or data.get("message") or "API error"}), 400

        cache_set(url, data)
        return jsonify({"ok": True, "data": data, "cached": False})
    except http_req.exceptions.Timeout:
        return jsonify({"ok": False, "error": "Timed out — try again"}), 504
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


if __name__ == '__main__':
    print("\n  ✦  TeraBoxDL → http://localhost:5000\n")
    app.run(host='0.0.0.0', port=5000, debug=True)

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests as http_req
import hashlib, time, threading, asyncio, json

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
        if len(cache) > 200:
            oldest = min(cache, key=lambda k: cache[k]['t'])
            del cache[oldest]


# ==========================================
# API 1: PlayTeraBox (fast, no browser)
# ==========================================
def fetch_playterabox(url):
    ts = str(int(time.time()))
    token = make_token(ts)
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
        raise Exception(data.get("error") or data.get("message") or "API error")
    return data


# ==========================================
# API 2: iTeraPlay (needs Playwright cookies)
# ==========================================
def fetch_iteraplay(url):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(_fetch_iteraplay_async(url))
    finally:
        loop.close()


async def _fetch_iteraplay_async(terabox_url):
    from playwright.async_api import async_playwright

    print("  🔄 iTeraPlay: Launching browser...")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(user_agent=UA)

        # Set login cookies before navigating
        await context.add_cookies([
            {"name": "login_token", "value": "4e360f4c60785f1671f8b209f197d1c23692af278adec93b3db643e2baddb85374129f706dce1899aded67182a66303a52b22fe44627e177c418261ff9187a74", "domain": "iteraplay.com", "path": "/"},
            {"name": "remember_me", "value": "yes", "domain": "iteraplay.com", "path": "/"},
        ])

        page = await context.new_page()

        try:
            await page.goto("https://iteraplay.com/", wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(5)

            title = await page.title()
            print(f"  📄 Page: {title}")

            # Wait for Cloudflare challenge to resolve
            if "challenge" in title.lower() or "just a moment" in title.lower():
                print("  ⏳ Waiting for Cloudflare...")
                await asyncio.sleep(15)
                title = await page.title()
                print(f"  📄 Page after wait: {title}")
        except Exception as e:
            print(f"  ⚠️ Navigation: {e}")

        # Make the API call FROM INSIDE the browser (bypasses Cloudflare)
        print(f"  🔄 Calling API from browser context...")
        api_result = await page.evaluate("""
            async (url) => {
                try {
                    const resp = await fetch('https://iteraplay.com/api/stream', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': '*/*',
                        },
                        body: JSON.stringify({ url: url }),
                    });
                    const data = await resp.json();

                    // Handle token expiry
                    if (data.error_detail && data.error_detail.toLowerCase().includes('expired') && data.new_api_token) {
                        document.cookie = '__secure_token=' + data.new_api_token + '; path=/';
                        const resp2 = await fetch('https://iteraplay.com/api/stream', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Accept': '*/*',
                            },
                            body: JSON.stringify({ url: url }),
                        });
                        return await resp2.json();
                    }

                    return data;
                } catch (e) {
                    return { status: 'error', error: e.message };
                }
            }
        """, terabox_url)

        await browser.close()

    print(f"  ✅ API result status: {api_result.get('status')}")

    if api_result.get("status") != "success":
        raise Exception(api_result.get("error") or api_result.get("error_detail") or "iTeraPlay API error")
    return api_result


# ==========================================
# API 3: 1024TeraDownloader (full browser)
# ==========================================
def fetch_1024tera(url):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(_fetch_1024tera_async(url))
    finally:
        loop.close()


async def _fetch_1024tera_async(terabox_url):
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=UA,
            viewport={"width": 1920, "height": 1080},
        )
        page = await context.new_page()

        api_response_data = None

        async def handle_response(response):
            nonlocal api_response_data
            if "/api/stream" in response.url:
                try:
                    api_response_data = await response.json()
                except:
                    pass

        page.on("response", handle_response)

        try:
            await page.goto("https://1024teradownloader.com/", wait_until="domcontentloaded", timeout=30000)
        except:
            pass

        await asyncio.sleep(5)

        title = await page.title()
        if "challenge" in title.lower() or "cloudflare" in title.lower():
            await asyncio.sleep(10)

        # Find and fill input
        input_sel = await page.query_selector('input[type="text"], input[type="url"], input[name="url"], input[placeholder*="paste"], input[placeholder*="enter"], input[placeholder*="url"], textarea')
        if not input_sel:
            input_sel = await page.query_selector('input:not([type="hidden"]):not([type="submit"])')

        if input_sel:
            await input_sel.click()
            await input_sel.fill(terabox_url)
        else:
            await browser.close()
            raise Exception("Could not find input field on 1024teradownloader")

        # Click submit
        button_selectors = [
            'button:has-text("Continue")', 'button:has-text("Download")',
            'button:has-text("Get")', 'button:has-text("Submit")',
            'button[type="submit"]',
        ]
        clicked = False
        for sel in button_selectors:
            try:
                btn = await page.query_selector(sel)
                if btn:
                    await btn.click()
                    clicked = True
                    break
            except:
                continue

        if not clicked:
            buttons = await page.query_selector_all('button')
            for btn in buttons:
                text = await btn.text_content()
                if text and text.strip():
                    await btn.click()
                    clicked = True
                    break

        # Wait for API response
        for i in range(30):
            await asyncio.sleep(1)
            if api_response_data:
                break

        await browser.close()

        if not api_response_data:
            raise Exception("No response from 1024teradownloader (timeout)")

        if api_response_data.get("status") != "success":
            raise Exception(api_response_data.get("error") or "1024Tera API error")

        return api_response_data


# ==========================================
# Routes
# ==========================================
API_MAP = {
    "playterabox": {"fn": fetch_playterabox, "name": "PlayTeraBox", "speed": "fast"},
    "iteraplay":   {"fn": fetch_iteraplay,   "name": "iTeraPlay",   "speed": "medium"},
    "1024tera":    {"fn": fetch_1024tera,     "name": "1024Tera",    "speed": "slow"},
}


@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


@app.route('/api/fetch', methods=['POST'])
def fetch_video():
    body = request.get_json(silent=True) or {}
    url = (body.get('url') or '').strip()
    api = (body.get('api') or 'playterabox').strip()

    if not url:
        return jsonify({"ok": False, "error": "URL is required"}), 400

    if api not in API_MAP:
        return jsonify({"ok": False, "error": f"Unknown API: {api}"}), 400

    # Cache key includes api name
    cache_key = f"{api}:{url}"
    cached = cache_get(cache_key)
    if cached:
        return jsonify({"ok": True, "data": cached, "cached": True, "api": api})

    try:
        data = API_MAP[api]["fn"](url)
        cache_set(cache_key, data)
        return jsonify({"ok": True, "data": data, "cached": False, "api": api})
    except http_req.exceptions.Timeout:
        return jsonify({"ok": False, "error": "Timed out — try again"}), 504
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route('/api/sources', methods=['GET'])
def list_sources():
    """List available API sources for frontend."""
    sources = []
    for key, val in API_MAP.items():
        sources.append({"id": key, "name": val["name"], "speed": val["speed"]})
    return jsonify({"sources": sources})


if __name__ == '__main__':
    print("\n  ✦  TeraGrab → http://localhost:5000\n")
    app.run(host='0.0.0.0', port=5000, debug=True)

import asyncio
import json
import requests
from playwright.async_api import async_playwright

async def get_fresh_cookies():
    """Open iteraplay.com in Playwright, login cookies will persist from browser, get fresh cf_clearance."""
    
    print("🔄 Getting fresh cookies from iteraplay.com...")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        )
        page = await context.new_page()
        
        # Set login cookies before navigating
        await context.add_cookies([
            {"name": "login_token", "value": "4e360f4c60785f1671f8b209f197d1c23692af278adec93b3db643e2baddb85374129f706dce1899aded67182a66303a52b22fe44627e177c418261ff9187a74", "domain": "iteraplay.com", "path": "/"},
            {"name": "remember_me", "value": "yes", "domain": "iteraplay.com", "path": "/"},
        ])
        
        try:
            await page.goto("https://iteraplay.com/", wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(5)  # Wait for Cloudflare
            
            title = await page.title()
            print(f"   Page: {title}")
            
            if "challenge" in title.lower() or "cloudflare" in title.lower():
                print("   ⏳ Waiting for Cloudflare...")
                await asyncio.sleep(10)
        except Exception as e:
            print(f"   ⚠️ {e}")
        
        # Get all cookies
        all_cookies = await context.cookies()
        cookie_dict = {c["name"]: c["value"] for c in all_cookies}
        
        print(f"   🍪 Cookies: {list(cookie_dict.keys())}")
        await browser.close()
        
        return cookie_dict


def call_iteraplay_api(terabox_url, cookies):
    """Call iteraplay API with fresh cookies."""
    
    headers = {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.6",
        "content-type": "application/json",
        "origin": "https://iteraplay.com",
        "referer": "https://iteraplay.com/",
        "sec-ch-ua": '"Not:A-Brand";v="99", "Brave";v="145", "Chromium";v="145"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "sec-gpc": "1",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    }
    
    print(f"\n🔄 Calling iteraplay.com API...")
    print(f"   URL: {terabox_url}")
    
    resp = requests.post(
        "https://iteraplay.com/api/stream",
        headers=headers,
        cookies=cookies,
        json={"url": terabox_url},
        timeout=30,
    )
    
    print(f"   Status: {resp.status_code}")
    
    try:
        data = resp.json()
        
        # Check if token expired — retry with new_api_token if available
        if data.get("error_detail") and "expired" in data.get("error_detail", "").lower():
            new_token = data.get("new_api_token")
            if new_token:
                print(f"   🔄 Token expired, retrying with new_api_token...")
                cookies["__secure_token"] = new_token
                resp = requests.post(
                    "https://iteraplay.com/api/stream",
                    headers=headers,
                    cookies=cookies,
                    json={"url": terabox_url},
                    timeout=30,
                )
                data = resp.json()
                print(f"   Retry status: {resp.status_code}")
        
        print(f"\n{'='*60}")
        print(json.dumps(data, indent=2, ensure_ascii=False))
        
        with open("iteraplay_result.json", "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"\n💾 Saved to iteraplay_result.json")
        
        return data
    except:
        print(f"Raw: {resp.text[:3000]}")
        return None


async def main():
    url = input("\n📎 TeraBox URL paste karo: ").strip()
    if not url:
        print("❌ URL dena zaroori hai!")
        return
    
    # Get fresh cookies via Playwright
    cookies = await get_fresh_cookies()
    
    # Call API
    result = call_iteraplay_api(url, cookies)


if __name__ == "__main__":
    asyncio.run(main())

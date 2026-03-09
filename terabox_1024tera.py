import asyncio
import json
from playwright.async_api import async_playwright

async def extract_terabox_dlink(terabox_url):
    """
    Extract download/stream links from TeraBox via 1024teradownloader.com
    Uses Playwright (real browser) to bypass Cloudflare — no limits!
    """
    
    print(f"🚀 TeraBox DLink Extractor")
    print(f"   URL: {terabox_url}")
    print(f"{'='*60}")
    
    async with async_playwright() as p:
        # Launch real browser (headless)
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            viewport={"width": 1920, "height": 1080},
        )
        page = await context.new_page()
        
        # Capture API response
        api_response_data = None
        
        async def handle_response(response):
            nonlocal api_response_data
            if "/api/stream" in response.url:
                try:
                    api_response_data = await response.json()
                    print(f"\n   🎯 Captured API response!")
                except:
                    pass
        
        page.on("response", handle_response)
        
        # Step 1: Navigate to 1024teradownloader.com
        print(f"\n🔄 Step 1: Opening 1024teradownloader.com...")
        try:
            await page.goto("https://1024teradownloader.com/", wait_until="domcontentloaded", timeout=30000)
            print(f"   ✅ Page loaded")
        except Exception as e:
            print(f"   ⚠️  Initial load: {e}")
        
        # Wait for Cloudflare challenge to complete
        await asyncio.sleep(5)
        
        # Check if we're past Cloudflare
        title = await page.title()
        print(f"   Page title: {title}")
        
        if "challenge" in title.lower() or "cloudflare" in title.lower():
            print(f"   ⏳ Waiting for Cloudflare challenge...")
            await asyncio.sleep(10)
            title = await page.title()
            print(f"   Page title: {title}")
        
        # Step 2: Find and fill the input
        print(f"\n🔄 Step 2: Entering TeraBox URL...")
        
        # Try to find the input field
        input_sel = await page.query_selector('input[type="text"], input[type="url"], input[name="url"], input[placeholder*="paste"], input[placeholder*="enter"], input[placeholder*="url"], textarea')
        
        if not input_sel:
            # Try broader search
            input_sel = await page.query_selector('input:not([type="hidden"]):not([type="submit"])')
        
        if input_sel:
            await input_sel.click()
            await input_sel.fill(terabox_url)
            print(f"   ✅ URL entered")
        else:
            print(f"   ❌ Could not find input field!")
            await browser.close()
            return None
        
        # Step 3: Click the submit button
        print(f"\n🔄 Step 3: Clicking Continue/Submit...")
        
        # Try various button selectors
        button_selectors = [
            'button:has-text("Continue")',
            'button:has-text("Download")',
            'button:has-text("Get")',
            'button:has-text("Submit")',
            'button[type="submit"]',
            'a:has-text("Continue")',
            'a:has-text("Download")',
        ]
        
        clicked = False
        for sel in button_selectors:
            try:
                btn = await page.query_selector(sel)
                if btn:
                    await btn.click()
                    clicked = True
                    print(f"   ✅ Clicked: {sel}")
                    break
            except:
                continue
        
        if not clicked:
            print(f"   ⚠️  Trying to click any visible button...")
            buttons = await page.query_selector_all('button')
            for btn in buttons:
                text = await btn.text_content()
                if text and text.strip():
                    await btn.click()
                    print(f"   ✅ Clicked button: '{text.strip()}'")
                    clicked = True
                    break
        
        # Step 4: Wait for API response
        print(f"\n🔄 Step 4: Waiting for response...")
        
        # Wait up to 30 seconds for the API response
        for i in range(30):
            await asyncio.sleep(1)
            if api_response_data:
                break
            if i % 5 == 4:
                print(f"   ⏳ Still waiting... ({i+1}s)")
        
        await browser.close()
        
        # Step 5: Process results
        if api_response_data:
            print(f"\n{'='*60}")
            print(f"✅ SUCCESS! Data extracted:")
            print(f"{'='*60}")
            print(json.dumps(api_response_data, indent=2, ensure_ascii=False))
            
            # Save to file
            with open("terabox_result.json", "w", encoding="utf-8") as f:
                json.dump(api_response_data, f, indent=2, ensure_ascii=False)
            print(f"\n💾 Saved to terabox_result.json")
            
            # Display summary
            if isinstance(api_response_data, dict):
                print(f"\n{'='*60}")
                print(f"📋 SUMMARY:")
                print(f"{'='*60}")
                
                fname = api_response_data.get("file_name", api_response_data.get("fileName", ""))
                fsize = api_response_data.get("size", api_response_data.get("fileSize", ""))
                
                if fname: print(f"  📄 File: {fname}")
                if fsize: print(f"  📦 Size: {fsize}")
                
                # Look for download links in various possible keys
                link_keys = ["dlink", "downloadLink", "download", "download_link", 
                            "fast_link", "fastLink", "fast_download",
                            "stream", "streamLink", "stream_link",
                            "direct_link", "directLink"]
                
                for key in link_keys:
                    if api_response_data.get(key):
                        print(f"  ⬇️  {key}: {api_response_data[key][:100]}...")
                
                # Check for nested links
                if "links" in api_response_data:
                    for link_obj in api_response_data["links"]:
                        if isinstance(link_obj, dict):
                            for k, v in link_obj.items():
                                if "link" in k.lower() or "url" in k.lower():
                                    print(f"  🔗 {k}: {str(v)[:100]}...")
            
            return api_response_data
        else:
            print(f"\n❌ No API response captured in 30 seconds")
            print(f"   The page might need manual interaction (CAPTCHA, etc.)")
            return None


if __name__ == "__main__":
    url = input("\n📎 TeraBox URL paste karo: ").strip()
    if not url:
        print("❌ URL dena zaroori hai!")
    else:
        result = asyncio.run(extract_terabox_dlink(url))

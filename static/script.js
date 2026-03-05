/* ==========================================================
   TeraGrab — Script (HLS Player Only)
   ========================================================== */

const $ = id => document.getElementById(id);
const url = $('url');
const goBtn = $('go');
const errBox = $('err');
const errMsg = $('err-msg');
const skel = $('skeleton');
const result = $('result');
const steps = $('progress-steps');
const hlsVid = $('hls-vid');
const histEl = $('history');
const histList = $('hist-list');

let currentData = null;
let hlsInstance = null;
let plyrInstance = null;
const HIST_KEY = 'teragrab_history';

// ---- Grab ----
async function grab() {
    const link = url.value.trim();
    if (!link) { showErr('Paste a TeraBox link first'); url.focus(); return; }

    hideErr(); hideResult();
    setLoading(true);
    showSkeleton();
    updateSteps('connect');

    const t0 = performance.now();

    try {
        updateSteps('fetch');
        const res = await fetch('/api/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: link }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'API error');
        if (!json.data?.list?.length) throw new Error('No files found');

        updateSteps('done');
        const elapsed = Math.round(performance.now() - t0);
        console.log(`✦ Fetched in ${elapsed}ms${json.cached ? ' (cached)' : ''}`);

        hideSkeleton();
        render(json.data.list[0]);
        saveHistory(json.data.list[0], link);
    } catch (e) {
        hideSkeleton();
        hideSteps();
        showErr(e.message || 'Something went wrong');
    } finally {
        setLoading(false);
    }
}

// ---- Render ----
function render(f) {
    currentData = f;

    // Name
    $('fname').textContent = f.name || 'Unknown file';

    // Chips
    const chips = $('chips');
    chips.innerHTML = '';
    [f.quality, f.duration, f.size_formatted].filter(Boolean).forEach(t => {
        const s = document.createElement('span');
        s.className = 'chip';
        s.textContent = t;
        chips.appendChild(s);
    });

    // Video badge
    $('vid-badge').textContent = f.quality || 'FILE';

    // Setup HLS player
    setupHLS(f);

    // Download buttons
    $('btn-fast').href = f.fast_download_link || f.download_link || '#';
    $('btn-dl').href = f.download_link || '#';

    // Copy
    $('copy-text').textContent = 'Copy download link';
    $('copy-btn').classList.remove('copied');

    // Quality chips
    const qSec = $('q-section');
    const qList = $('q-list');
    qList.innerHTML = '';

    if (f.fast_stream_url && typeof f.fast_stream_url === 'object') {
        qSec.style.display = '';
        Object.entries(f.fast_stream_url).forEach(([q, lnk]) => {
            const a = document.createElement('a');
            a.className = 'q-btn';
            a.href = lnk;
            a.target = '_blank';
            a.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg><b>${q.toUpperCase()}</b>`;
            a.onclick = e => {
                e.preventDefault();
                loadHLSStream(lnk, q);
                $('vid-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
            };
            qList.appendChild(a);
        });
    } else {
        qSec.style.display = 'none';
    }

    showResult();
}

// ---- HLS Player setup ----
function setupHLS(f) {
    destroyHLS();

    const wrap = $('vid-wrap');

    if (f.type === 'video' && f.fast_stream_url && typeof f.fast_stream_url === 'object') {
        wrap.style.display = '';

        // Get highest quality as default
        const qualities = Object.entries(f.fast_stream_url);
        const [defaultQ, defaultUrl] = qualities[qualities.length - 1];

        hlsVid.poster = f.thumbnail || '';

        // Initialize Plyr
        plyrInstance = new Plyr(hlsVid, {
            controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'pip', 'fullscreen'],
            settings: ['quality', 'speed'],
            quality: {
                default: qualities.length - 1,
                options: qualities.map((_, i) => i),
                forced: true,
                onChange: (idx) => {
                    if (qualities[idx]) {
                        loadHLSStream(qualities[idx][1], qualities[idx][0]);
                    }
                }
            },
            i18n: {
                qualityLabel: {
                    0: qualities[0] ? qualities[0][0].toUpperCase() : '360p',
                    1: qualities[1] ? qualities[1][0].toUpperCase() : '480p',
                    2: qualities[2] ? qualities[2][0].toUpperCase() : '720p',
                }
            }
        });

        loadHLSStream(defaultUrl, defaultQ);

    } else if (f.type === 'video' && f.stream_url) {
        // Fallback: direct stream (no HLS available)
        wrap.style.display = '';
        hlsVid.poster = f.thumbnail || '';
        plyrInstance = new Plyr(hlsVid, {
            controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'pip', 'fullscreen'],
        });
        hlsVid.src = f.stream_url;

    } else if (f.thumbnail) {
        wrap.style.display = '';
        hlsVid.poster = f.thumbnail;
        hlsVid.removeAttribute('src');

    } else {
        wrap.style.display = 'none';
    }
}

function loadHLSStream(streamUrl, quality) {
    const videoEl = plyrInstance ? plyrInstance.media : hlsVid;

    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        hlsInstance = new Hls({
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            startLevel: -1,
            enableWorker: true,
        });
        hlsInstance.loadSource(streamUrl);
        hlsInstance.attachMedia(videoEl);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
            videoEl.play().catch(() => { });
        });
        hlsInstance.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) {
                console.warn('HLS error, recovering...');
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hlsInstance.startLoad();
                else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hlsInstance.recoverMediaError();
            }
        });
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = streamUrl;
        videoEl.addEventListener('loadedmetadata', () => videoEl.play().catch(() => { }), { once: true });
    }

    // Update badge
    $('vid-badge').textContent = quality ? quality.toUpperCase() : 'HD';
}

function destroyHLS() {
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (plyrInstance) { plyrInstance.destroy(); plyrInstance = null; }
}

// ---- Copy link ----
function copyLink() {
    if (!currentData) return;
    const link = currentData.fast_download_link || currentData.download_link;
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
        $('copy-text').textContent = 'Copied!';
        $('copy-btn').classList.add('copied');
        setTimeout(() => {
            $('copy-text').textContent = 'Copy download link';
            $('copy-btn').classList.remove('copied');
        }, 2000);
    });
}

// ---- History ----
function getHistory() {
    try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch { return []; }
}

function saveHistory(f, inputUrl) {
    const hist = getHistory().filter(h => h.url !== inputUrl);
    hist.unshift({ url: inputUrl, name: f.name || 'Unknown', thumb: f.thumbnail || '', quality: f.quality || '', time: Date.now() });
    localStorage.setItem(HIST_KEY, JSON.stringify(hist.slice(0, 8)));
    renderHistory();
}

function renderHistory() {
    const hist = getHistory();
    if (!hist.length) { histEl.classList.remove('show'); return; }
    histEl.classList.add('show');
    histList.innerHTML = '';
    hist.forEach(h => {
        const div = document.createElement('div');
        div.className = 'hist-item';
        div.onclick = () => { url.value = h.url; grab(); };
        div.innerHTML = `
            ${h.thumb ? `<img class="hist-thumb" src="${h.thumb}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<div class="hist-thumb"></div>'}
            <span class="hist-name">${escHtml(h.name)}</span>
            <span class="hist-meta">${timeAgo(h.time)}</span>`;
        histList.appendChild(div);
    });
}

function clearHistory() { localStorage.removeItem(HIST_KEY); histEl.classList.remove('show'); }
function timeAgo(ts) { const d = Math.floor((Date.now() - ts) / 1000); if (d < 60) return 'just now'; if (d < 3600) return `${Math.floor(d / 60)}m ago`; if (d < 86400) return `${Math.floor(d / 3600)}h ago`; return `${Math.floor(d / 86400)}d ago`; }
function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ---- Progress stepper ----
function updateSteps(phase) {
    steps.classList.add('show');
    const ps = ['connect', 'fetch', 'done'];
    const lines = steps.querySelectorAll('.ps-line');
    ps.forEach((p, i) => {
        const el = $(`ps-${p}`);
        const idx = ps.indexOf(phase);
        if (i < idx) { el.className = 'pstep done'; if (lines[i]) lines[i].className = 'ps-line active'; }
        else if (i === idx) { el.className = 'pstep active'; if (lines[i]) lines[i].className = 'ps-line'; }
        else { el.className = 'pstep'; if (lines[i]) lines[i].className = 'ps-line'; }
    });
}
function hideSteps() { steps.classList.remove('show'); }

// ---- UI helpers ----
function setLoading(v) { goBtn.classList.toggle('ld', v); goBtn.disabled = v; url.disabled = v; }
function showSkeleton() { skel.classList.add('show'); }
function hideSkeleton() { skel.classList.remove('show'); }
function showResult() { result.classList.add('show'); setTimeout(() => result.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }
function hideResult() { result.classList.remove('show'); }

let errTimer;
function showErr(m) { clearTimeout(errTimer); errMsg.textContent = m; errBox.classList.add('show'); errTimer = setTimeout(() => errBox.classList.remove('show'), 6000); }
function hideErr() { clearTimeout(errTimer); errBox.classList.remove('show'); }

// ---- Events ----
url.addEventListener('paste', () => setTimeout(() => { if (url.value.trim().length > 10) grab(); }, 100));
url.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); grab(); } });
function handleSubmit(e) { e.preventDefault(); grab(); return false; }

// ---- Init ----
window.addEventListener('DOMContentLoaded', () => { url.focus(); renderHistory(); });

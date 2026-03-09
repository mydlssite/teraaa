/* ==========================================================
   TeraGrab — Script (Video.js — built-in HLS + Audio Tracks)
   ========================================================== */

const $ = id => document.getElementById(id);
const url = $('url');
const goBtn = $('go');
const errBox = $('err');
const errMsg = $('err-msg');
const skel = $('skeleton');
const result = $('result');
const steps = $('progress-steps');
const histEl = $('history');
const histList = $('hist-list');

let currentData = null;
let vjsPlayer = null;
let selectedApi = 'playterabox';
const HIST_KEY = 'teragrab_history';

// ---- API Source Selector ----
function selectApi(api) {
    selectedApi = api;
    document.querySelectorAll('.api-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.api === api);
    });
}
// ---- Grab ----
async function grab() {
    const link = url.value.trim();
    if (!link) { showErr('Paste a TeraBox link first'); url.focus(); return; }

    // Validate protocol
    if (!link.startsWith('http://') && !link.startsWith('https://')) {
        showErr('Please enter a valid URL starting with http:// or https://');
        url.focus();
        return;
    }

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
            body: JSON.stringify({ url: link, api: selectedApi }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'API error');
        if (!json.data?.list?.length) throw new Error('No files found');

        updateSteps('done');
        const elapsed = Math.round(performance.now() - t0);
        console.log(`✦ Fetched in ${elapsed}ms${json.cached ? ' (cached)' : ''}`);

        hideSkeleton();

        // Handle multiple files
        const files = json.data.list || [];
        const zipLink = json.data.zip_download_link || null;
        if (files.length > 1) {
            renderFileList(files, link, zipLink);
        } else {
            render(files[0]);
        }
        saveHistory(files[0], link);
    } catch (e) {
        hideSkeleton();
        hideSteps();
        showErr(e.message || 'Something went wrong');
    } finally {
        setLoading(false);
    }
}

// ---- Render ----
function render(f, isMultifile = false) {
    currentData = f;

    // Hide file list if it was previously shown (single file mode)
    const flSec = $('file-list-section');
    if (flSec && !isMultifile) flSec.style.display = 'none';

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

    // Setup Video.js player
    setupPlayer(f);

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
                loadStream(lnk, q);
                $('vid-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
            };
            qList.appendChild(a);
        });
    } else {
        qSec.style.display = 'none';
    }

    // Reset audio section
    hideAudioTracks();

    showResult();
}

// ---- Multi-file list ----
function renderFileList(files, inputUrl, zipLink) {
    // Render the first file by default
    render(files[0], true);

    // Build file list section
    const qSec = $('q-section');
    const listHtml = files.map((f, i) => {
        const isActive = i === 0 ? ' active' : '';
        const thumb = f.thumbnail ? `<img class="fl-thumb" src="${f.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none'">` : '<div class="fl-thumb"></div>';
        return `<div class="fl-item${isActive}" data-idx="${i}">
            ${thumb}
            <div class="fl-info">
                <span class="fl-name">${escHtml(f.name || 'Unknown')}</span>
                <span class="fl-meta">${[f.quality, f.duration, f.size_formatted].filter(Boolean).join(' · ')}</span>
            </div>
        </div>`;
    }).join('');

    // ZIP download button
    const zipHtml = zipLink ? `
        <a class="btn btn-zip" href="${zipLink}" target="_blank">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download All (${files.length} files) — ZIP
        </a>` : '';

    // Insert file list before quality section
    let fileListEl = $('file-list-section');
    if (!fileListEl) {
        fileListEl = document.createElement('div');
        fileListEl.id = 'file-list-section';
        fileListEl.className = 'file-list-section';
        qSec.parentElement.insertBefore(fileListEl, qSec);
    }

    fileListEl.innerHTML = `
        <div class="q-head">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            ${files.length} FILES FOUND
        </div>
        ${zipHtml}
        <div class="fl-list">${listHtml}</div>`;
    fileListEl.style.display = '';

    // Click handlers
    fileListEl.querySelectorAll('.fl-item').forEach(item => {
        item.onclick = () => {
            const idx = parseInt(item.dataset.idx);
            fileListEl.querySelectorAll('.fl-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            render(files[idx], true);
        };
    });
}

// ---- Video.js Player ----
function setupPlayer(f) {
    // Dispose previous player
    destroyPlayer();

    const wrap = $('vid-wrap');

    if (f.type === 'video' && (f.fast_stream_url || f.stream_url)) {
        wrap.style.display = '';

        // Get the source URL
        let src, srcType;
        if (f.fast_stream_url && typeof f.fast_stream_url === 'object') {
            const qualities = Object.entries(f.fast_stream_url);
            src = qualities[qualities.length - 1][1]; // highest quality
            srcType = 'application/x-mpegURL';
        } else {
            src = f.stream_url;
            srcType = 'video/mp4';
        }

        // Initialize Video.js
        vjsPlayer = videojs('vjs-player', {
            fluid: true,
            aspectRatio: '16:9',
            responsive: true,
            html5: {
                vhs: {
                    overrideNative: true,
                    enableLowInitialPlaylist: false,
                },
                nativeAudioTracks: false,
                nativeVideoTracks: false,
            },
            controlBar: {
                children: [
                    'playToggle',
                    'volumePanel',
                    'currentTimeDisplay',
                    'timeDivider',
                    'durationDisplay',
                    'progressControl',
                    'remainingTimeDisplay',
                    'audioTrackButton',
                    'playbackRateMenuButton',
                    'fullscreenToggle',
                ],
            },
            playbackRates: [0.5, 1, 1.25, 1.5, 2],
        });

        // Set poster
        if (f.thumbnail) {
            vjsPlayer.poster(f.thumbnail);
        }

        // Set source
        vjsPlayer.src({ type: srcType, src: src });

        // Listen for audio tracks
        vjsPlayer.ready(() => {
            // Auto-play disabled per user request
            // vjsPlayer.play().catch(() => { });

            // Check audio tracks once loaded
            vjsPlayer.on('loadedmetadata', () => {
                checkAudioTracks();
            });

            // Also listen for tech-level audio track changes
            const tracks = vjsPlayer.audioTracks();
            if (tracks) {
                tracks.addEventListener('addtrack', () => checkAudioTracks());
                tracks.addEventListener('change', () => updateAudioTrackUI());
            }
        });

    } else if (f.thumbnail) {
        wrap.style.display = '';
        vjsPlayer = videojs('vjs-player', { fluid: true, aspectRatio: '16:9' });
        vjsPlayer.poster(f.thumbnail);
    } else {
        wrap.style.display = 'none';
    }
}

function loadStream(streamUrl, quality) {
    if (!vjsPlayer) return;

    vjsPlayer.src({
        type: 'application/x-mpegURL',
        src: streamUrl,
    });
    vjsPlayer.play().catch(() => { });

    // Re-check audio tracks after quality switch
    vjsPlayer.one('loadedmetadata', () => checkAudioTracks());

    // Update badge
    $('vid-badge').textContent = quality ? quality.toUpperCase() : 'HD';
}

function destroyPlayer() {
    if (vjsPlayer) {
        vjsPlayer.dispose();
        vjsPlayer = null;

        // Recreate the video element (Video.js removes it on dispose)
        const wrap = $('vid-wrap');
        const badge = wrap.querySelector('.vid-badge');

        const video = document.createElement('video');
        video.id = 'vjs-player';
        video.className = 'video-js vjs-big-play-centered';
        video.setAttribute('controls', '');
        video.setAttribute('crossorigin', 'anonymous');
        video.setAttribute('playsinline', '');
        video.setAttribute('preload', 'metadata');

        // Insert before the badge
        if (badge) {
            wrap.insertBefore(video, badge);
        } else {
            wrap.appendChild(video);
        }
    }
}

// ---- Audio Track handling ----
function checkAudioTracks() {
    if (!vjsPlayer) return;

    const tracks = vjsPlayer.audioTracks();
    if (tracks && tracks.length > 1) {
        renderAudioTracks(tracks);
    } else {
        hideAudioTracks();
    }
}

function renderAudioTracks(tracks) {
    const section = $('audio-section');
    const list = $('audio-list');
    section.style.display = '';
    list.innerHTML = '';

    for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const btn = document.createElement('button');
        btn.className = 'a-btn' + (track.enabled ? ' active' : '');

        const lang = track.language || '';
        const name = track.label || `Track ${i + 1}`;

        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            ${lang ? `<span class="a-lang">${lang.toUpperCase()}</span>` : ''}
            ${escHtml(name)}`;

        btn.onclick = () => switchAudioTrack(i);
        list.appendChild(btn);
    }
}

function switchAudioTrack(idx) {
    if (!vjsPlayer) return;
    const tracks = vjsPlayer.audioTracks();
    for (let i = 0; i < tracks.length; i++) {
        tracks[i].enabled = (i === idx);
    }
    updateAudioTrackUI();
    console.log(`✦ Switched to audio track ${idx}`);
}

function updateAudioTrackUI() {
    if (!vjsPlayer) return;
    const tracks = vjsPlayer.audioTracks();
    const btns = $('audio-list').querySelectorAll('.a-btn');
    for (let i = 0; i < btns.length && i < tracks.length; i++) {
        btns[i].classList.toggle('active', tracks[i].enabled);
    }
}

function hideAudioTracks() {
    const section = $('audio-section');
    if (section) section.style.display = 'none';
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

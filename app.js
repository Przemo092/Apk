// ============================================================
// CONSTANTS
// ============================================================
const SPLASH_TIPS = [
    'Sprawdź stan naczepy przed wyjazdem',
    'Pamiętaj o dokumentach przewozowych',
    'Bezpiecznej trasy! 🚚',
    'Skontroluj zabezpieczenie ładunku',
    'Miej zawsze kopię CMR dla siebie',
    'Sprawdź czas pracy przed startem'
];

const DEFAULT_F14 = 'THE CARRIER ACCEPTS NO RESPONSIBILITY FOR THE QUALITY OR QUANTITY OF THE GOODS LOADED';

// All field IDs in the CMR form — used for save/restore/reset
const CMR_FIELD_IDS = [
    'inp_sender','inp_consignee','inp_pickup','inp_destination',
    'inp_carrier','inp_tractor','inp_trailer',
    'inp_f2','inp_f3','inp_f7',
    'inp_goods','inp_weight','inp_vol',
    'inp_pal_lin','inp_pal_lout','inp_pal_din','inp_pal_dout',
    'inp_f12','inp_f13','inp_f14','inp_f15',
    'inp_temp1','inp_temp2',
    'inp_print_name','inp_sig1_date',
    'inp_seal','inp_f19','inp_place20','inp_date20'
];

// Fields kept when creating a new CMR (populated from profile)
const KEEP_ON_NEW = ['inp_carrier','inp_tractor','inp_trailer'];

// Required fields for validation
const REQUIRED_FIELDS = ['inp_sender','inp_consignee'];

// ============================================================
// INIT
// ============================================================
window.addEventListener('load', () => {
    const tipEl = document.getElementById('splash-tip');
    if(tipEl) tipEl.textContent = SPLASH_TIPS[Math.floor(Math.random() * SPLASH_TIPS.length)];
    // splash: full sequence needs ~3.2s to be readable; reduced-motion users
    // get a calm instant variant and a fast exit
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(!reducedMotion && navigator.vibrate) setTimeout(() => navigator.vibrate(8), 2000);
    setTimeout(() => {
        const s = document.getElementById('splash-screen');
        s.style.opacity = 0;
        document.body.classList.add('app-enter');
        if(!reducedMotion && navigator.vibrate) navigator.vibrate(6);
        setTimeout(() => s.style.display = 'none', 800);
    }, reducedMotion ? 1200 : 4600);

    loadDb();
    setupSignaturePad('sig1');
    setupSignaturePad('sig2');
    setupSignaturePad('profile-sig-canvas');
    setupOverlaySigPad();
    initPinchZoom();
    // Chrome autofill would paint filled fields pale blue (visible in print);
    // skip datalist-driven fields so their suggestions keep working
    document.querySelectorAll('.cmr-input').forEach(el => {
        if(!el.hasAttribute('list')) el.setAttribute('autocomplete', 'off');
        el.setAttribute('autocorrect', 'off');
        el.setAttribute('spellcheck', 'false');
    });
    tagLEElements();
    initLEHandlers();

    const savedProf = localStorage.getItem('cmr_prof');
    if(savedProf) loadProfile();

    initSigImgDrag();
    captureIconAnchors();
    loadFullLayout();
    anchorIcons();
    syncRemoteLayout();
    scheduleUpdateChecks();
    loadDraft();
    updateCarrierDisplay();
    applyDocDefaults();
    const carrierTA = document.getElementById('inp_carrier');
    if(carrierTA) carrierTA.addEventListener('input', updateCarrierDisplay);
    loadHistoryList();

    // Auto-save on any CMR input change
    document.querySelectorAll('#view-cmr .cmr-input[id], #view-cmr input[id]').forEach(el => {
        el.addEventListener('input', scheduleDraftSave);
        el.addEventListener('change', scheduleDraftSave);
    });

    window.addEventListener('resize', () => {
        Object.values(sigPads).forEach(p => resizeSigCanvas(p));
    });
    window.addEventListener('beforeprint', preparePrintDates);
    window.addEventListener('afterprint', () => {
        restorePrintDates();
        const p = document.getElementById('cmr-page');
        p.classList.remove('print-blank');
        p.classList.remove('data-only');
        p.classList.remove('hide-f14');
    });
    applyScanBg();
    markEmptyDates();

    // PWA service worker — auto-reload once when a new version takes control
    if('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js?v=' + APP_BUILD, { updateViaCache: 'none' }).then(reg => {
            if(reg && reg.update) reg.update();
        }).catch(() => {});
        let swReloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if(swReloaded) return;
            swReloaded = true;
            location.reload();
        });
    }

    // show the running build number in the profile footer
    const bt = document.getElementById('build-tag');
    if(bt) bt.textContent = 'Wersja aplikacji: ' + APP_BUILD;
    renderStats();
    renderHomeStats();

    // power-user option: skip the Start menu and open the CMR form directly
    try {
        if(JSON.parse(localStorage.getItem('cmr_prof') || '{}').skiphome) {
            nav('cmr', navItem('cmr'));
        }
    } catch(e) {}
});

// ============================================================
// NAVIGATION
// ============================================================
function nav(v, el) {
    document.querySelectorAll('.view').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    const view = document.getElementById('view-' + v);
    if(view) view.classList.add('active');
    if(el) el.classList.add('active');
    else { const ni = navItem(v); if(ni) ni.classList.add('active'); }
    if(v === 'home') renderHomeStats();
    if(v === 'history') loadHistoryList();
    if(v === 'profile') {
        setTimeout(() => resizeSigCanvas(sigPads['profile-sig-canvas']), 50);
        renderStats();
    }
    if(v !== 'cmr') resetViewZoom();
    window.scrollTo(0, 0);
}

// find the bottom-nav item that triggers a given view
function navItem(v) {
    return [...document.querySelectorAll('.nav-item')].find(n => (n.getAttribute('onclick') || '').includes("'" + v + "'")) || null;
}

function homeLastRoute() {
    const hist = JSON.parse(localStorage.getItem('cmr_history') || '[]');
    if(!hist.length) { toast('Archiwum jest puste — najpierw zapisz trasę', 'error'); return; }
    nav('cmr', navItem('cmr'));
    restoreHistory(hist[0].id);
}

function renderHomeStats() {
    const box = document.getElementById('home-stats');
    if(!box) return;
    const hist = JSON.parse(localStorage.getItem('cmr_history') || '[]');
    const now = new Date();
    const month = hist.filter(h => {
        const d = new Date(h.id);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const db = JSON.parse(localStorage.getItem('cmr_db') || '[]');
    box.innerHTML =
        `<div class="hs"><b>${hist.length}</b><span>tras łącznie</span></div>` +
        `<div class="hs"><b>${month.length}</b><span>w tym miesiącu</span></div>` +
        `<div class="hs"><b>${db.length}</b><span>wpisów w bazie</span></div>`;
}

// ============================================================
// TOAST
// ============================================================
function toast(msg, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    container.appendChild(el);
    requestAnimationFrame(() => { requestAnimationFrame(() => el.classList.add('show')); });
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 350);
    }, duration);
}

// ============================================================
// VALIDATION
// ============================================================
function validateForm() {
    let valid = true;
    const banner = document.getElementById('validation-banner');
    const missing = [];
    REQUIRED_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        if(!el || !el.value.trim()) {
            el && el.classList.add('invalid');
            missing.push(id === 'inp_sender' ? 'Nadawca' : 'Odbiorca');
            valid = false;
        } else {
            el && el.classList.remove('invalid');
        }
    });
    if(!valid) {
        banner.style.display = 'block';
        banner.textContent = '⚠️ Uzupełnij wymagane pola: ' + missing.join(', ');
    } else {
        banner.style.display = 'none';
    }
    return valid;
}

function clearValidation() {
    REQUIRED_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.remove('invalid');
    });
    document.getElementById('validation-banner').style.display = 'none';
}

// ============================================================
// PRINT
// ============================================================
// Tag empty date inputs so print/PDF hides the dd.mm.rrrr placeholder
function markEmptyDates() {
    document.querySelectorAll('#cmr-page input[type="date"]').forEach(el => {
        el.classList.toggle('empty-date', !el.value);
    });
}

// Android's print rendering draws the native date-picker arrow no matter
// what CSS says — swap date inputs to plain text for the duration of the
// print and restore them afterwards.
let printDateBackup = [];

function preparePrintDates() {
    markEmptyDates();
    if(printDateBackup.length) return;
    document.querySelectorAll('#cmr-page input[type="date"]').forEach(el => {
        printDateBackup.push({ el, val: el.value });
        const v = el.value;
        try { el.type = 'text'; } catch(e) {}
        el.value = v ? v.split('-').reverse().join('.') : '';
    });
}

function restorePrintDates() {
    printDateBackup.forEach(({el, val}) => {
        try { el.type = 'date'; } catch(e) {}
        el.value = val;
    });
    printDateBackup = [];
}

function printCMR() {
    if(scanModeBlocked()) return;
    if(!validateForm()) {
        toast('Uzupełnij wymagane pola przed drukowaniem', 'error');
        return;
    }
    preparePrintDates();
    window.print();
    setTimeout(restorePrintDates, 2000);
}

function printBlankCMR() {
    if(scanModeBlocked()) return;
    const page = document.getElementById('cmr-page');
    page.classList.add('print-blank');
    preparePrintDates();
    window.print();
    setTimeout(() => { page.classList.remove('print-blank'); restorePrintDates(); }, 2000);
}

// Print ONLY the entered data, positioned to land in the boxes of a
// pre-printed paper CMR fed into the printer.
function printDataOnly() {
    if(!validateForm()) {
        toast('Uzupełnij wymagane pola przed drukowaniem', 'error');
        return;
    }
    const page = document.getElementById('cmr-page');
    page.classList.add('data-only');
    // the standard reservations text is pre-printed on the paper form —
    // print field 14 only if the user changed it
    const f14 = document.getElementById('inp_f14');
    if(f14 && f14.value.trim() === DEFAULT_F14) page.classList.add('hide-f14');
    preparePrintDates();
    window.print();
    setTimeout(() => {
        page.classList.remove('data-only');
        page.classList.remove('hide-f14');
        restorePrintDates();
    }, 2000);
}

// ============================================================
// SCAN BACKDROP (align fields to your own paper CMR)
// Two independent layouts: the default one (normal work + full print)
// and a separate overlay layout used only while the backdrop is shown.
// ============================================================
let overlayMode = false;
let defaultGeomSnap = null;

function captureGeom() {
    const snap = {};
    document.querySelectorAll('#cmr-page [data-le-id]').forEach(el => {
        snap[el.dataset.leId] = {
            top: el.style.top, left: el.style.left,
            width: el.style.width, height: el.style.height,
            fontSize: el.style.fontSize
        };
    });
    return snap;
}

function applyGeom(snap) {
    if(!snap) return;
    document.querySelectorAll('#cmr-page [data-le-id]').forEach(el => {
        const s = snap[el.dataset.leId];
        if(!s) return;
        el.style.top      = s.top      || '';
        el.style.left     = s.left     || '';
        el.style.width    = s.width    || '';
        el.style.height   = s.height   || '';
        el.style.fontSize = s.fontSize || '';
    });
}

function saveOverlayLayout() {
    localStorage.setItem('cmr_layout_overlay', JSON.stringify({ ver: LE_LAYOUT_VER, geom: captureGeom() }));
}

function setScanMode(on) {
    if(on === overlayMode) return;
    const page = document.getElementById('cmr-page');
    if(on) {
        // remember the default layout, then bring in the overlay layout
        defaultGeomSnap = captureGeom();
        try {
            const raw = localStorage.getItem('cmr_layout_overlay');
            if(raw) {
                const d = JSON.parse(raw);
                if(d.ver === LE_LAYOUT_VER && d.geom) applyGeom(d.geom);
            }
        } catch(e) {}
        overlayMode = true;
        page.classList.add('scan-mode');
    } else {
        // persist overlay tweaks, then restore the untouched default
        saveOverlayLayout();
        overlayMode = false;
        applyGeom(defaultGeomSnap);
        page.classList.remove('scan-mode');
    }
    anchorIcons();
    updateCarrierDisplay();
    if(leActive) injectLERHs();
}

function scanModeBlocked() {
    if(overlayMode) {
        toast('Masz włączony tryb nadruku (podkład). Wyłącz go przyciskiem 🧾, aby drukować pełny CMR.', 'error', 5000);
        return true;
    }
    return false;
}

function saveScanCanvas(c) {
    try {
        localStorage.setItem('cmr_scan', c.toDataURL('image/jpeg', 0.8));
        localStorage.setItem('cmr_scan_show', '1');
        applyScanBg();
        nav('cmr', document.querySelector('.nav-item'));
        toast('✅ Podkład wgrany — dopasuj pola w edytorze do podkładu', 'success', 5000);
    } catch(e) {
        toast('❌ Skan jest za duży — użyj mniejszego pliku', 'error', 4000);
    }
}

// pdf.js loaded on demand — only when the user picks a PDF backdrop
function loadPdfJs() {
    if(window.pdfjsLib) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        s.onload = () => {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            resolve();
        };
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

async function loadPdfScan(file) {
    toast('📄 Wczytywanie PDF…', 'info', 3000);
    try {
        await loadPdfJs();
        const buf = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        const page = await pdf.getPage(1);
        const raw = page.getViewport({ scale: 1 });
        const scale = 1240 / raw.width;
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width);
        c.height = Math.round(vp.height);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        saveScanCanvas(c);
    } catch(e) {
        console.error('PDF scan error:', e);
        toast('❌ Nie udało się wczytać PDF — sprawdź internet lub użyj zdjęcia', 'error', 5000);
    }
}

function onScanFile(input) {
    const f = input.files && input.files[0];
    input.value = '';
    if(!f) return;
    if(f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        loadPdfScan(f);
        return;
    }
    const rd = new FileReader();
    rd.onload = () => {
        const img = new Image();
        img.onload = () => {
            // downscale so it fits in localStorage
            const W = 1240;
            const c = document.createElement('canvas');
            c.width = W;
            c.height = Math.round(W * img.height / img.width);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            saveScanCanvas(c);
        };
        img.src = rd.result;
    };
    rd.readAsDataURL(f);
}

function toggleScanBg() {
    if(!localStorage.getItem('cmr_scan')) { toast('Najpierw wgraj skan CMR', 'error'); return; }
    const show = localStorage.getItem('cmr_scan_show') === '1';
    localStorage.setItem('cmr_scan_show', show ? '0' : '1');
    applyScanBg();
}

function removeScan() {
    if(!localStorage.getItem('cmr_scan')) return;
    if(!confirm('Usunąć wgrany podkład skanu CMR?')) return;
    localStorage.removeItem('cmr_scan');
    localStorage.removeItem('cmr_scan_show');
    applyScanBg();
    toast('Podkład usunięty', 'info');
}

function applyScanBg() {
    const el = document.getElementById('scan-bg');
    if(!el) return;
    const src = localStorage.getItem('cmr_scan');
    const show = !!src && localStorage.getItem('cmr_scan_show') === '1';
    if(show) { el.src = src; el.style.display = 'block'; }
    else el.style.display = 'none';
    setScanMode(show);
    const btn = document.getElementById('scan-toggle-btn');
    if(btn) btn.textContent = show ? '🙈 Ukryj podkład (tryb nadruku)' : '👁 Pokaż podkład (tryb nadruku)';
    const qb = document.getElementById('scan-quick-btn');
    if(qb) {
        qb.style.display = src ? '' : 'none';
        qb.textContent = show ? '🧾 Tryb nadruku: WŁĄCZONY' : '🧾 Tryb nadruku: wyłączony';
        qb.style.background = show ? '#28a745' : '';
    }
}

// ============================================================
// PDF GENERATION
// ============================================================
async function generatePDF() {
    if(scanModeBlocked()) return;
    if(!validateForm()) {
        toast('Uzupełnij wymagane pola przed generowaniem PDF', 'error');
        return;
    }
    if(typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
        toast('Ładowanie bibliotek PDF…', 'info');
        await new Promise(r => setTimeout(r, 1500));
        if(typeof html2canvas === 'undefined') {
            toast('Brak połączenia z internetem — użyj przycisku DRUK', 'error', 5000);
            return;
        }
    }

    const page = document.getElementById('cmr-page');
    const toHide = document.querySelectorAll('.quick-pick, .geo-btn, .sig-ui-btn, #scan-bg');

    // Save transform state
    const hadTransform = page.style.transform;
    const hadMarginB = page.style.marginBottom;
    const hadMarginR = page.style.marginRight;

    toast('Generowanie PDF…', 'info', 8000);

    try {
        // Temporarily disable mobile scale and yellow highlights
        page.style.transform = 'none';
        page.style.marginBottom = '0';
        page.style.marginRight = '0';
        page.classList.add('no-hl');
        markEmptyDates();
        toHide.forEach(el => el.style.visibility = 'hidden');

        await new Promise(r => setTimeout(r, 120));

        const canvasEl = await html2canvas(page, {
            scale: 2.5,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            allowTaint: false,
            onclone: (doc) => {
                // strip any residual field backgrounds (autofill blue etc.)
                doc.querySelectorAll('#cmr-page .cmr-input').forEach(el => {
                    el.style.background = 'transparent';
                    el.style.boxShadow = 'none';
                });
                // date inputs -> plain text so no calendar icon can render
                doc.querySelectorAll('#cmr-page input[type="date"]').forEach(el => {
                    const v = el.value;
                    el.type = 'text';
                    el.value = v ? v.split('-').reverse().join('.') : '';
                });
            }
        });

        const imgData = canvasEl.toDataURL('image/jpeg', 0.93);
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);

        const truck = (document.getElementById('inp_tractor').value || '').replace(/[^a-zA-Z0-9]/g, '') || 'CMR';
        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `CMR_${truck}_${dateStr}.pdf`;

        // Try Web Share API first (mobile), fall back to download
        const blob = pdf.output('blob');
        const file = new File([blob], fileName, { type: 'application/pdf' });
        if(navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'CMR ' + truck });
            toast('✅ PDF udostępniony!', 'success');
        } else {
            pdf.save(fileName);
            toast('✅ PDF zapisany: ' + fileName, 'success');
        }
    } catch(err) {
        console.error('PDF error:', err);
        toast('❌ Błąd PDF — użyj przycisku DRUK', 'error', 5000);
    } finally {
        page.style.transform = hadTransform;
        page.style.marginBottom = hadMarginB;
        page.style.marginRight = hadMarginR;
        toHide.forEach(el => el.style.visibility = '');
        page.classList.remove('no-hl');
    }
}

// ============================================================
// GEOLOCATION
// ============================================================
function getGeo(targetId) {
    if(!navigator.geolocation) { toast('Brak GPS w przeglądarce', 'error'); return; }
    const btn = document.querySelector(`.geo-btn[onclick="getGeo('${targetId}')"]`);
    if(btn) btn.innerHTML = '⏳';

    const GEO_TIMEOUT = 12000;
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        if(btn) btn.innerHTML = '📍';
        toast('GPS nie odpowiada — spróbuj ponownie', 'warning');
    }, GEO_TIMEOUT + 500);

    navigator.geolocation.getCurrentPosition(
        pos => {
            if(timedOut) return;
            clearTimeout(timer);
            const { latitude, longitude } = pos.coords;
            fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1&zoom=14&accept-language=en`)
                .then(r => r.json())
                .then(data => {
                    const addr = data.address || {};
                    const country = addr.country || '';
                    const today = new Date().toLocaleDateString('pl-PL');
                    const candidates = [addr.village, addr.hamlet, addr.suburb, addr.town, addr.city, addr.municipality, addr.county, addr.state].filter(Boolean);
                    const unique = [...new Set(candidates)];
                    if(btn) btn.innerHTML = '📍';
                    if(unique.length === 0) { toast('Nie ustalono nazwy miejscowości', 'warning'); return; }
                    if(unique.length === 1) {
                        document.getElementById(targetId).value = `${unique[0]}, ${country}. ${today}`;
                        scheduleDraftSave();
                        return;
                    }
                    // Multiple options — show picker
                    const list = document.getElementById('modal-list');
                    list.innerHTML = '';
                    unique.forEach(name => {
                        const d = document.createElement('div');
                        d.className = 'modal-item';
                        d.innerHTML = `<b>${name}</b><br><small>${country}</small>`;
                        d.onclick = () => {
                            document.getElementById(targetId).value = `${name}, ${country}. ${today}`;
                            scheduleDraftSave();
                            closeModal();
                        };
                        list.appendChild(d);
                    });
                    document.getElementById('modal-overlay').style.display = 'flex';
                })
                .catch(() => { if(btn) btn.innerHTML = '📍'; toast('Błąd pobierania adresu', 'error'); });
        },
        () => {
            clearTimeout(timer);
            if(btn) btn.innerHTML = '📍';
            if(!timedOut) toast('Brak dostępu do lokalizacji', 'error');
        },
        { timeout: GEO_TIMEOUT, enableHighAccuracy: false }
    );
}

// ============================================================
// NEARBY COMPANIES (OpenStreetMap — no API key needed)
// ============================================================
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function distM(la1, lo1, la2, lo2) {
    const rad = Math.PI / 180, dla = (la2 - la1) * rad, dlo = (lo2 - lo1) * rad;
    const a = Math.sin(dla/2)**2 + Math.cos(la1*rad) * Math.cos(la2*rad) * Math.sin(dlo/2)**2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function findNearbyBiz(targetId) {
    if(!navigator.geolocation) { toast('Brak GPS w przeglądarce', 'error'); return; }
    toast('📍 Pobieranie lokalizacji…', 'info', 2500);
    navigator.geolocation.getCurrentPosition(
        pos => searchBizAround(pos.coords.latitude, pos.coords.longitude, targetId),
        ()  => toast('❌ Brak dostępu do lokalizacji', 'error'),
        { timeout: 12000, enableHighAccuracy: true }
    );
}

async function searchBizAround(lat, lon, targetId) {
    toast('🏢 Szukanie firm w pobliżu…', 'info', 3000);
    const R = parseInt(JSON.parse(localStorage.getItem('cmr_prof') || '{}').bizR || '5000');
    const q = `[out:json][timeout:15];(` +
        `node(around:${R},${lat},${lon})[name][office];` +
        `node(around:${R},${lat},${lon})[name][shop];` +
        `node(around:${R},${lat},${lon})[name][amenity];` +
        `node(around:${R},${lat},${lon})[name][industrial];` +
        `way(around:${R},${lat},${lon})[name][office];` +
        `way(around:${R},${lat},${lon})[name][shop];` +
        `way(around:${R},${lat},${lon})[name][industrial];` +
        `way(around:${R},${lat},${lon})[name][building];` +
        `);out center tags 60;`;
    try {
        const res = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(q)
        });
        if(!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const seen = new Set(), items = [];
        (data.elements || []).forEach(e => {
            const t = e.tags || {};
            if(!t.name || seen.has(t.name)) return;
            seen.add(t.name);
            const la = e.lat ?? (e.center && e.center.lat);
            const lo = e.lon ?? (e.center && e.center.lon);
            if(la == null || lo == null) return;
            const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
            const city   = [t['addr:postcode'], t['addr:city']].filter(Boolean).join(' ');
            const addr   = [street, city].filter(Boolean).join('\n');
            items.push({ name: t.name, addr, lat: la, lon: lo, dist: Math.round(distM(lat, lon, la, lo)) });
        });
        items.sort((a, b) => a.dist - b.dist);
        if(!items.length) { toast('Nie znaleziono firm w promieniu ' + (R >= 1000 ? (R/1000) + ' km' : R + ' m'), 'error', 4000); return; }
        showBizList(items.slice(0, 30), targetId);
    } catch(err) {
        console.error('Overpass error:', err);
        toast('❌ Błąd wyszukiwania — sprawdź internet i spróbuj ponownie', 'error', 4000);
    }
}

function showBizList(items, targetId) {
    const l = document.getElementById('modal-list');
    l.innerHTML = '';
    items.forEach((it, i) => {
        const d = document.createElement('div');
        d.className = 'modal-item';
        const dist = it.dist >= 1000 ? (it.dist / 1000).toFixed(1) + ' km' : it.dist + ' m';
        d.innerHTML = `<b>${i + 1}. ${escapeHtml(it.name)}</b> <small style="color:#0056b3;">· ${dist}</small><br>` +
            `<small style="color:#666; white-space:pre-line;">${escapeHtml(it.addr || '(adres zostanie pobrany z mapy)')}</small>`;
        d.onclick = () => pickBiz(it, targetId);
        l.appendChild(d);
    });
    document.getElementById('modal-overlay').style.display = 'flex';
}

async function pickBiz(item, targetId) {
    closeModal();
    let addr = item.addr;
    if(!addr) {
        toast('📫 Pobieranie adresu…', 'info', 2500);
        try {
            const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${item.lat}&lon=${item.lon}&zoom=18`);
            const j = await r.json();
            const a = j.address || {};
            const street = [a.road, a.house_number].filter(Boolean).join(' ');
            const city   = [a.postcode, a.city || a.town || a.village].filter(Boolean).join(' ');
            addr = [street, city, a.country].filter(Boolean).join('\n');
        } catch(e) { addr = ''; }
    }
    const el = document.getElementById(targetId);
    if(el) {
        el.value = item.name + (addr ? '\n' + addr : '');
        scheduleDraftSave();
        clearValidation();
        toast('✅ Dane firmy wstawione — możesz je edytować', 'success');
    }
}

// ============================================================
// HISTORY
// ============================================================
function exportHistoryCSV() {
    const hist = JSON.parse(localStorage.getItem('cmr_history') || '[]');
    if(!hist.length) { toast('Archiwum jest puste', 'error'); return; }
    const cols = ['date','inp_sender','inp_consignee','inp_pickup','inp_destination','inp_tractor','inp_trailer','inp_goods','inp_weight','inp_pal_lin','inp_pal_lout','inp_pal_din','inp_pal_dout'];
    const head = ['Data','Nadawca','Odbiorca','Załadunek','Dostawa','Ciągnik','Naczepa','Towar','Waga kg','Pal.IN zał.','Pal.OUT zał.','Pal.IN dost.','Pal.OUT dost.'];
    const esc = v => '"' + String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' | ') + '"';
    const rows = [head.map(esc).join(';')].concat(
        hist.map(h => cols.map(c => esc(h[c])).join(';'))
    );
    const blob = new Blob(['\ufeff' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cmr_archiwum_' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('✅ Plik CSV pobrany — otwórz w Excelu', 'success');
}

function renderStats() {
    const box = document.getElementById('stats-box');
    if(!box) return;
    const hist = JSON.parse(localStorage.getItem('cmr_history') || '[]');
    const now = new Date();
    const month = hist.filter(h => {
        const d = new Date(h.id);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const sum = (arr, key) => arr.reduce((a, h) => a + (parseInt(h[key], 10) || 0), 0);
    const palIn  = sum(month, 'inp_pal_lin')  + sum(month, 'inp_pal_din');
    const palOut = sum(month, 'inp_pal_lout') + sum(month, 'inp_pal_dout');
    const tile = (num, label) =>
        `<div style="flex:1; background:#f4f7fb; border-radius:10px; padding:10px 4px;">` +
        `<div style="font-size:20px; font-weight:800; color:#0056b3;">${num}</div>` +
        `<div style="font-size:10px; color:#777; margin-top:2px;">${label}</div></div>`;
    box.innerHTML =
        tile(hist.length, 'tras łącznie') +
        tile(month.length, 'tras w tym mies.') +
        tile(palIn, 'palety IN (mies.)') +
        tile(palOut, 'palety OUT (mies.)');
}

function repeatLastRoute() {
    const hist = JSON.parse(localStorage.getItem('cmr_history') || '[]');
    if(!hist.length) { toast('Archiwum jest puste — najpierw zapisz trasę', 'error'); return; }
    restoreHistory(hist[0].id);
}

function saveCurrentToHistory() {
    const sender = document.getElementById('inp_sender').value;
    const consignee = document.getElementById('inp_consignee').value;
    if(!sender && !consignee) {
        toast('Wypełnij chociaż Nadawcę lub Odbiorcę!', 'error');
        return;
    }

    const data = { id: Date.now(), date: new Date().toLocaleString() };
    CMR_FIELD_IDS.forEach(id => { data[id] = document.getElementById(id)?.value || ''; });

    // Save sig thumbnails
    ['sig1','sig2'].forEach(id => {
        const pad = sigPads[id];
        if(pad && pad.canvas.width > 0) data['_' + id] = pad.canvas.toDataURL('image/png');
    });

    let hist = JSON.parse(localStorage.getItem('cmr_history') || '[]');
    hist.unshift(data);
    localStorage.setItem('cmr_history', JSON.stringify(hist));
    toast('✅ Trasa zapisana w archiwum!', 'success');
}

function loadHistoryList() {
    const list = document.getElementById('history-list');
    const hist = JSON.parse(localStorage.getItem('cmr_history') || '[]');
    list.innerHTML = '';

    if(hist.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:30px; color:#999; font-size:14px;">Brak zapisanych tras.</div>';
        return;
    }

    hist.forEach(item => {
        const div = document.createElement('div');
        const pickup = (item.inp_pickup || item.delivery || '').split(',')[0];
        const dest   = (item.inp_destination || item.loading || '').split(',')[0];
        let route = 'Trasa nieznana';
        if(pickup || dest) route = `${pickup || '?'} ➝ ${dest || '?'}`;
        const hasGoods = !!(item.inp_goods || item.goods);
        div.className = 'history-item' + (hasGoods ? ' has-goods' : '');
        div.innerHTML = `
            <div class="history-date">${item.date}</div>
            <div class="history-route">${route}</div>
            <div style="font-size:12px; color:#666; margin-bottom:10px;">
                🚛 ${item.inp_tractor || item.tractor || '–'} / ${item.inp_trailer || item.trailer || '–'}
                ${(item.inp_goods || item.goods) ? '<br>📦 ' + (item.inp_goods || item.goods).substring(0,60) + '…' : ''}
            </div>
            <div style="display:flex; gap:8px;">
                <button class="btn btn-primary" style="margin:0; font-size:12px; padding:8px;" onclick="restoreHistory(${item.id})">📂 Załaduj</button>
                <button class="btn btn-danger" style="margin:0; font-size:12px; padding:8px;" onclick="deleteHistory(${item.id})">🗑️ Usuń</button>
            </div>
        `;
        list.appendChild(div);
    });
}

function restoreHistory(id) {
    const hist = JSON.parse(localStorage.getItem('cmr_history') || '[]');
    const item = hist.find(x => x.id === id);
    if(!item) return;
    if(!confirm('Załadować tę trasę? Obecne dane CMR zostaną nadpisane.')) return;

    CMR_FIELD_IDS.forEach(fid => {
        const el = document.getElementById(fid);
        if(el) el.value = item[fid] ?? item[fid.replace('inp_','')] ?? '';
    });

    // Restore signatures
    ['sig1','sig2'].forEach(id => {
        const key = '_' + id;
        const pad = sigPads[id];
        if(item[key] && pad) {
            const img = new Image();
            img.onload = () => {
                pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
                pad.ctx.drawImage(img, 0, 0, pad.canvas.width, pad.canvas.height);
            };
            img.src = item[key];
        } else if(pad) {
            pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
        }
    });

    updateCarrierDisplay();
    scheduleDraftSave();
    nav('cmr', document.querySelector('.nav-item'));
    toast('✅ Trasa załadowana!', 'success');
}

function deleteHistory(id) {
    if(!confirm('Usunąć ten wpis z archiwum?')) return;
    let hist = JSON.parse(localStorage.getItem('cmr_history') || '[]');
    hist = hist.filter(x => x.id !== id);
    localStorage.setItem('cmr_history', JSON.stringify(hist));
    loadHistoryList();
    toast('Wpis usunięty', 'info');
}

function clearHistory() {
    if(!confirm('Czy na pewno wyczyścić CAŁE archiwum tras?')) return;
    localStorage.removeItem('cmr_history');
    loadHistoryList();
    toast('Archiwum wyczyszczone', 'info');
}

// ============================================================
// DATABASE
// ============================================================
let pkField = null;

function openPicker(f) {
    pkField = f;
    const db = JSON.parse(localStorage.getItem('cmr_db') || '[]');
    const l = document.getElementById('modal-list');
    l.innerHTML = '';
    const flt = db.filter(i => i.tag === f);
    if(flt.length === 0) {
        l.innerHTML = '<div style="text-align:center; padding:20px; color:#999; font-size:13px;">Brak wpisów. Dodaj w zakładce Baza.</div>';
    }
    flt.forEach(i => {
        const d = document.createElement('div');
        d.className = 'modal-item';
        d.innerHTML = `<b>${i.name}</b><br><small style="color:#666; white-space:pre-line;">${i.val}</small>`;
        d.onclick = () => {
            const target = document.getElementById('inp_' + pkField);
            if(target) { target.value = i.val; scheduleDraftSave(); clearValidation(); }
            closeModal();
        };
        l.appendChild(d);
    });
    document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
}

document.getElementById('modal-overlay').addEventListener('click', function(e) {
    if(e.target === this) closeModal();
});

document.getElementById('box-modal').addEventListener('click', function(e) {
    if(e.target === this) this.style.display = 'none';
});

function saveToDb(mode) {
    let item = { id: Date.now() };
    if(mode === 'addr') {
        item.name = document.getElementById('db_name').value.trim();
        item.val  = document.getElementById('db_value').value.trim();
        item.tag  = document.getElementById('db_type').value;
        if(!item.name) { toast('Wpisz nazwę!', 'error'); return; }
        if(!item.val) { toast('Wpisz dane adresowe!', 'error'); return; }
        document.getElementById('db_name').value = '';
        document.getElementById('db_value').value = '';
    } else {
        item.name = document.getElementById('db_plate').value.trim();
        item.val  = item.name;
        item.tag  = document.getElementById('db_vtype').value;
        if(!item.name) { toast('Wpisz numer rejestracyjny!', 'error'); return; }
        document.getElementById('db_plate').value = '';
    }
    let db = JSON.parse(localStorage.getItem('cmr_db') || '[]');
    db.push(item);
    localStorage.setItem('cmr_db', JSON.stringify(db));
    toast('✅ Zapisano w bazie!', 'success');
    loadDb();
}

function loadDb() {
    const db = JSON.parse(localStorage.getItem('cmr_db') || '[]');
    const l = document.getElementById('db-list');
    l.innerHTML = '';
    if(db.length === 0) {
        l.innerHTML = '<li style="color:#999; font-size:13px; justify-content:center;">Baza jest pusta</li>';
        return;
    }
    const TAG_LABELS = { sender:'Nadawca', consignee:'Odbiorca', pickup:'Załadunek', destination:'Dostawa', tractor:'Ciągnik', trailer:'Naczepa' };
    db.forEach(i => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div>
                <div style="font-weight:bold; font-size:14px;">${i.name}</div>
                <div style="font-size:11px; color:#888;">${TAG_LABELS[i.tag] || i.tag}</div>
            </div>
            <button class="btn-danger" style="width:auto; padding:6px 10px; border:none; border-radius:6px; color:white; cursor:pointer;" onclick="delDb(${i.id})">✕</button>
        `;
        l.appendChild(li);
    });
}

function delDb(id) {
    let db = JSON.parse(localStorage.getItem('cmr_db') || '[]');
    db = db.filter(i => i.id !== id);
    localStorage.setItem('cmr_db', JSON.stringify(db));
    loadDb();
    toast('Wpis usunięty', 'info');
}

// ============================================================
// PROFILE
// ============================================================
function saveProfile() {
    const d = {
        c_name:   document.getElementById('profile_c_name').value,
        c:        document.getElementById('profile_carrier').value,
        tr:       document.getElementById('profile_tr').value,
        trl:      document.getElementById('profile_trl').value,
        autodate: document.getElementById('profile_autodate').checked,
        skiphome: document.getElementById('profile_skiphome').checked,
        place20:  document.getElementById('profile_place20').value,
        bizR:     document.getElementById('profile_bizrange').value
    };
    localStorage.setItem('cmr_prof', JSON.stringify(d));
    updateCMRFromProfile(d);
    applyDocDefaults();
    toast('✅ Profil zapisany!', 'success');
}

function loadProfile() {
    const d = JSON.parse(localStorage.getItem('cmr_prof'));
    if(!d) return;
    if(d.c_name)  document.getElementById('profile_c_name').value = d.c_name;
    if(d.c)       document.getElementById('profile_carrier').value = d.c;
    if(d.tr)      document.getElementById('profile_tr').value = d.tr;
    if(d.trl)     document.getElementById('profile_trl').value = d.trl;
    if(d.autodate) document.getElementById('profile_autodate').checked = true;
    if(d.skiphome) document.getElementById('profile_skiphome').checked = true;
    if(d.place20) document.getElementById('profile_place20').value = d.place20;
    if(d.bizR)    document.getElementById('profile_bizrange').value = d.bizR;
    updateCMRFromProfile(d);
}

// Fill empty date/place fields from document defaults (never overwrites)
function applyDocDefaults() {
    const d = JSON.parse(localStorage.getItem('cmr_prof') || '{}');
    if(d.place20) {
        const el = document.getElementById('inp_place20');
        if(el && !el.value) el.value = d.place20;
    }
    if(d.autodate) {
        const today = new Date().toISOString().slice(0, 10);
        ['inp_date20', 'inp_sig1_date'].forEach(id => {
            const el = document.getElementById(id);
            if(el && !el.value) el.value = today;
        });
    }
}

function updateCMRFromProfile(d) {
    let carrierText = '';
    if(d.c_name) carrierText += d.c_name.toUpperCase() + '\n';
    if(d.c) carrierText += d.c;
    const carrierEl = document.getElementById('inp_carrier');
    // empty profile carrier = back to the built-in Nolan Transport default
    if(carrierEl) carrierEl.value = carrierText.trim() ? carrierText : DEFAULT_CARRIER;
    updateCarrierDisplay();
    if(typeof scheduleDraftSave === 'function') scheduleDraftSave();
    if(d.tr)  { const el = document.getElementById('inp_tractor'); if(el) el.value = d.tr; }
    if(d.trl) { const el = document.getElementById('inp_trailer'); if(el) el.value = d.trl; }
}

// ============================================================
// BACKUP
// ============================================================
function exportData() {
    const backup = {
        db:     JSON.parse(localStorage.getItem('cmr_db')      || '[]'),
        prof:   JSON.parse(localStorage.getItem('cmr_prof')    || '{}'),
        hist:   JSON.parse(localStorage.getItem('cmr_history') || '[]'),
        sig:    localStorage.getItem('cmr_sig') || '',
        layout: localStorage.getItem('cmr_layout') || '',
        pin:    localStorage.getItem('cmr_pin') || '',
        date:   new Date().toLocaleString()
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cmr_backup_' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Backup pobrany!', 'success');
}

function importData(input) {
    const file = input.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const backup = JSON.parse(e.target.result);
            if(!confirm(`Wgrać backup z dnia: ${backup.date || '?'}?\nAktualne dane zostaną nadpisane.`)) return;
            if(backup.db)   localStorage.setItem('cmr_db', JSON.stringify(backup.db));
            if(backup.prof) localStorage.setItem('cmr_prof', JSON.stringify(backup.prof));
            if(backup.hist) localStorage.setItem('cmr_history', JSON.stringify(backup.hist));
            if(backup.sig)    localStorage.setItem('cmr_sig', backup.sig);
            if(backup.layout) localStorage.setItem('cmr_layout', backup.layout);
            if(backup.pin)    localStorage.setItem('cmr_pin', backup.pin);
            toast('✅ Backup wgrany! Odświeżanie…', 'success');
            setTimeout(() => location.reload(), 1200);
        } catch(err) { toast('❌ Błąd pliku backup!', 'error'); }
    };
    reader.readAsText(file);
    input.value = '';
}

// ============================================================
// SIGNATURE PADS
// ============================================================
const sigPads = {};

function setupSignaturePad(id) {
    const canvas = document.getElementById(id);
    if(!canvas) return null;
    const ctx = canvas.getContext('2d');
    const pad = { canvas, ctx, drawing: false };
    sigPads[id] = pad;
    resizeSigCanvas(pad);
    attachSigEvents(pad);
    return pad;
}

function resizeSigCanvas(pad) {
    if(!pad) return;
    const { canvas, ctx } = pad;
    if(!canvas || canvas.offsetWidth === 0 || canvas.offsetHeight === 0) return;
    const RES = Math.max(window.devicePixelRatio || 1, 2);
    const newW = Math.round(canvas.offsetWidth  * RES);
    const newH = Math.round(canvas.offsetHeight * RES);
    if(canvas.width === newW && canvas.height === newH) return;

    let snapshot = null;
    if(canvas.width > 0 && canvas.height > 0) {
        snapshot = document.createElement('canvas');
        snapshot.width  = canvas.width;
        snapshot.height = canvas.height;
        snapshot.getContext('2d').drawImage(canvas, 0, 0);
    }
    canvas.width  = newW;
    canvas.height = newH;
    if(snapshot) ctx.drawImage(snapshot, 0, 0, snapshot.width, snapshot.height, 0, 0, newW, newH);
}

function getSigPos(pad, e) {
    const rect = pad.canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return {
        x: (t.clientX - rect.left)  * (pad.canvas.width  / rect.width),
        y: (t.clientY - rect.top)   * (pad.canvas.height / rect.height)
    };
}

function attachSigEvents(pad) {
    const { canvas, ctx } = pad;
    const start = (e) => {
        e.preventDefault();
        resizeSigCanvas(pad);
        pad.drawing = true;
        const rect = canvas.getBoundingClientRect();
        ctx.lineWidth   = 1.5 * (canvas.width / rect.width);
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.strokeStyle = '#000';
        const p = getSigPos(pad, e);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
    };
    const move = (e) => {
        if(!pad.drawing) return;
        e.preventDefault();
        const p = getSigPos(pad, e);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
    };
    const end = () => {
        if(!pad.drawing) return;
        pad.drawing = false;
        scheduleDraftSave();
    };
    canvas.addEventListener('touchstart',  start, { passive: false });
    canvas.addEventListener('mousedown',   start);
    canvas.addEventListener('touchmove',   move,  { passive: false });
    canvas.addEventListener('mousemove',   move);
    canvas.addEventListener('touchend',    end);
    canvas.addEventListener('mouseup',     end);
    canvas.addEventListener('mouseleave',  end);
}

function clearSig(id) {
    const pad = sigPads[id];
    if(!pad) return;
    pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
    scheduleDraftSave();
}

function clearP() { clearSig('profile-sig-canvas'); }

function saveProfileSig() {
    const pad = sigPads['profile-sig-canvas'];
    if(!pad || pad.canvas.width === 0) { toast('Najpierw narysuj podpis!', 'error'); return; }
    localStorage.setItem('cmr_sig', pad.canvas.toDataURL());
    toast('✅ Podpis zapisany w profilu!', 'success');
}

function pasteMySig() {
    const s = localStorage.getItem('cmr_sig');
    if(!s) { toast('Ustaw podpis w Profilu → Twój stały podpis', 'warning'); return; }
    const pad = sigPads['sig2'];
    if(!pad) return;
    const img = new Image();
    img.onload = () => {
        resizeSigCanvas(pad);
        const dst = pad.canvas;
        pad.ctx.clearRect(0, 0, dst.width, dst.height);
        // contain: keep the signature's proportions, never stretch it
        const scale = Math.min(dst.width / img.width, dst.height / img.height);
        const dw = img.width * scale, dh = img.height * scale;
        pad.ctx.drawImage(img, (dst.width - dw) / 2, (dst.height - dh) / 2, dw, dh);
        scheduleDraftSave();
    };
    img.src = s;
    toast('Podpis wklejony', 'success');
}

// ============================================================
// FULLSCREEN SIGNATURE OVERLAY
// ============================================================
let overlaySigTarget = null;
let overlaySigPad    = null;

function setupOverlaySigPad() {
    const canvas = document.getElementById('overlay-sig-canvas');
    const ctx = canvas.getContext('2d');
    const pad = { canvas, ctx, drawing: false };
    overlaySigPad = pad;
    attachSigEvents(pad);
}

function openOverlaySig(targetId, label) {
    overlaySigTarget = targetId;
    document.getElementById('sig-overlay-title').textContent = label || 'Podpis';
    document.getElementById('sig-overlay').classList.add('open');

    requestAnimationFrame(() => {
        // Full-screen drawing area — big and comfortable; on confirm the
        // signature is trimmed to its ink and contain-fitted to the box
        const canvas = overlaySigPad.canvas;
        const wrap = document.getElementById('sig-overlay-wrap');
        const PAD = 10;
        const boxW = wrap.clientWidth  - PAD * 2;
        const boxH = wrap.clientHeight - PAD * 2;
        const DPR  = window.devicePixelRatio || 1;

        canvas.style.width  = boxW + 'px';
        canvas.style.height = boxH + 'px';
        canvas.style.left   = PAD + 'px';
        canvas.style.top    = PAD + 'px';
        canvas.width  = Math.round(boxW * DPR);
        canvas.height = Math.round(boxH * DPR);
        overlaySigPad.ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
}

function closeOverlaySig() {
    document.getElementById('sig-overlay').classList.remove('open');
    overlaySigTarget = null;
}

function clearOverlaySig() {
    const c = overlaySigPad.canvas;
    overlaySigPad.ctx.clearRect(0, 0, c.width, c.height);
}

function trimOverlaySig() {
    // crop the drawn ink's bounding box so a full-screen scribble becomes
    // a tight signature that fills the destination box nicely
    const c = overlaySigPad.canvas, ctx = overlaySigPad.ctx;
    const w = c.width, h = c.height;
    if(!w || !h) return null;
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for(let y = 0; y < h; y++) {
        const row = y * w;
        for(let x = 0; x < w; x++) {
            if(data[(row + x) * 4 + 3] > 10) {
                if(x < minX) minX = x;
                if(x > maxX) maxX = x;
                if(y < minY) minY = y;
                if(y > maxY) maxY = y;
            }
        }
    }
    if(maxX < 0) return null;
    const m = Math.round(Math.min(w, h) * 0.03) + 4;
    minX = Math.max(0, minX - m); minY = Math.max(0, minY - m);
    maxX = Math.min(w - 1, maxX + m); maxY = Math.min(h - 1, maxY + m);
    const tw = maxX - minX + 1, th = maxY - minY + 1;
    const t = document.createElement('canvas');
    t.width = tw; t.height = th;
    t.getContext('2d').drawImage(c, minX, minY, tw, th, 0, 0, tw, th);
    return t;
}

function confirmOverlaySig() {
    if(!overlaySigTarget) { closeOverlaySig(); return; }

    const src = trimOverlaySig();
    if(!src) { toast('Najpierw podpisz się w ramce!', 'error'); return; }

    function containCopy(dstPad) {
        resizeSigCanvas(dstPad);
        const dst = dstPad.canvas;
        dstPad.ctx.clearRect(0, 0, dst.width, dst.height);
        const scale = Math.min(dst.width / src.width, dst.height / src.height);
        const dw = src.width * scale, dh = src.height * scale;
        dstPad.ctx.drawImage(src, (dst.width - dw) / 2, (dst.height - dh) / 2, dw, dh);
    }

    if(overlaySigTarget === 'profile-sig-canvas') {
        const profPad = sigPads['profile-sig-canvas'];
        if(!profPad) { closeOverlaySig(); return; }
        containCopy(profPad);
        closeOverlaySig();
        toast('Podpis zatwierdzony — kliknij Zapisz!', 'info');
        return;
    }

    const destPad = sigPads[overlaySigTarget];
    if(!destPad) { closeOverlaySig(); return; }
    containCopy(destPad);
    scheduleDraftSave();
    closeOverlaySig();
    toast('Podpis zatwierdzony!', 'success');
}

// ============================================================
// DRAFT AUTOSAVE
// ============================================================
let draftTimer = null;

function scheduleDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 700);
}

function saveDraft() {
    const fields = {};
    CMR_FIELD_IDS.forEach(id => {
        const el = document.getElementById(id);
        if(el) fields[id] = el.value;
    });
    const data = { fields };
    ['sig1','sig2'].forEach(id => {
        const pad = sigPads[id];
        if(pad && pad.canvas.width > 0) data[id] = pad.canvas.toDataURL('image/png');
    });
    localStorage.setItem('cmr_draft', JSON.stringify(data));
    const status = document.getElementById('draft-status');
    if(status) {
        const now = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
        status.textContent = `Zapisano roboczo o ${now}`;
    }
}

function loadDraft() {
    const raw = localStorage.getItem('cmr_draft');
    if(!raw) return;
    try {
        const data = JSON.parse(raw);
        if(data.fields) {
            Object.entries(data.fields).forEach(([id, val]) => {
                // Field 5 (carrier) is never restored from the draft: its
                // content is owned by the profile settings (or the built-in
                // Nolan default). The device-local draft used to resurrect
                // stale manual data here forever.
                if(id === 'inp_carrier') return;
                const el = document.getElementById(id);
                if(el) el.value = val;
            });
        }
        ['sig1','sig2'].forEach(id => {
            if(data[id]) {
                const pad = sigPads[id];
                if(!pad) return;
                const img = new Image();
                img.onload = () => {
                    resizeSigCanvas(pad);
                    pad.ctx.drawImage(img, 0, 0, pad.canvas.width, pad.canvas.height);
                };
                img.src = data[id];
            }
        });
    } catch(e) {}
}

// ============================================================
// NEW CMR
// ============================================================
function newCMR() {
    if(!confirm('Wyczyścić formularz CMR? Niezapisane dane zostaną utracone.')) return;
    CMR_FIELD_IDS.forEach(id => {
        if(KEEP_ON_NEW.includes(id)) return;
        const el = document.getElementById(id);
        if(el) el.value = '';
    });
    const f14 = document.getElementById('inp_f14');
    if(f14) f14.value = DEFAULT_F14;
    clearSig('sig1');
    clearSig('sig2');
    clearValidation();
    updateCarrierDisplay();
    applyDocDefaults();
    localStorage.removeItem('cmr_draft');
    const status = document.getElementById('draft-status');
    if(status) status.textContent = '';
    toast('✅ Nowy formularz gotowy!', 'success');
}

// ============================================================
// SIGNATURE FROM IMAGE FILE (drag & scale crop)
// ============================================================
let sigImgObj = null, sigImgBase = 1, sigImgMul = 1, sigImgX = 0, sigImgY = 0, sigImgDrag = null;

function onSigImgFile(input) {
    const f = input.files && input.files[0];
    if(!f) return;
    const rd = new FileReader();
    rd.onload = () => {
        const img = new Image();
        img.onload = () => {
            sigImgObj = img;
            const cv = document.getElementById('sigimg-canvas');
            sigImgBase = Math.min(cv.width / img.width, cv.height / img.height);
            sigImgMul = 1;
            sigImgX = (cv.width  - img.width  * sigImgBase) / 2;
            sigImgY = (cv.height - img.height * sigImgBase) / 2;
            document.getElementById('sigimg-scale').value = 1;
            document.getElementById('sigimg-modal').style.display = 'flex';
            drawSigImg();
        };
        img.src = rd.result;
    };
    rd.readAsDataURL(f);
    input.value = '';
}

function drawSigImg() {
    const cv = document.getElementById('sigimg-canvas');
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    if(!sigImgObj) return;
    const s = sigImgBase * sigImgMul;
    ctx.drawImage(sigImgObj, sigImgX, sigImgY, sigImgObj.width * s, sigImgObj.height * s);
}

function sigImgScale(mul) {
    if(!sigImgObj) return;
    const cv = document.getElementById('sigimg-canvas');
    const s0 = sigImgBase * sigImgMul, s1 = sigImgBase * mul;
    // scale around the canvas centre so the signature stays in view
    const cx = (cv.width / 2 - sigImgX) / s0, cy = (cv.height / 2 - sigImgY) / s0;
    sigImgMul = mul;
    sigImgX = cv.width / 2  - cx * s1;
    sigImgY = cv.height / 2 - cy * s1;
    drawSigImg();
}

function initSigImgDrag() {
    const cv = document.getElementById('sigimg-canvas');
    if(!cv) return;
    const down = (e) => {
        if(!sigImgObj) return;
        const t = e.touches ? e.touches[0] : e;
        sigImgDrag = { x0: t.clientX, y0: t.clientY, ix: sigImgX, iy: sigImgY };
        e.preventDefault();
    };
    const move = (e) => {
        if(!sigImgDrag) return;
        const t = e.touches ? e.touches[0] : e;
        const r = cv.getBoundingClientRect();
        const k = cv.width / r.width;   // css px -> canvas px
        sigImgX = sigImgDrag.ix + (t.clientX - sigImgDrag.x0) * k;
        sigImgY = sigImgDrag.iy + (t.clientY - sigImgDrag.y0) * k;
        drawSigImg();
        e.preventDefault();
    };
    const up = () => { sigImgDrag = null; };
    cv.addEventListener('touchstart', down, {passive: false});
    cv.addEventListener('mousedown', down);
    cv.addEventListener('touchmove', move, {passive: false});
    document.addEventListener('mousemove', move);
    cv.addEventListener('touchend', up);
    document.addEventListener('mouseup', up);
}

function saveSigImg() {
    if(!sigImgObj) { toast('Najpierw wybierz plik z podpisem', 'error'); return; }
    const cv = document.getElementById('sigimg-canvas');
    const url = cv.toDataURL('image/png');
    localStorage.setItem('cmr_sig', url);
    const pad = sigPads['profile-sig-canvas'];
    if(pad) {
        const img = new Image();
        img.onload = () => {
            resizeSigCanvas(pad);
            pad.ctx.clearRect(0, 0, pad.canvas.width, pad.canvas.height);
            const scale = Math.min(pad.canvas.width / img.width, pad.canvas.height / img.height);
            const dw = img.width * scale, dh = img.height * scale;
            pad.ctx.drawImage(img, (pad.canvas.width - dw) / 2, (pad.canvas.height - dh) / 2, dw, dh);
        };
        img.src = url;
    }
    document.getElementById('sigimg-modal').style.display = 'none';
    toast('✅ Podpis z pliku zapisany — użyj "Mój Podpis" w polu 18', 'success');
}

// ============================================================
// ICON ANCHORING — pickers/GPS icons always stick to their fields
// ============================================================
let iconAnchors = [];

function captureIconAnchors() {
    // must run BEFORE any saved layout is applied: offsets are taken from
    // the HTML defaults where icons and fields are aligned by design
    document.querySelectorAll('#cmr-page .quick-pick, #cmr-page .geo-btn').forEach(icon => {
        const oc = icon.getAttribute('onclick') || '';
        let target = null, m;
        if((m = oc.match(/openPicker\('(\w+)'\)/)))              target = 'inp_' + m[1];
        if((m = oc.match(/(?:getGeo|findNearbyBiz)\('(\w+)'\)/))) target = m[1];
        const t = target && document.getElementById(target);
        if(!t) return;
        iconAnchors.push({
            icon,
            target: t,
            dx: (parseFloat(icon.style.left) || 0) - (parseFloat(t.style.left) || 0),
            dy: (parseFloat(icon.style.top)  || 0) - (parseFloat(t.style.top)  || 0)
        });
    });
}

function anchorIcons() {
    iconAnchors.forEach(a => {
        a.icon.style.left = ((parseFloat(a.target.style.left) || 0) + a.dx).toFixed(1) + 'mm';
        a.icon.style.top  = ((parseFloat(a.target.style.top)  || 0) + a.dy).toFixed(1) + 'mm';
    });
}

// ============================================================
// APP AUTO-UPDATE — defeat stale caches on phones
// ============================================================
// Bumped on every deploy; compared against the copy on the server, so the
// check reflects what is actually RUNNING, not what the server last served.
const APP_BUILD = window.APP_BUILD || 'dev';
let lastUpdateCheck = 0;

async function checkAppUpdate(silent = true) {
    try {
        const res = await fetch('index.html?u=' + Date.now(), { cache: 'no-store' });
        if(!res.ok) { if(!silent) toast('Nie udało się sprawdzić — brak internetu?', 'error'); return; }
        const txt = await res.text();
        const m = txt.match(/APP_BUILD = '([^']+)'/);
        if(!m) return;
        if(m[1] === APP_BUILD) {
            if(!silent) toast('✅ Masz najnowszą wersję aplikacji (' + APP_BUILD + ')', 'success');
            return;
        }
        // Server has a different build than the one running — purge caches
        // and reload into it, at most once per session to avoid loops
        if(sessionStorage.getItem('cmr_app_updated')) {
            if(!silent) toast('Nowa wersja czeka — zamknij i otwórz aplikację', 'info', 5000);
            return;
        }
        sessionStorage.setItem('cmr_app_updated', '1');
        if(window.caches) {
            try {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
            } catch(e) {}
        }
        toast('🔄 Pobieranie nowej wersji aplikacji…', 'info', 2500);
        setTimeout(() => location.reload(), 900);
    } catch(e) {
        if(!silent) toast('Nie udało się sprawdzić — brak internetu?', 'error');
    }
}

function scheduleUpdateChecks() {
    checkAppUpdate(true);
    document.addEventListener('visibilitychange', () => {
        if(document.visibilityState === 'visible' && Date.now() - lastUpdateCheck > 5 * 60 * 1000) {
            lastUpdateCheck = Date.now();
            checkAppUpdate(true);
        }
    });
}

// ============================================================
// PINCH ZOOM — gallery-like zoom/pan of the CMR preview
// ============================================================
let vz = { z: 1, x: 0, y: 0, pinch: null, pan: null, lastTap: 0, tapX: 0, tapY: 0 };

function vzBase() {
    // must mirror the .page mobile scale in CSS (@media max-width:800px)
    return window.matchMedia('(max-width: 800px)').matches ? 0.48 : 1;
}

function vzApply() {
    if(leActive) return;   // the layout editor manages its own zoom
    const page = document.getElementById('cmr-page');
    if(vz.z <= 1.001) {
        vz.z = 1; vz.x = 0; vz.y = 0;
        page.style.transform = '';
        page.style.transformOrigin = '';
    } else {
        page.style.transformOrigin = 'top left';
        page.style.transform = 'translate(' + vz.x.toFixed(1) + 'px, ' + vz.y.toFixed(1) + 'px) scale(' + (vzBase() * vz.z).toFixed(4) + ')';
    }
    const btn = document.getElementById('zoom-reset-btn');
    if(btn) btn.style.display = vz.z > 1.001 ? 'block' : 'none';
}

function resetViewZoom() {
    vz.z = 1;
    vzApply();
}

function vzZoomTo(z1, cx, cy) {
    const page = document.getElementById('cmr-page');
    const rect = page.getBoundingClientRect();
    const S0 = vzBase() * vz.z;
    const ox = rect.left - vz.x, oy = rect.top - vz.y;
    const px = (cx - rect.left) / S0, py = (cy - rect.top) / S0;
    vz.z = Math.min(5, Math.max(1, z1));
    const S1 = vzBase() * vz.z;
    vz.x = cx - ox - S1 * px;
    vz.y = cy - oy - S1 * py;
    vzApply();
}

function initPinchZoom() {
    const wrap = document.querySelector('.cmr-wrapper');
    const page = document.getElementById('cmr-page');
    if(!wrap || !page) return;

    wrap.addEventListener('touchstart', (e) => {
        if(leActive) return;
        // never hijack touches meant for signature drawing
        if(e.target.tagName === 'CANVAS' || e.target.closest && e.target.closest('.sig-box')) return;
        if(e.touches.length === 2) {
            e.preventDefault();
            const a = e.touches[0], b = e.touches[1];
            const rect = page.getBoundingClientRect();
            const S0 = vzBase() * vz.z;
            vz.pan = null;
            vz.pinch = {
                d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
                z0: vz.z,
                ox: rect.left - vz.x, oy: rect.top - vz.y,
                px: ((a.clientX + b.clientX) / 2 - rect.left) / S0,
                py: ((a.clientY + b.clientY) / 2 - rect.top)  / S0
            };
        } else if(e.touches.length === 1 && vz.z > 1.001) {
            const t = e.touches[0];
            vz.pan = { x0: t.clientX, y0: t.clientY, px: vz.x, py: vz.y, moved: false };
        }
    }, { passive: false });

    wrap.addEventListener('touchmove', (e) => {
        if(leActive) return;
        if(vz.pinch && e.touches.length === 2) {
            e.preventDefault();
            const a = e.touches[0], b = e.touches[1];
            const d  = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            const z1 = Math.min(5, Math.max(1, vz.pinch.z0 * d / vz.pinch.d0));
            const S1 = vzBase() * z1;
            const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
            vz.z = z1;
            vz.x = mx - vz.pinch.ox - S1 * vz.pinch.px;
            vz.y = my - vz.pinch.oy - S1 * vz.pinch.py;
            vzApply();
        } else if(vz.pan && e.touches.length === 1) {
            const t = e.touches[0];
            const dx = t.clientX - vz.pan.x0, dy = t.clientY - vz.pan.y0;
            if(!vz.pan.moved && Math.hypot(dx, dy) > 6) vz.pan.moved = true;
            if(vz.pan.moved) {
                e.preventDefault();
                vz.x = vz.pan.px + dx;
                vz.y = vz.pan.py + dy;
                vzApply();
            }
        }
    }, { passive: false });

    wrap.addEventListener('touchend', (e) => {
        if(leActive) { vz.pinch = null; vz.pan = null; return; }
        if(e.touches.length < 2) vz.pinch = null;
        if(e.touches.length === 0) {
            const moved = vz.pan && vz.pan.moved;
            vz.pan = null;
            // double-tap toggles zoom (skipped on interactive elements)
            const t = e.changedTouches && e.changedTouches[0];
            if(t && !moved && !['INPUT','TEXTAREA','BUTTON','CANVAS','SELECT'].includes(e.target.tagName)) {
                const now = Date.now();
                if(now - vz.lastTap < 320 && Math.hypot(t.clientX - vz.tapX, t.clientY - vz.tapY) < 30) {
                    vz.lastTap = 0;
                    if(vz.z > 1.001) resetViewZoom();
                    else vzZoomTo(2.5, t.clientX, t.clientY);
                } else {
                    vz.lastTap = now; vz.tapX = t.clientX; vz.tapY = t.clientY;
                }
            }
        }
    });
}

// ============================================================
// CARRIER DISPLAY
// ============================================================
const DEFAULT_CARRIER = 'NOLAN TRANSPORT HOLDINGS LIMITED\nOaklands, New Ross, Co. Wexford Y34 X335, Ireland\nTel: +353 51 421965\nEmail: sales@nolantransport.com\nwww.nolantransport.com';

function updateCarrierDisplay() {
    const ta     = document.getElementById('inp_carrier');
    const disp   = document.getElementById('carrier-display');
    const nameEl = document.getElementById('carrier-name-el');
    const addrEl = document.getElementById('carrier-addr-el');
    if(!ta || !disp || !nameEl || !addrEl) return;
    // Restore the permanent Nolan data if the field is empty — but not while
    // the user is actively typing in it (advanced editor mode)
    if(!ta.value.trim() && document.activeElement !== ta) ta.value = DEFAULT_CARRIER;
    // Display mirrors the textarea's geometry and font styling, so editor
    // changes made to the textarea carry over to the printed layout
    if(ta.style.top)    disp.style.top    = ta.style.top;
    if(ta.style.left)   disp.style.left   = ta.style.left;
    if(ta.style.width)  disp.style.width  = ta.style.width;
    if(ta.style.height) disp.style.height = ta.style.height;
    if(ta.style.fontStyle) disp.style.fontStyle = ta.style.fontStyle;
    if(ta.style.fontSize) {
        const pt = parseFloat(ta.style.fontSize) || 8;
        addrEl.style.fontSize = pt.toFixed(1) + 'pt';
        nameEl.style.fontSize = (pt + 3).toFixed(1) + 'pt';
    }
    const lines = ta.value.split('\n').map(l => l.trim()).filter(l => l);
    nameEl.textContent = lines[0] || '';
    addrEl.textContent = '';
    lines.slice(1).forEach((line, i) => {
        if(i > 0) addrEl.appendChild(document.createElement('br'));
        addrEl.appendChild(document.createTextNode(line));
    });
}

// ============================================================
// ADVANCED LAYOUT EDITOR
// ============================================================
const CSS_PX_MM  = 96 / 25.4;
let leUnlocked   = false;
let leActive     = false;
let leSelected   = null;
let leDrag       = null;
let leRHs        = [];
let leLockedIds  = new Set();
let leHiddenIds  = new Set();

function getPageScale() {
    const t = getComputedStyle(document.getElementById('cmr-page')).transform;
    if(!t || t === 'none') return 1;
    const m = new DOMMatrix(t);
    return Math.abs(m.a) || 1;
}

// ---- PIN / unlock ----
function requestLEMode() {
    if(leUnlocked) {
        if(leActive) deactivateLEMode();
        else {
            if(!confirm('Uruchomić zaawansowany edytor CMR?\n\nBędziesz mógł przesuwać i edytować WSZYSTKIE elementy: linie, napisy, pola, podpisy, czcionki.')) return;
            activateLEMode();
        }
    } else {
        document.getElementById('le-pin-input').value = '';
        document.getElementById('le-pin-modal').style.display = 'flex';
        setTimeout(() => document.getElementById('le-pin-input').focus(), 100);
    }
}

// PIN storage: factory code 1221, changeable in Profile. Three wrong
// attempts lock entry for 5 minutes.
function getPin() { return localStorage.getItem('cmr_pin') || '1221'; }

function pinLockedLeftMs() {
    return Math.max(0, parseInt(localStorage.getItem('cmr_pin_lock') || '0') - Date.now());
}

function verifyPin(val) {
    const left = pinLockedLeftMs();
    if(left > 0) {
        toast('🔒 Zablokowane po 3 błędnych próbach. Spróbuj za ' + Math.ceil(left / 60000) + ' min.', 'error', 4500);
        return false;
    }
    if(val === getPin()) {
        localStorage.removeItem('cmr_pin_tries');
        return true;
    }
    const tries = parseInt(localStorage.getItem('cmr_pin_tries') || '0') + 1;
    if(tries >= 3) {
        localStorage.setItem('cmr_pin_lock', String(Date.now() + 5 * 60 * 1000));
        localStorage.removeItem('cmr_pin_tries');
        toast('🔒 3 błędne próby — wejście zablokowane na 5 minut!', 'error', 5000);
    } else {
        localStorage.setItem('cmr_pin_tries', String(tries));
        toast('Nieprawidłowy kod! Pozostałe próby: ' + (3 - tries), 'error');
    }
    return false;
}

function markLEUnlocked() {
    leUnlocked = true;
    const pl = document.getElementById('le-prof-locked');
    const pu = document.getElementById('le-prof-unlocked');
    if(pl) pl.style.display = 'none';
    if(pu) pu.style.display = 'block';
}

function checkLEPin() {
    const inp = document.getElementById('le-pin-input');
    const ok = verifyPin(inp.value.trim());
    inp.value = '';
    if(!ok) return;
    document.getElementById('le-pin-modal').style.display = 'none';
    markLEUnlocked();
    if(!confirm('Uruchomić zaawansowany edytor CMR?\n\nBędziesz mógł przesuwać i edytować WSZYSTKIE elementy: linie, napisy, pola, podpisy, czcionki.')) return;
    activateLEMode();
}

function unlockLEFromProfile() {
    const inp = document.getElementById('le-prof-pin');
    const ok = verifyPin(inp ? inp.value.trim() : '');
    if(inp) inp.value = '';
    if(!ok) return;
    markLEUnlocked();
    toast('Edytor odblokowany!', 'success');
}

function changePin() {
    if(!leUnlocked) { toast('Najpierw odblokuj edytor', 'error'); return; }
    const inp = document.getElementById('le-new-pin');
    const v = inp ? inp.value.trim() : '';
    if(!/^\d{4}$/.test(v)) { toast('Kod musi mieć dokładnie 4 cyfry', 'error'); return; }
    localStorage.setItem('cmr_pin', v);
    localStorage.removeItem('cmr_pin_tries');
    localStorage.removeItem('cmr_pin_lock');
    if(inp) inp.value = '';
    toast('✅ Nowy kod PIN zapisany!', 'success');
}

function launchLEFromProfile() {
    if(!leUnlocked) { toast('Najpierw odblokuj edytor kodem', 'error'); return; }
    nav('cmr', document.querySelector('.nav-item'));
    if(!confirm('Uruchomić zaawansowany edytor CMR?')) return;
    activateLEMode();
}

// ---- Activate / deactivate ----
function activateLEMode() {
    resetViewZoom();
    leActive = true;
    const page = document.getElementById('cmr-page');
    const bar  = document.getElementById('layout-bar');
    const btn  = document.getElementById('layout-edit-btn');
    page.classList.add('le-mode');
    if(bar) bar.style.display = 'flex';
    if(btn) { btn.textContent = '✅ Wyjdź z edytora'; btn.style.background = '#28a745'; }
    resetLEFilter();
    leZoomBase = getPageScale();
    leZoomFactor = 1;
    ensureLEGuides();
    injectLERHs();
    toast('Edytor aktywny — przyciskami Linie/Napisy/Pola/Podpisy wybierz co edytujesz.', 'info', 5000);
}

function deactivateLEMode() {
    leActive = false;
    deselectLE();
    const page = document.getElementById('cmr-page');
    const bar  = document.getElementById('layout-bar');
    const btn  = document.getElementById('layout-edit-btn');
    page.classList.remove('le-mode');
    if(bar) bar.style.display = 'none';
    if(btn) { btn.textContent = '📐 Edytuj układ pól'; btn.style.background = ''; }
    page.style.transform = '';
    page.style.transformOrigin = '';
    const bm = document.getElementById('box-modal');
    if(bm) bm.style.display = 'none';
    removeLERHs();
    anchorIcons();
    saveFullLayout();
    updateCarrierDisplay();
    toast('Układ zapisany!', 'success');
}

// ---- Tag elements ----
function tagLEElements() {
    let n = 0;
    const page = document.getElementById('cmr-page');
    if(!page) return;
    // quick-pick/geo-btn included so their positions persist after box cascades
    page.querySelectorAll('.line-h, .line-v, .lbl, .num, .cmr-input, .sig-box, .quick-pick, .geo-btn').forEach(el => {
        if(!el.dataset.leId) el.dataset.leId = 'le-' + (++n);
    });
}

// ---- Selection ----
function selectLE(el) {
    if(leSelected && leSelected !== el) leSelected.classList.remove('le-sel');
    leSelected = el;
    el.classList.add('le-sel');
    showLETB(el);
}

function deselectLE() {
    if(leSelected) { leSelected.classList.remove('le-sel'); leSelected = null; }
    hideLETB();
}

// ---- Toolbar ----
function showLETB(el) {
    const tb = document.getElementById('le-tb');
    if(!tb) return;
    tb.style.display = 'block';

    let typeLabel = 'Element';
    if(el.classList.contains('line-h'))     typeLabel = 'Linia pozioma';
    else if(el.classList.contains('line-v'))     typeLabel = 'Linia pionowa';
    else if(el.classList.contains('lbl'))        typeLabel = 'Napis';
    else if(el.classList.contains('num'))        typeLabel = 'Numer pola';
    else if(el.classList.contains('cmr-input'))  typeLabel = 'Pole';
    else if(el.classList.contains('sig-box'))    typeLabel = 'Pole podpisu';
    document.getElementById('le-tb-type').textContent = typeLabel;

    const lid    = el.dataset.leId;
    const locked = lid && leLockedIds.has(lid);
    const lBtn   = document.getElementById('le-lock-btn');
    if(lBtn) {
        lBtn.textContent       = locked ? '🔒 Odblokuj' : '🔓 Zablokuj';
        lBtn.style.background  = locked ? '#dc3545'     : '#6c757d';
    }

    document.getElementById('le-top').value  = (parseFloat(el.style.top)  || 0).toFixed(1);
    document.getElementById('le-left').value = (parseFloat(el.style.left) || 0).toFixed(1);

    const isLineH = el.classList.contains('line-h');
    const isLineV = el.classList.contains('line-v');
    const wRow = document.getElementById('le-w-row');
    const hRow = document.getElementById('le-h-row');
    if(isLineH) {
        if(wRow) wRow.style.display = 'block';
        if(hRow) hRow.style.display = 'none';
        document.getElementById('le-width').value = (parseFloat(el.style.width) || 0).toFixed(1);
    } else if(isLineV) {
        if(wRow) wRow.style.display = 'none';
        if(hRow) hRow.style.display = 'block';
        document.getElementById('le-height').value = (parseFloat(el.style.height) || 0).toFixed(1);
    } else {
        if(wRow) wRow.style.display = 'block';
        if(hRow) hRow.style.display = 'block';
        document.getElementById('le-width').value  = (parseFloat(el.style.width)  || 0).toFixed(1);
        document.getElementById('le-height').value = (parseFloat(el.style.height) || 0).toFixed(1);
    }

    const hasFont = el.classList.contains('lbl') || el.classList.contains('num') || el.classList.contains('cmr-input');
    const fontRow = document.getElementById('le-font-row');
    if(fontRow) {
        fontRow.style.display = hasFont ? 'flex' : 'none';
        if(hasFont) {
            document.getElementById('le-font-val').textContent = getFontSizePt(el).toFixed(1);
            updateLEStyleBtns(el);
        }
    }

    const isInput = el.classList.contains('cmr-input');
    const hasText = el.classList.contains('lbl') || el.classList.contains('num') || isInput;
    const textRow = document.getElementById('le-text-row');
    if(textRow) {
        textRow.style.display = hasText ? 'block' : 'none';
        if(hasText) document.getElementById('le-text').value = isInput ? el.value : el.innerText;
    }
}

function hideLETB() {
    const tb = document.getElementById('le-tb');
    if(tb) tb.style.display = 'none';
}

// ---- Toolbar apply ----
function applyLETBPos() {
    if(!leSelected) return;
    const el   = leSelected;
    const top  = parseFloat(document.getElementById('le-top').value)  || 0;
    const left = parseFloat(document.getElementById('le-left').value) || 0;
    el.style.top  = top.toFixed(1)  + 'mm';
    el.style.left = left.toFixed(1) + 'mm';
    const isLineH = el.classList.contains('line-h');
    const isLineV = el.classList.contains('line-v');
    if(!isLineV) {
        const w = parseFloat(document.getElementById('le-width').value) || 0;
        el.style.width = w.toFixed(1) + 'mm';
    }
    if(!isLineH) {
        const h = parseFloat(document.getElementById('le-height').value) || 0;
        el.style.height = h.toFixed(1) + 'mm';
    }
    updateLERHPos(el);
    saveFullLayout();
}

function applyLEText() {
    if(!leSelected) return;
    const txt = document.getElementById('le-text').value;
    if(leSelected.classList.contains('cmr-input')) {
        leSelected.value = txt;
        if(leSelected.id === 'inp_carrier') updateCarrierDisplay();
        if(typeof scheduleDraftSave === 'function') scheduleDraftSave();
    } else {
        leSelected.innerText = txt;
        saveFullLayout();
    }
}

function getFontSizePt(el) {
    let fs = el.style.fontSize || getComputedStyle(el).fontSize || '8px';
    const v = parseFloat(fs);
    if(fs.endsWith('pt')) return v;
    if(fs.endsWith('px')) return v * 72 / 96;
    return v;
}

function changeLEFont(delta) {
    if(!leSelected) return;
    const el   = leSelected;
    const next = Math.max(4, Math.min(36, getFontSizePt(el) + delta));
    el.style.fontSize = next.toFixed(1) + 'pt';
    document.getElementById('le-font-val').textContent = next.toFixed(1);
    saveFullLayout();
}

function toggleLEBold() {
    if(!leSelected) return;
    const isBold = parseInt(getComputedStyle(leSelected).fontWeight) >= 600;
    leSelected.style.fontWeight = isBold ? 'normal' : 'bold';
    updateLEStyleBtns(leSelected);
    saveFullLayout();
}

function toggleLEItalic() {
    if(!leSelected) return;
    const isItalic = getComputedStyle(leSelected).fontStyle === 'italic';
    leSelected.style.fontStyle = isItalic ? 'normal' : 'italic';
    updateLEStyleBtns(leSelected);
    saveFullLayout();
}

function updateLEStyleBtns(el) {
    const cs = getComputedStyle(el);
    const bb = document.getElementById('le-bold-btn');
    const ib = document.getElementById('le-italic-btn');
    if(bb) bb.style.background = parseInt(cs.fontWeight) >= 600 ? '#0056b3' : '#6c757d';
    if(ib) ib.style.background = cs.fontStyle === 'italic'      ? '#0056b3' : '#6c757d';
    const al = cs.textAlign;
    [['le-al-left','left'], ['le-al-center','center'], ['le-al-right','right']].forEach(([id, v]) => {
        const b = document.getElementById(id);
        if(b) b.style.background = (al === v || (v === 'left' && (al === 'start' || al === ''))) ? '#0056b3' : '#6c757d';
    });
}

function setLEAlign(a) {
    if(!leSelected) return;
    leSelected.style.textAlign = a;
    updateLEStyleBtns(leSelected);
    saveFullLayout();
}

function toggleLELock() {
    if(!leSelected) return;
    const lid = leSelected.dataset.leId;
    if(!lid) return;
    if(leLockedIds.has(lid)) {
        leLockedIds.delete(lid);
        leSelected.classList.remove('le-locked');
        const lBtn = document.getElementById('le-lock-btn');
        if(lBtn) { lBtn.textContent = '🔓 Zablokuj'; lBtn.style.background = '#6c757d'; }
    } else {
        leLockedIds.add(lid);
        leSelected.classList.add('le-locked');
        const lBtn = document.getElementById('le-lock-btn');
        if(lBtn) { lBtn.textContent = '🔒 Odblokuj'; lBtn.style.background = '#dc3545'; }
    }
    saveFullLayout();
}

// ---- Category filters ----
let leFilter = {lines: true, labels: true, inputs: true, sigs: true};

function toggleLEFilter(cat, btn) {
    leFilter[cat] = !leFilter[cat];
    if(btn) btn.classList.toggle('off', !leFilter[cat]);
    applyLEFilterClasses();
    deselectLE();
    if(leActive) injectLERHs();
}

function applyLEFilterClasses() {
    const page = document.getElementById('cmr-page');
    if(!page) return;
    page.classList.toggle('le-hide-lines',  !leFilter.lines);
    page.classList.toggle('le-hide-labels', !leFilter.labels);
    page.classList.toggle('le-hide-inputs', !leFilter.inputs);
    page.classList.toggle('le-hide-sigs',   !leFilter.sigs);
}

function resetLEFilter() {
    leFilter = {lines: true, labels: true, inputs: true, sigs: true};
    ['le-f-lines','le-f-labels','le-f-inputs','le-f-sigs'].forEach(id => {
        const b = document.getElementById(id);
        if(b) b.classList.remove('off');
    });
    applyLEFilterClasses();
}

// ---- Resize handles ----
function injectLERHs() {
    removeLERHs();
    const page = document.getElementById('cmr-page');
    const sel = [];
    if(leFilter.lines)  sel.push('.line-h', '.line-v');
    if(leFilter.labels) sel.push('.lbl');
    if(leFilter.inputs) sel.push('.cmr-input');
    if(leFilter.sigs)   sel.push('.sig-box');
    if(!sel.length) return;
    page.querySelectorAll(sel.join(', ')).forEach(el => {
        if(el.style.display === 'none') return;
        const rh = document.createElement('div');
        rh.className = 'le-rh';
        updateLERHPos(el, rh);
        rh.addEventListener('touchstart', (e) => {
            e.stopPropagation(); e.preventDefault();
            selectLE(el);
            startLEDrag(e, el, 'resize');
        }, {passive: false});
        rh.addEventListener('mousedown', (e) => {
            e.stopPropagation(); e.preventDefault();
            selectLE(el);
            startLEDrag(e, el, 'resize');
        });
        page.appendChild(rh);
        leRHs.push({rh, el});
    });
}

function removeLERHs() {
    leRHs.forEach(({rh}) => rh.remove());
    leRHs = [];
}

function updateLERHPos(el, rh) {
    if(!rh) {
        const entry = leRHs.find(r => r.el === el);
        if(entry) rh = entry.rh; else return;
    }
    const t = parseFloat(el.style.top)    || 0;
    const l = parseFloat(el.style.left)   || 0;
    const w = parseFloat(el.style.width)  || 20;
    const h = parseFloat(el.style.height) || 10;
    rh.style.top  = (t + h - 2.5) + 'mm';
    rh.style.left = (l + w - 2.5) + 'mm';
}

// ---- Drag ----
function startLEDrag(e, el, type) {
    const lid = el.dataset.leId;
    if(lid && leLockedIds.has(lid)) { toast('Element zablokowany', 'info', 1500); return; }
    const t = e.touches ? e.touches[0] : e;
    leDrag = {
        el, type,
        x0: t.clientX, y0: t.clientY,
        top0:    parseFloat(el.style.top)    || 0,
        left0:   parseFloat(el.style.left)   || 0,
        width0:  parseFloat(el.style.width)  || 20,
        height0: parseFloat(el.style.height) || 10,
        scale:   getPageScale(),
        isLineH: el.classList.contains('line-h'),
        isLineV: el.classList.contains('line-v')
    };
    if(type === 'move') {
        // snap targets: edges of every other element, for green alignment guides
        const tops = [], lefts = [];
        document.querySelectorAll('#cmr-page [data-le-id]').forEach(o => {
            if(o === el) return;
            if(o.style.top)  tops.push(parseFloat(o.style.top));
            if(o.style.left) lefts.push(parseFloat(o.style.left));
        });
        leDrag.snapTops = tops;
        leDrag.snapLefts = lefts;
    }
}

function onLEMove(e) {
    if(!leDrag || !leActive) return;
    e.preventDefault();
    const t    = e.touches ? e.touches[0] : e;
    const toMm = 1 / (leDrag.scale * CSS_PX_MM);
    const dx   = (t.clientX - leDrag.x0) * toMm;
    const dy   = (t.clientY - leDrag.y0) * toMm;
    const d    = leDrag;
    if(d.type === 'move') {
        let nt = d.top0 + dy, nl = d.left0 + dx;
        let st = null, sl = null;
        if(d.snapTops)  { for(const v of d.snapTops)  if(Math.abs(nt - v) <= 0.7) { st = v; break; } }
        if(d.snapLefts) { for(const v of d.snapLefts) if(Math.abs(nl - v) <= 0.7) { sl = v; break; } }
        if(st !== null) nt = st;
        if(sl !== null) nl = sl;
        d.el.style.top  = nt.toFixed(1) + 'mm';
        d.el.style.left = nl.toFixed(1) + 'mm';
        const gh = document.getElementById('le-guide-h'), gv = document.getElementById('le-guide-v');
        if(gh) { gh.style.display = st !== null ? 'block' : 'none'; if(st !== null) gh.style.top  = st + 'mm'; }
        if(gv) { gv.style.display = sl !== null ? 'block' : 'none'; if(sl !== null) gv.style.left = sl + 'mm'; }
    } else {
        if(!d.isLineV) d.el.style.width  = Math.max(5, d.width0  + dx).toFixed(1) + 'mm';
        if(!d.isLineH) d.el.style.height = Math.max(2, d.height0 + dy).toFixed(1) + 'mm';
    }
    updateLERHPos(d.el);
    if(leSelected === d.el) {
        document.getElementById('le-top').value  = (parseFloat(d.el.style.top)  || 0).toFixed(1);
        document.getElementById('le-left').value = (parseFloat(d.el.style.left) || 0).toFixed(1);
        if(!d.isLineV && document.getElementById('le-width'))  document.getElementById('le-width').value  = (parseFloat(d.el.style.width)  || 0).toFixed(1);
        if(!d.isLineH && document.getElementById('le-height')) document.getElementById('le-height').value = (parseFloat(d.el.style.height) || 0).toFixed(1);
    }
}

function onLEEnd() {
    if(leDrag) {
        leDrag = null;
        const gh = document.getElementById('le-guide-h'), gv = document.getElementById('le-guide-v');
        if(gh) gh.style.display = 'none';
        if(gv) gv.style.display = 'none';
        if(leActive) saveFullLayout();
    }
}

// ---- Editor zoom ----
let leZoomBase = 1, leZoomFactor = 1;

function setLEZoom(f) {
    if(!leActive) return;
    const page = document.getElementById('cmr-page');
    leZoomFactor = (f === 0) ? 1 : Math.min(4, Math.max(0.4, leZoomFactor * f));
    page.style.transformOrigin = 'top left';
    page.style.transform = 'scale(' + (leZoomBase * leZoomFactor).toFixed(3) + ')';
}

// ---- Alignment guides ----
function ensureLEGuides() {
    const page = document.getElementById('cmr-page');
    if(document.getElementById('le-guide-h')) return;
    const gh = document.createElement('div');
    gh.id = 'le-guide-h'; gh.className = 'le-guide';
    gh.style.left = '0'; gh.style.width = '210mm'; gh.style.height = '0.4mm';
    page.appendChild(gh);
    const gv = document.createElement('div');
    gv.id = 'le-guide-v'; gv.className = 'le-guide';
    gv.style.top = '0'; gv.style.height = '296mm'; gv.style.width = '0.4mm';
    page.appendChild(gv);
}

// ---- Box dimensions (rubryki) — enter real printed mm, borders adapt ----
const CMR_BOXES = [
    {name:'1 · Nadawca',               zone:'L', top:15,         bottom:'ln-l57',  left:8,         right:'lv-mid'},
    {name:'4 · Odbiorca',              zone:'L', top:'ln-l57',   bottom:'ln-l87',  left:8,         right:'lv-mid'},
    {name:'6 · Miejsce załadunku',     zone:'L', top:'ln-l87',   bottom:'ln-l103', left:8,         right:'lv-mid'},
    {name:'8 · Miejsce dostawy',       zone:'L', top:'ln-l103',  bottom:'ln-l122', left:8,         right:'lv-mid'},
    {name:'2 · Customs Reference',     zone:'R', top:15,         bottom:'ln-r38',  left:'lv-mid',  right:202},
    {name:'3 · Senders Reference',     zone:'R', top:'ln-r38',   bottom:'ln-r57',  left:'lv-mid',  right:202},
    {name:'5 · Przewoźnik (Nolan)',    zone:'R', top:'ln-r57',   bottom:'ln-r87',  left:'lv-mid',  right:202},
    {name:'9 · Towar (opis)',          zone:'F', top:'ln-l122',  bottom:'ln-195',  left:8,         right:'lv-g1'},
    {name:'10 · Waga (kolumna)',       zone:'F', top:'ln-r122',  bottom:'ln-r215', left:'lv-g1',   right:'lv-g2'},
    {name:'11 · Objętość (kolumna)',   zone:'F', top:'ln-r122',  bottom:'ln-r215', left:'lv-g2',   right:202},
    {name:'Palety — wiersz górny',     zone:'F', top:'ln-195',   bottom:'ln-205',  left:8,         right:155},
    {name:'Palety — wiersz dolny',     zone:'F', top:'ln-205',   bottom:'ln-l215', left:8,         right:155},
    {name:'12 · Carriage Charges',     zone:'F', top:'ln-l215',  bottom:'ln-l230', left:8,         right:'lv-1213'},
    {name:'13 · Senders Instructions', zone:'F', top:'ln-r215',  bottom:'ln-r230', left:'lv-1213', right:202},
    {name:'14 · Reservations',         zone:'F', top:'ln-l230',  bottom:'ln-s260a',left:8,         right:'lv-1415'},
    {name:'15/16 · Documents / Temp',  zone:'F', top:'ln-r230',  bottom:'ln-s260b',left:'lv-1415', right:202},
    {name:'17 · Goods Received',       zone:'F', top:'ln-s260a', bottom:null,      left:8,         right:'lv-sig1'},
    {name:'18 · Podpis przewoźnika',   zone:'F', top:'ln-s260b', bottom:null,      left:'lv-sig1', right:'lv-sig2'},
    {name:'19 · Company',              zone:'F', top:'ln-s260c', bottom:null,      left:'lv-sig2', right:202}
];

function boxRef(v, prop) {
    if(typeof v === 'number') return v;
    const el = document.getElementById(v);
    return el ? (parseFloat(el.style[prop]) || 0) : 0;
}

function elMm(el) {
    return {
        t: parseFloat(el.style.top)  || 0,
        l: parseFloat(el.style.left) || 0,
        w: el.style.width  ? parseFloat(el.style.width)  : (el.offsetWidth  / CSS_PX_MM),
        h: el.style.height ? parseFloat(el.style.height) : (el.offsetHeight / CSS_PX_MM)
    };
}

function boxChildren() {
    return [...document.getElementById('cmr-page').children].filter(el =>
        el.style && el.style.top &&
        !el.classList.contains('le-rh') && !el.classList.contains('le-guide'));
}

// Height: move the box's bottom border and shift everything below it in the
// same column (or the whole page below 122mm) by the same amount. The zone
// end (122mm line / page frame) never moves — the last box absorbs changes.
function applyBoxHeight(box, newH) {
    if(!box.bottom) return;
    const bLine = document.getElementById(box.bottom);
    if(!bLine) return;
    const topY = boxRef(box.top, 'top');
    const oldB = parseFloat(bLine.style.top) || 0;
    const dy   = (topY + newH) - oldB;
    if(Math.abs(dy) < 0.05) return;
    let zoneEnd = 290;
    if(box.zone === 'L') zoneEnd = boxRef('ln-l122', 'top');
    if(box.zone === 'R') zoneEnd = boxRef('ln-r122', 'top');
    const midX = boxRef('lv-mid', 'left');
    bLine.style.top = (oldB + dy).toFixed(1) + 'mm';
    boxChildren().forEach(el => {
        if(el === bLine) return;
        const g = elMm(el);
        const cx = g.l + g.w / 2;
        if(box.zone === 'L' && cx > midX - 0.3) return;
        if(box.zone === 'R' && cx < midX + 0.3) return;
        if(el.classList.contains('line-v') && g.t < oldB - 0.25) {
            // vertical line crossing (or ending at) the moved border: its
            // bottom end sits in the shifted region, so it stretches
            const eb = g.t + g.h;
            if(eb > oldB - 0.6 && eb < zoneEnd - 0.3) el.style.height = (g.h + dy).toFixed(1) + 'mm';
            return;
        }
        if(g.t < oldB - 0.25 || g.t > zoneEnd - 0.3) return;
        el.style.top = (g.t + dy).toFixed(1) + 'mm';
    });
}

// Width: move the box's divider line; everything on the far side shifts,
// border segments touching the divider stretch or shrink to follow.
function applyBoxWidth(box, newW) {
    let vId = null, newX = 0;
    if(typeof box.right === 'string')     { vId = box.right; newX = boxRef(box.left, 'left') + newW; }
    else if(typeof box.left === 'string') { vId = box.left;  newX = boxRef(box.right, 'left') - newW; }
    else return;
    const vLine = document.getElementById(vId);
    if(!vLine) return;
    const oldX = parseFloat(vLine.style.left) || 0;
    const dx = newX - oldX;
    if(Math.abs(dx) < 0.05) return;
    const vg = elMm(vLine);
    const spanTop = vg.t, spanBot = vg.t + vg.h;
    vLine.style.left = newX.toFixed(1) + 'mm';
    boxChildren().forEach(el => {
        if(el === vLine) return;
        const g = elMm(el);
        if(g.t + g.h < spanTop + 0.3 || g.t > spanBot - 0.3) return;
        if(el.classList.contains('line-h')) {
            if(Math.abs(g.l + g.w - oldX) < 0.6) {
                el.style.width = (g.w + dx).toFixed(1) + 'mm';
            } else if(Math.abs(g.l - oldX) < 0.6) {
                el.style.left  = newX.toFixed(1) + 'mm';
                el.style.width = (g.w - dx).toFixed(1) + 'mm';
            }
            return;
        }
        if(el.classList.contains('line-v')) {
            if(Math.abs(g.l - oldX) < 0.5) el.style.left = newX.toFixed(1) + 'mm';
            return;
        }
        if(g.l + g.w / 2 > oldX + 0.3) el.style.left = (g.l + dx).toFixed(1) + 'mm';
    });
}

function openBoxModal() {
    renderBoxModal();
    document.getElementById('box-modal').style.display = 'flex';
}

function renderBoxModal() {
    const list = document.getElementById('box-modal-list');
    list.innerHTML = '';
    CMR_BOXES.forEach((b, i) => {
        const w = boxRef(b.right, 'left') - boxRef(b.left, 'left');
        const h = b.bottom ? (boxRef(b.bottom, 'top') - boxRef(b.top, 'top')) : null;
        const wEdit = (typeof b.left === 'string' || typeof b.right === 'string');
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:7px 2px; border-bottom:1px solid #eee;';
        row.innerHTML =
            `<span style="flex:1; font-size:12px; color:#333;">${b.name}</span>` +
            `<input type="number" step="0.5" class="box-dim-in" id="bx-w-${i}" value="${w.toFixed(1)}"${wEdit ? '' : ' disabled'} title="Szerokość (mm)">` +
            `<span style="color:#999; font-size:11px;">×</span>` +
            `<input type="number" step="0.5" class="box-dim-in" id="bx-h-${i}" value="${h !== null ? h.toFixed(1) : ''}"${h !== null ? '' : ' disabled'} title="Wysokość (mm)">` +
            `<button class="le-sm-btn" style="background:#28a745;" onclick="applyBoxRow(${i})">✔</button>`;
        list.appendChild(row);
    });
}

function applyBoxRow(i) {
    const b = CMR_BOXES[i];
    const wIn = document.getElementById('bx-w-' + i);
    const hIn = document.getElementById('bx-h-' + i);
    const W = parseFloat(wIn.value);
    const H = parseFloat(hIn.value);
    if(!wIn.disabled && W >= 5)  applyBoxWidth(b, W);
    if(!hIn.disabled && H >= 4)  applyBoxHeight(b, H);
    updateCarrierDisplay();
    anchorIcons();
    if(leActive) injectLERHs();
    saveFullLayout();
    renderBoxModal();
    toast('✅ Rubryka dopasowana', 'success', 1500);
}

// ---- Remote layout sync (layout.json in the GitHub repo) ----
// The official layout lives in layout.json next to index.html. On every
// start the app checks it; a newer rev replaces the device's local layout,
// so an update pushed to GitHub reaches every phone automatically.
async function syncRemoteLayout() {
    try {
        const res = await fetch('layout.json?v=' + Date.now(), { cache: 'no-store' });
        if(!res.ok) return;
        const remote = await res.json();
        if(!remote || !remote.rev || !remote.layout) return;
        const baseRev = parseInt(localStorage.getItem('cmr_layout_baserev') || '0');
        if(remote.rev <= baseRev) return;
        const cur = localStorage.getItem('cmr_layout');
        if(cur) localStorage.setItem('cmr_layout_prev', cur);
        localStorage.setItem('cmr_layout', JSON.stringify(remote.layout));
        localStorage.setItem('cmr_layout_baserev', String(remote.rev));
        location.reload();
    } catch(e) { /* offline — keep the local layout */ }
}

function exportLayoutFile() {
    const raw = localStorage.getItem('cmr_layout');
    if(!raw) { toast('Brak zapisanego układu — najpierw zmień coś w edytorze', 'error', 4000); return; }
    let layout;
    try { layout = JSON.parse(raw); } catch(e) { toast('Błąd odczytu układu', 'error'); return; }
    const data = { rev: Date.now(), layout };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'layout.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('⬆️ Wgraj layout.json do repozytorium GitHub (Add file → Upload) — telefony zaktualizują się same', 'info', 7000);
}

// ---- Save / load / reset ----
// Bump when CMR element structure changes — old saved layouts map le-ids
// to different elements and would scramble the form.
const LE_LAYOUT_VER = 5;

function saveFullLayout() {
    // while the scan backdrop is on, edits belong to the overlay layout —
    // the default layout must stay untouched
    if(overlayMode) { saveOverlayLayout(); return; }
    const page = document.getElementById('cmr-page');
    if(!page) return;
    const positions = {}, fonts = {}, weights = {}, italics = {}, aligns = {}, texts = {}, customs = [];
    page.querySelectorAll('[data-le-id]').forEach(el => {
        const id = el.dataset.leId;
        positions[id] = {
            top:    el.style.top    || '',
            left:   el.style.left   || '',
            width:  el.style.width  || '',
            height: el.style.height || ''
        };
        if(el.style.fontSize)   fonts[id]   = el.style.fontSize;
        if(el.style.fontWeight) weights[id] = el.style.fontWeight;
        if(el.style.fontStyle)  italics[id] = el.style.fontStyle;
        if(el.style.textAlign)  aligns[id]  = el.style.textAlign;
        if(el.classList.contains('lbl') || el.classList.contains('num')) texts[id] = el.innerText;
        if(el.dataset.leCustom) customs.push({id, type: el.dataset.leCustom});
    });
    localStorage.setItem('cmr_layout', JSON.stringify({
        ver: LE_LAYOUT_VER, positions, fonts, weights, italics, aligns, texts,
        customs, hidden: [...leHiddenIds], locked: [...leLockedIds]
    }));
}

function loadFullLayout() {
    const raw = localStorage.getItem('cmr_layout');
    if(!raw) return;
    try {
        const data = JSON.parse(raw);
        if(data.ver !== LE_LAYOUT_VER) {
            // NEVER delete the user's work — archive the incompatible layout
            // so it can be migrated or inspected later
            localStorage.setItem('cmr_layout_archived_v' + (data.ver || 0), raw);
            localStorage.removeItem('cmr_layout');
            toast('⚠️ Układ z poprzedniej wersji aplikacji zarchiwizowano — ustaw go ponownie i pobierz Backup w Profilu', 'info', 7000);
            return;
        }
        const {positions={}, fonts={}, weights={}, italics={}, aligns={}, texts={}, customs=[], hidden=[], locked=[]} = data;
        leLockedIds = new Set(locked);
        leHiddenIds = new Set(hidden);
        const page = document.getElementById('cmr-page');
        if(!page) return;
        // re-create user-added lines before applying geometry
        customs.forEach(c => {
            const p = positions[c.id] || {};
            addLELine(c.type, c.id, p);
        });
        page.querySelectorAll('[data-le-id]').forEach(el => {
            const id = el.dataset.leId;
            const p  = positions[id];
            if(p) {
                if(p.top)    el.style.top    = p.top;
                if(p.left)   el.style.left   = p.left;
                if(p.width)  el.style.width  = p.width;
                if(p.height) el.style.height = p.height;
            }
            if(fonts[id])   el.style.fontSize   = fonts[id];
            if(weights[id]) el.style.fontWeight = weights[id];
            if(italics[id]) el.style.fontStyle  = italics[id];
            if(aligns[id])  el.style.textAlign  = aligns[id];
            if(texts[id] !== undefined && (el.classList.contains('lbl') || el.classList.contains('num'))) {
                el.innerText = texts[id];
            }
            if(leHiddenIds.has(id)) el.style.display = 'none';
            if(leLockedIds.has(id)) el.classList.add('le-locked');
        });
    } catch(e) { console.error('Layout load error:', e); }
}

function resetFullLayout() {
    if(!confirm('Przywrócić domyślny układ wszystkich elementów CMR?\n\nWszystkie ręczne zmiany układu, czcionek i napisów zostaną usunięte.')) return;
    localStorage.removeItem('cmr_layout');
    if(leActive) {
        leActive = false;
        const page = document.getElementById('cmr-page');
        const bar  = document.getElementById('layout-bar');
        const btn  = document.getElementById('layout-edit-btn');
        if(page) page.classList.remove('le-mode');
        if(bar)  bar.style.display = 'none';
        if(btn)  { btn.textContent = '📐 Edytuj układ pól'; btn.style.background = ''; }
        removeLERHs();
    }
    location.reload();
}

// ---- Init event handlers ----
function attachLEHandlers(el) {
    const onDown = (e) => {
        if(!leActive) return;
        if(e.target.tagName === 'BUTTON' || e.target.tagName === 'CANVAS') return;
        e.preventDefault();
        selectLE(el);
        const lid = el.dataset.leId;
        if(!(lid && leLockedIds.has(lid))) startLEDrag(e, el, 'move');
    };
    el.addEventListener('touchstart', onDown, {passive: false});
    el.addEventListener('mousedown', onDown);
}

function initLEHandlers() {
    document.addEventListener('touchmove', onLEMove, {passive: false});
    document.addEventListener('mousemove', onLEMove);
    document.addEventListener('touchend',  onLEEnd);
    document.addEventListener('mouseup',   onLEEnd);

    const page = document.getElementById('cmr-page');
    if(!page) return;
    page.querySelectorAll('.line-h, .line-v, .lbl, .num, .cmr-input, .sig-box').forEach(attachLEHandlers);
}

// ---- Custom lines (add) and element removal ----
let leCustomN = 0;

function addLELine(type, id, geom) {
    const page = document.getElementById('cmr-page');
    const el = document.createElement('div');
    el.className = type === 'h' ? 'line-h' : 'line-v';
    el.dataset.leCustom = type;
    el.dataset.leId = id || ('cu-' + (++leCustomN));
    if(!id) {
        if(type === 'h') { el.style.top = '150mm'; el.style.left = '60mm'; el.style.width = '60mm'; }
        else             { el.style.top = '130mm'; el.style.left = '100mm'; el.style.height = '40mm'; }
    } else {
        const n = parseInt(id.slice(3));
        if(n > leCustomN) leCustomN = n;
        if(geom) { el.style.top = geom.top; el.style.left = geom.left; if(geom.width) el.style.width = geom.width; if(geom.height) el.style.height = geom.height; }
    }
    page.appendChild(el);
    attachLEHandlers(el);
    if(!id) {
        if(leActive) injectLERHs();
        selectLE(el);
        saveFullLayout();
        toast('Linia dodana — przeciągnij ją na miejsce', 'success');
    }
    return el;
}

function deleteLE() {
    if(!leSelected) return;
    const el = leSelected;
    if(el.dataset.leCustom) {
        deselectLE();
        el.remove();
    } else {
        if(!confirm('Usunąć ten element z CMR?\n\n(Przywrócisz go przyciskiem "Reset układu")')) return;
        leHiddenIds.add(el.dataset.leId);
        deselectLE();
        el.style.display = 'none';
    }
    if(leActive) injectLERHs();
    saveFullLayout();
    toast('Element usunięty', 'info');
}

let scaleUpdateTimeout = null;
let flyTimeout = null
let userLocation = null;
let userMarker = null;
let lastEventLink = null;
let latestEarthquakeId = null;
let flying = false;
const CACHE_TTL = 60000;

const panel = document.getElementById('controls');
const burgerMenuBtn = document.getElementById('burgerMenuBtn');
const menuOverlay = document.getElementById('menuOverlay');

// Burger menu toggle
burgerMenuBtn.addEventListener('click', function () {
    panel.classList.toggle('active');
    burgerMenuBtn.classList.toggle('active');
    menuOverlay.classList.toggle('active');
});

// Close menu when clicking overlay
menuOverlay.addEventListener('click', function () {
    panel.classList.remove('active');
    burgerMenuBtn.classList.remove('active');
    menuOverlay.classList.remove('active');
});

// Close menu when clicking outside on desktop
document.addEventListener('click', function (e) {
    if (!panel.contains(e.target) && !burgerMenuBtn.contains(e.target)) {
        if (window.innerWidth > 768) {
            panel.classList.remove('active');
            burgerMenuBtn.classList.remove('active');
            menuOverlay.classList.remove('active');
        }
    }
});

// Close menu on window resize
window.addEventListener('resize', function () {
    if (window.innerWidth > 768) {
        panel.classList.remove('active');
        burgerMenuBtn.classList.remove('active');
        menuOverlay.classList.remove('active');
    }
});

/* Notification system */
const notificationBell = document.getElementById('notificationBell');
const notificationPanel = document.getElementById('notificationPanel');
const notificationPanelClose = document.getElementById('notificationPanelClose');
const notificationPanelContent = document.getElementById('notificationPanelContent');
const notificationBadge = document.getElementById('notificationBadge');
let notifications = [];

notificationBell.addEventListener('click', () => {
    notificationPanel.classList.toggle('active');
});

notificationPanelClose.addEventListener('click', () => {
    notificationPanel.classList.remove('active');
});

// Close notification panel when clicking outside
document.addEventListener('click', (e) => {
    if (!notificationPanel.contains(e.target) && !notificationBell.contains(e.target)) {
        notificationPanel.classList.remove('active');
    }
});

function addNotification(title, message, isAlert = false, time = null) {
    const notification = {
        id: Date.now(),
        title,
        message,
        isAlert,
        time: time || new Date().toLocaleTimeString()
    };

    notifications.unshift(notification);
    if (notifications.length > 10) notifications.pop();

    updateNotificationUI();
}

function updateNotificationUI() {
    if (notifications.length === 0) {
        notificationPanelContent.innerHTML = '<div class="notification-panel-empty">No notifications yet</div>';
        notificationBadge.style.display = 'none';
    } else {
        notificationBadge.textContent = notifications.length;
        notificationBadge.style.display = 'flex';

        notificationPanelContent.innerHTML = notifications.map(notif => `
          <div class="notification-item ${notif.isAlert ? 'alert' : ''}">
            <div class="notification-item-title">${notif.title}</div>
            <div>${notif.message}</div>
            <div class="notification-item-time">${notif.time}</div>
          </div>
        `).join('');
    }
}

/************************************************************************
 * AUDIO SETUP
 ************************************************************************/
let audioUnlocked = false;
const quakeSound = document.getElementById("quakeSound");
const quakeNearby = document.getElementById("quakeNearbySound");
const alarmSound = document.getElementById("alarmSound");

// Unlock audio on first user gesture
function unlockAudio() {
    if (audioUnlocked) return;

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") {
        ctx.resume().then(() => {
            audioUnlocked = true;
            console.log("Audio unlocked via AudioContext");
        }).catch(console.warn);
    } else {
        audioUnlocked = true;
        console.log("Audio unlocked");
    }
}

function playQuakeSound(isNearby = false, magnitude = 0) {
    if (!audioUnlocked) return;

    // If within 100km AND magnitude >= 5.0, play alarm
    if (isNearby && magnitude >= 5.0) {
        alarmSound.currentTime = 0;
        alarmSound.play().catch(err => console.warn("Alarm play failed:", err));
    } else {
        // Otherwise play regular quake sound
        const audio = isNearby ? quakeNearby : quakeSound;
        audio.currentTime = 0;
        audio.play().catch(err => console.warn("Audio play failed:", err));
    }
}

/************************************************************************
 * CONFIG
 ************************************************************************/
const CONFIG = {
    API_ENDPOINT: "https://earthquakeapi.vercel.app/api/earthquakes",
    DEFAULT_POLL_MS: 15000,
};
let currentSource = "phivolcs";


let circleScale = 0.2;
let currentRange = { start: null, end: null };
const markers = new Map();
let latestMarker = null;
let pollHandle = null;
let currentNotificationId = null;

document.getElementById("sourceSelector").addEventListener("change", function (e) {
    currentSource = e.target.value;
    markers.forEach(({ layer }) => map.removeLayer(layer));
    markers.clear();
    fetchNewEvents();
});

function getCoverageDistance(mag) {
    if (mag < 2) return "up to 5 miles";
    if (mag < 3) return "5–10 miles";
    if (mag < 4) return "10–25 miles";
    if (mag < 5) return "25–50 miles";
    if (mag < 6) return "50–100 miles";
    if (mag < 7) return "100–200 miles";
    if (mag < 8) return "200–400 miles";
    return "400–600 miles or more";
}


/************************************************************************
 * MAP
 ************************************************************************/
const map = L.map("map").setView([12.879721, 121.774017], 6);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "© OpenStreetMap contributors",
}).addTo(map);
map.on("zoomend", updateCircleScaleByZoom);

/************************************************************************
* MASTER VOLUME CONTROL (affects all quake sounds)
************************************************************************/
const masterVolumeSlider = document.getElementById("masterVolume");
const savedMasterVolume = parseFloat(localStorage.getItem("quakeMasterVolume"));

// Set initial volume (default 0.8)
const masterVolume = !isNaN(savedMasterVolume) ? savedMasterVolume : 0.8;
quakeSound.volume = masterVolume;
quakeNearby.volume = masterVolume;
alarmSound.volume = masterVolume;
masterVolumeSlider.value = masterVolume;

// Update all volumes when slider changes
masterVolumeSlider.addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    quakeSound.volume = v;
    quakeNearby.volume = v;
    alarmSound.volume = v;
    localStorage.setItem("quakeMasterVolume", v);
});

/************************************************************************
* REAL PHIVOLCS SHAKEMAP LAYER (auto-clears & loads latest)
************************************************************************/
let currentShakeMapLayer = null;

async function addRealShakeMapLayer() {
    try {
        // Remove previous
        if (currentShakeMapLayer) {
            map.removeLayer(currentShakeMapLayer);
            currentShakeMapLayer = null;
        }

        // Fetch list of available shakemap services
        const res = await fetch("");
        const data = await res.json();

        if (!data.services || data.services.length === 0) {
            console.warn("⚠️ No shakemap services found.");
            return;
        }

        // Get the latest one (usually the last item)
        const latestService = data.services[data.services.length - 1];
        const latestUrl = ``;

        // Add it as a dynamic layer
        currentShakeMapLayer = L.esri.dynamicMapLayer({
            url: latestUrl,
            opacity: 0.65,
            useCors: true
        }).addTo(map);

        console.log("✅ Real PHIVOLCS shakemap loaded:", latestService.name);
    } catch (err) {
        console.error("❌ Error loading real PHIVOLCS shakemap:", err);
    }
}


/************************************************************************
 * HELPERS
 ************************************************************************/
function normalizeEvent(raw) {
    return {
        id: String(raw.id ?? raw.time + "_" + raw.lat + "_" + raw.lon),
        lat: raw.lat,
        lon: raw.lon,
        magnitude: raw.magnitude ?? 0,
        depth: raw.depth ?? null,
        time: raw.time ?? null,
        location: raw.location ?? "",
        link: raw.link ?? null,
    };
}


function magToRadius(mag) { return Math.max(3, 3 + mag * 3 * circleScale); }
function magToColor(mag) {
    if (mag >= 7) return "#800026";
    if (mag >= 6) return "#BD0026";
    if (mag >= 5) return "#E31A1C";
    if (mag >= 4) return "#FC4E2A";
    if (mag >= 3) return "#FD8D3C";
    return "#FEB24C";
}

function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDateTime(dt) {
    if (!dt) return "";
    const date = new Date(dt);
    if (isNaN(date)) return dt;

    const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    const m = months[date.getMonth()];
    const d = String(date.getDate()).padStart(2, "0");
    const y = date.getFullYear();

    let hour = date.getHours();
    const minute = String(date.getMinutes()).padStart(2, "0");
    const ampm = hour >= 12 ? "PM" : "AM";
    hour = hour % 12;
    if (hour === 0) hour = 12;

    return `${m} ${d}, ${y} (${hour}:${minute} ${ampm})`;
}

/************************************************************************
 * MARKERS & ANIMATION
 ************************************************************************/
function addOrUpdateEventMarker(ev, isLatest = false, playSoundFlag = true) {
    if (!ev.lat || !ev.lon) return;

    if (markers.has(ev.id)) return;

    const circle = L.circleMarker([ev.lat, ev.lon], {
        radius: magToRadius(ev.magnitude),
        color: "#222",
        weight: 1,
        fillOpacity: 0.8,
        fillColor: magToColor(ev.magnitude),
    }).bindPopup(`

      <strong>${ev.location || "Unknown"}</strong><br>
      Mag: ${ev.magnitude}<br>
      Depth: ${ev.depth ?? "?"} km<br>
      ${formatDateTime(ev.time)}<br>
      ${ev.link ? `<a href="${ev.link}" target="_blank">VIEW REPORT FROM PHIVOLCS</a>` : ""}
    `).addTo(map);

    circle.bindTooltip(`M${ev.magnitude}`, {
        permanent: true,
        direction: "center",
        className: "magnitude-label",
        opacity: 1
    });

    circle._eventId = ev.id;
    markers.set(ev.id, { layer: circle, data: ev });

    if (playSoundFlag && userLocation) {
        const dist = getDistanceKm(ev.lat, ev.lon, userLocation.lat, userLocation.lon);
        const isNearby = dist <= 100;
        playQuakeSound(isNearby, ev.magnitude);
    }

    markers.forEach(({ layer }) => {
        if (layer._path) layer._path.style.zIndex = "1";
        const tip = layer.getTooltip()?.getElement?.();
        if (tip) tip.style.zIndex = "1";
    });

    if (isLatest) {
        // Bring to front both the circle and tooltip
        setTimeout(() => {
            if (circle.bringToFront) circle.bringToFront();

            const tooltip = circle.getTooltip()?.getElement?.();
            if (tooltip) {
                tooltip.style.zIndex = "9999";
            }

            // Also adjust SVG element z-index (Leaflet's internal order)
            if (circle._path) {
                circle._path.style.zIndex = "9999";
            }
        }, 100);

        latestMarker = circle;
        animateLatestMarker(circle);
        showNotification(ev, circle);
        addRealShakeMapLayer();
    }
}

function animateLatestMarker(marker) {
    // Remove flash from other markers
    markers.forEach(({ layer }) => {
        const oldTooltip = layer.getTooltip()?._container;
        if (oldTooltip) oldTooltip.classList.remove("flash");
    });

    const tooltip = marker.getTooltip()?._container;
    if (tooltip) tooltip.classList.add("flash");

    const quakeData = markers.get(marker._eventId)?.data || {};
    const mag = Number(quakeData.magnitude ?? quakeData.mag ?? 4.0);
    const center = marker.getLatLng();

    // More realistic seismic wave reach based on magnitude
    const coverageKm = Math.min(2500, 10 ** (0.9 * mag - 1)); // logarithmic scaling
    const maxRadiusKm = Math.max(5, coverageKm);

    // P-wave and S-wave properties
    const pWaveColor = "rgba(255, 215, 0, 0.8)";
    const sWaveColor = "rgba(255, 69, 0, 0.6)";

    const pWaveCircle = L.circle(center, {
        radius: 0,
        color: "gold",
        weight: 2,
        opacity: 0.9,
        fillColor: pWaveColor,
        fillOpacity: 0.3,
        interactive: false,
    }).addTo(map);

    const sWaveCircle = L.circle(center, {
        radius: 0,
        color: "#ff4500",
        weight: 2,
        opacity: 0.8,
        fillColor: sWaveColor,
        fillOpacity: 0.25,
        interactive: false,
    }).addTo(map);

    // --- Speeds and timing ---
    const pWaveSpeed = 6;   // km/s
    const sWaveSpeed = 3.5; // km/s
    const durationSec = maxRadiusKm / pWaveSpeed;
    const totalSteps = Math.min(900, Math.floor(durationSec * 30)); // ~30 fps

    let step = 0;
    let lastTime = performance.now();

    // --- Smooth animation using requestAnimationFrame ---
    function animate(time) {
        const delta = (time - lastTime) / 1000; // sec since last frame
        lastTime = time;

        // advance by frame time instead of fixed 33ms
        step += delta * 30;
        const t = Math.min(step / totalSteps, 1);

        // compute smooth wavefront distances (m)
        const pRadius = Math.min(maxRadiusKm * 1000, pWaveSpeed * 1000 * step / 30);
        const sRadius = Math.min(maxRadiusKm * 1000, sWaveSpeed * 1000 * step / 30);

        const fade = 1 - t;

        pWaveCircle.setRadius(pRadius);
        sWaveCircle.setRadius(sRadius);

        pWaveCircle.setStyle({
            opacity: fade * 0.9,
            fillOpacity: fade * 0.3,
        });

        sWaveCircle.setStyle({
            opacity: fade * 0.8,
            fillOpacity: fade * 0.25,
        });

        if (t < 1) {
            requestAnimationFrame(animate);
        } else {
            map.removeLayer(pWaveCircle);
            map.removeLayer(sWaveCircle);
        }
    }

    requestAnimationFrame(animate);
}


function updateCircleScaleByZoom() {
    if (scaleUpdateTimeout) clearTimeout(scaleUpdateTimeout);
    scaleUpdateTimeout = setTimeout(() => {
        const zoom = map.getZoom();
        circleScale = Math.max(0.2, Math.min(0.8, 1.2 - (zoom - 5) * 0.3));
        markers.forEach(({ layer, data }) => layer.setRadius(magToRadius(data.magnitude)));
    }, 100);
}

/************************************************************************
 * NOTIFICATION & SOUND
 ************************************************************************/
function showNotification(ev, marker) {
    const quakeId = ev.id;

    if (quakeId !== currentNotificationId) {
        currentNotificationId = quakeId;
        const isAlert = ev.magnitude >= 5.0;
        const title = `Magnitude ${ev.magnitude} Earthquake`;
        const message = `${ev.location} (${ev.depth} km depth)`;

        addNotification(title, message, isAlert, formatDateTime(ev.time));
    }

    // Determine if nearby
    let isNearby = false;
    if (userLocation) {
        const dist = getDistanceKm(ev.lat, ev.lon, userLocation.lat, userLocation.lon);
        if (dist <= 100) isNearby = true;
    }
    setTimeout(() => playQuakeSound(isNearby, ev.magnitude), 100);
}

let audioCtx = null;
let bufferFar = null;
let bufferNearby = null;

async function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    async function loadSound(url) {
        const resp = await fetch(url);
        const arrBuf = await resp.arrayBuffer();
        return await audioCtx.decodeAudioData(arrBuf);
    }

    bufferFar = await loadSound("quakeFar.mp3");
    bufferNearby = await loadSound("quakeClose.mp3");
}

function playSound(isNearby = false) {
    if (!audioCtx || !bufferFar) return;
    const src = audioCtx.createBufferSource();
    src.buffer = isNearby ? bufferNearby : bufferFar;
    src.connect(audioCtx.destination);
    src.start(0);
}



/************************************************************************
 * DATE RANGE
 ************************************************************************/
function getDateRange(filter) {
    const now = new Date();
    let start, end = new Date();
    switch (filter) {
        case "today": start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
        case "week": start = new Date(now); start.setDate(now.getDate() - 7); break;
        case "month": start = new Date(now.getFullYear(), now.getMonth(), 1); break;
        case "year": start = new Date(now.getFullYear(), 0, 1); break;
        default: start = null;
    }
    return { start, end };
}

/************************************************************************
 * FETCH EVENTS
 ************************************************************************/
async function fetchNewEvents() {
    setStatus("Fetching events...");
    try {
        let url;
        if (currentSource === "phivolcs") {
            url = CONFIG.API_ENDPOINT;
            if (currentRange.start && currentRange.end) {
                url += `?start=${currentRange.start.toISOString()}&end=${currentRange.end.toISOString()}`;
            }
        } else if (currentSource === "usgs") {
            url = CONFIG.USGS_ENDPOINT;
            if (currentRange.start && currentRange.end) {
                url += `?start=${currentRange.start.toISOString().slice(0, 10)}&end=${currentRange.end.toISOString().slice(0, 10)}`;
            }
        } else if (currentSource === "emsc") {
            url = CONFIG.EMSC_ENDPOINT;
        }

        // ✅ Fetch data fresh
        const resp = await fetch(url + `?t=${Date.now()}`, { cache: "no-store" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();

        let events = [];
        if (currentSource === "phivolcs") {
            events = json.map(normalizeEvent).filter(e => e.lat && e.lon);
        } else if (currentSource === "usgs") {
            events = (json.features || []).map(f => ({
                id: f.id,
                lat: f.geometry.coordinates[1],
                lon: f.geometry.coordinates[0],
                magnitude: f.properties.mag,
                depth: f.geometry.coordinates[2],
                time: new Date(f.properties.time).toISOString(),
                location: f.properties.place,
                link: f.properties.url
            })).filter(e => e.lat && e.lon);
        } else if (currentSource === "emsc") {
            events = json.map(e => ({
                id: e.id,
                lat: e.lat,
                lon: e.lon,
                magnitude: e.magnitude,
                depth: e.depth,
                time: e.time,
                location: e.location,
                link: e.link
            })).filter(e => e.lat && e.lon);
        }

        if (!events.length) return setStatus("No events in this range");

        // ✅ Always newest first
        events.sort((a, b) => new Date(b.time) - new Date(a.time));

        // 🧭 latest quake
        const latest = events[0];

        // Add all quakes, but only animate/sound the newest
        events.forEach(ev => addOrUpdateEventMarker(ev, ev.id === latest.id, ev.id === latest.id));

        // ✅ remember which quake is newest
        latestEarthquakeId = latest.id;

        setStatus(`Fetched ${events.length} events — latest: ${latest.location} (M${latest.magnitude})`);
    } catch (e) {
        console.error(e);
        setStatus("Error fetching events: " + e.message);
    }
}

/************************************************************************
 * CONTROLS
 ************************************************************************/
document.getElementById("circleScale").addEventListener("input", e => {
    circleScale = parseFloat(e.target.value);
    markers.forEach(({ layer, data }) => layer.setRadius(magToRadius(data.magnitude)));
});

document.getElementById("dateFilter").addEventListener("change", e => {
    const val = e.target.value;
    if (val === "custom") {
        document.getElementById("customRange").style.display = "block";
    } else {
        document.getElementById("customRange").style.display = "none";
        currentRange = getDateRange(val);
        markers.forEach(({ layer }) => map.removeLayer(layer));
        markers.clear();
        fetchNewEvents();
    }
});

document.getElementById("btnApplyRange").addEventListener("click", () => {
    const startInput = document.getElementById("startDate").value;
    const endInput = document.getElementById("endDate").value;
    if (startInput && endInput) {
        currentRange = { start: new Date(startInput), end: new Date(endInput) };
        markers.forEach(({ layer }) => map.removeLayer(layer));
        markers.clear();
        fetchNewEvents();
    }
});

// AUDIO UNLOCK BUTTON
document.getElementById("btnUnlockAudio").addEventListener("click", () => {
    if (!audioUnlocked) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();

        const unlock = () => {
            audioUnlocked = true;
            console.log("Audio unlocked via button");
            const btn = document.getElementById("btnUnlockAudio");
            btn.disabled = true;
            btn.textContent = "EARTHQUAKE AUDIO IS ON";
        };

        if (ctx.state === "suspended") {
            ctx.resume().then(unlock).catch(console.warn);
        } else {
            unlock();
        }
    }
});

document.getElementById("btnTestAlarm").addEventListener("click", () => {
    if (!audioUnlocked) {
        alert("Please unlock audio first by clicking 'Unlock Audio' button");
        return;
    }

    const testEv = {
        id: "TEST_ALARM_" + Date.now(),
        lat: userLocation ? userLocation.lat + (Math.random() - 0.5) * 0.5 : 12.8797,
        lon: userLocation ? userLocation.lon + (Math.random() - 0.5) * 0.5 : 121.7740,
        magnitude: 5.5,
        depth: 10 + Math.random() * 50,
        time: new Date().toISOString(),
        location: "Test Alarm Location (5.0+ Magnitude)"
    };

    console.log("🚨 Testing 5.0+ magnitude alarm...");
    addOrUpdateEventMarker(normalizeEvent(testEv), true, true);
});


/************************************************************************
* POLLING
************************************************************************/
function startPolling() {
    stopPolling(); // clear old interval

    // Fetch immediately
    fetchNewEvents();

    // Then poll every interval
    pollHandle = setInterval(fetchNewEvents, CONFIG.DEFAULT_POLL_MS);
}

function stopPolling() {
    if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = null;
    }
}


function setStatus(msg) {
    document.getElementById("status").textContent = "Status: " + msg;
    console.log("[EarthquakeMonitor]", msg);
}

// Test quake button
document.getElementById("btnTestQuake").addEventListener("click", () => {
    const testEv = {
        id: "TEST_" + Date.now(),
        lat: 12.8797 + (Math.random() - 0.5) * 2,
        lon: 121.7740 + (Math.random() - 0.5) * 2,
        magnitude: 4 + Math.random() * 3,
        depth: 10 + Math.random() * 50,
        time: new Date().toISOString(),
        location: "Test Location"
    };
    addOrUpdateEventMarker(normalizeEvent(testEv), true);
});

// Dynamic poll interval selector
document.getElementById("selInterval").addEventListener("change", e => {
    const interval = parseInt(e.target.value);
    if (!isNaN(interval) && interval > 0) {
        CONFIG.DEFAULT_POLL_MS = interval;
        startPolling(); // restart polling with new interval
    }
});

/************************************************************************
 * REFRESH MAP
 ************************************************************************/

function refreshMap() {
    stopPolling();

    latestEarthquakeId = null;

    markers.forEach(({ layer }) => {
        if (layer._pulse) clearInterval(layer._pulse);
        map.removeLayer(layer);
    });
    markers.clear();
    if (flyTimeout) clearTimeout(flyTimeout);
    latestMarker = null;

    currentNotificationId = null;

    latestMarker = null;
    currentNotificationId = null;

    fetchNewEventsWithoutSound();
    startPolling();
}


document.getElementById("btnRefresh").addEventListener("click", refreshMap);

async function fetchNewEventsWithoutSound() {
    setStatus("Fetching events...");
    try {
        let url = CONFIG.API_ENDPOINT;
        if (currentRange.start && currentRange.end) {
            url += `?start=${currentRange.start.toISOString()}&end=${currentRange.end.toISOString()}`;
        }

        const resp = await fetch(url + `?t=${Date.now()}`, { cache: "no-store" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        if (!Array.isArray(json)) {
            console.warn("Expected an array, got:", json);
            setStatus("Error: Unexpected API format");
            return;
        }

        const events = json.map(normalizeEvent).filter(e => e.lat && e.lon);
        if (!events.length) return setStatus("No events in this range");

        events.sort((a, b) => new Date(b.time) - new Date(a.time));

        events.forEach((ev, idx) => {
            addOrUpdateEventMarker(ev, idx === 0, false);
        });

        setStatus(`Fetched ${events.length} events`);
    } catch (e) {
        console.error(e);
        setStatus("Error fetching events: " + e.message);
    }
}

const eventSource = new EventSource("https://earthquakeapi.vercel.app/api/earthquakes");

/************************************************************************
* DEDUPLICATION FIX + ANIMATION CONTROL
************************************************************************/

function addOrUpdateEventMarker(ev, isLatest = false, playSoundFlag = true) {
    if (!ev.lat || !ev.lon) return;

    // ✅ Ignore if this quake already exists (avoid duplicate notifications)
    if (markers.has(ev.id)) return;

    const circle = L.circleMarker([ev.lat, ev.lon], {
        radius: magToRadius(ev.magnitude),
        color: "#222",
        weight: 1,
        fillOpacity: 0.8,
        fillColor: magToColor(ev.magnitude),
    }).bindPopup(`


      <strong>${ev.location || "Unknown"}</strong><br>
      Mag: ${ev.magnitude}<br>
      Depth: ${ev.depth ?? "?"} km<br>
      ${formatDateTime(ev.time)}<br>
      ${ev.link ? `<a href="${ev.link}" target="_blank">VIEW REPORT FROM PHIVOLCS</a>` : ""}
    `).addTo(map);

    if (isLatest) {
        setTimeout(() => {
            // Reset z-index of all old markers + labels
            markers.forEach(({ layer }) => {
                if (layer._path) layer._path.style.zIndex = "1";
                const tip = layer.getTooltip()?.getElement?.();
                if (tip) tip.style.zIndex = "1";
            });

            // Bring this one to the very top
            if (circle.bringToFront) circle.bringToFront();

            const tooltip = circle.getTooltip()?.getElement?.();
            if (tooltip) tooltip.style.zIndex = "9999";
            if (circle._path) circle._path.style.zIndex = "9999";
        }, 100);
    }


    circle.bindTooltip(`M${ev.magnitude}`, {
        permanent: true,
        direction: "center",
        className: "magnitude-label",
        opacity: 1
    });

    circle._eventId = ev.id;
    markers.set(ev.id, { layer: circle, data: ev });

    if (playSoundFlag && userLocation) {
        const dist = getDistanceKm(ev.lat, ev.lon, userLocation.lat, userLocation.lon);
        const isNearby = dist <= 100;
        playQuakeSound(isNearby, ev.magnitude);
    }

    if (isLatest) {
        // Stop previous latest animation safely
        if (latestMarker && latestMarker._pulse) {
            clearInterval(latestMarker._pulse);
            latestMarker._pulse = null;
        }

        latestMarker = circle;
        animateLatestMarker(circle);
        showNotification(ev, circle);
        addRealShakeMapLayer();
    }
}

/************************************************************************
 * SSE EVENT HANDLER FIX
 ************************************************************************/

let seenQuakes = new Set();

eventSource.onmessage = (event) => {
    try {
        const quake = JSON.parse(event.data);
        if (!quake || !quake.id) return;

        // ✅ Skip duplicate quakes
        if (seenQuakes.has(quake.id)) return;
        seenQuakes.add(quake.id);

        latestEarthquakeId = quake.id;
        console.log("🚨 New unique earthquake detected via SSE:", quake);

        // ✅ add new marker & animate once
        addOrUpdateEventMarker(normalizeEvent(quake), true, true);
        markers.forEach(({ layer }) => map.removeLayer(layer));
        markers.clear();

        markUpdate();
    } catch (err) {
        console.warn("Error parsing SSE quake:", err);
    }
};


/************************************************************************
 * GEOLOCATION FIXED FOR ANDROID + IPHONE (requires user interaction)
 ************************************************************************/

/************************************************************************
 * Modern bottom-bar style “Enable My Location” for mobile browsers
 ************************************************************************/
function initLocationButton() {
  // Prevent duplicates
  if (document.getElementById("enableLocationBar")) return;

  const bar = document.createElement("div");
  bar.id = "enableLocationBar";
  bar.innerHTML = `
    <div class="location-bar-content">
      <span class="location-bar-text">Allow access to your location to show nearby earthquakes</span>
      <button id="enableLocationBtn">📍 Enable My Location</button>
    </div>
  `;

  document.body.appendChild(bar);

  // Styling — looks like a mobile bottom nav bar
  const style = document.createElement("style");
  style.textContent = `
    #enableLocationBar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #0a0e27;
      border-top: 2px solid #00d4ff;
      color: #e2e8f0;
      z-index: 3000;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 14px 10px;
      box-shadow: 0 -4px 16px rgba(0,0,0,0.4);
      animation: slideUp 0.4s ease forwards;
    }
    .location-bar-content {
      width: 100%;
      max-width: 480px;
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .location-bar-text {
      flex: 1;
      font-size: 12px;
      line-height: 1.3;
      color: #cbd5e1;
    }
    #enableLocationBtn {
      flex-shrink: 0;
      background: #00d4ff;
      color: #0a0e27;
      border: none;
      padding: 10px 16px;
      border-radius: 8px;
      font-weight: 6100;
      font-size: 10px;
      cursor: pointer;
      transition: all 0.25s ease;
    }
    #enableLocationBtn:active {
      transform: scale(0.97);
      background: #00a9d6;
    }
    @keyframes slideUp {
      from { transform: translateY(100%); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes slideDown {
      from { transform: translateY(0); opacity: 1; }
      to { transform: translateY(100%); opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  const btn = document.getElementById("enableLocationBtn");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Getting location...";
    const success = await requestLocationPermission(true);
    if (success) {
      btn.textContent = "Location Enabled ✅";
      // Slide away smoothly
      bar.style.animation = "slideDown 0.4s ease forwards";
      setTimeout(() => bar.remove(), 400);
    } else {
      btn.textContent = "Permission Denied ❌";
      setTimeout(() => {
        bar.style.animation = "slideDown 0.4s ease forwards";
        setTimeout(() => bar.remove(), 400);
      }, 2000);
    }
  });
}

/************************************************************************
 * Request location (called only after user gesture)
 ************************************************************************/
async function requestLocationPermission(forceAsk = false) {
    if (!("geolocation" in navigator)) {
        alert("❌ Geolocation not supported by this browser.");
        return false;
    }

    if (location.protocol !== "https:" && location.hostname !== "localhost") {
        alert("⚠️ Location access requires HTTPS. Please use a secure (https://) site.");
        return false;
    }

    const saved = localStorage.getItem("locationPermission");
    if (saved === "granted" && !forceAsk) {
        return getAndStoreUserLocation();
    }

    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                userLocation = {
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                };
                console.log("✅ Location obtained:", userLocation);
                localStorage.setItem("locationPermission", "granted");
                addUserMarker();
                resolve(true);
            },
            (err) => {
                console.warn("⚠️ Location error:", err.message);
                localStorage.setItem("locationPermission", "denied");
                alert("Please enable location access in your browser settings.");
                resolve(false);
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
        );
    });
}

/************************************************************************
 * Adds the user's marker to the map
 ************************************************************************/
function addUserMarker() {
    if (!userLocation) return;
    if (userMarker) map.removeLayer(userMarker);

    userMarker = L.marker([userLocation.lat, userLocation.lon], {
        title: "Your Location",
        icon: L.icon({
            iconUrl: "https://cdn-icons-png.flaticon.com/512/535/535137.png",
            iconSize: [30, 30],
            iconAnchor: [15, 30],
        }),
    })
        .addTo(map)
        .bindPopup("📍 You are here")
        .openPopup();

    map.setView([userLocation.lat, userLocation.lon], 7);
}

/************************************************************************
 * INIT
 ************************************************************************/
(function init() {
    currentRange = getDateRange("today");

    // Initialize Location Button FIRST (user must tap to trigger geolocation)
    initLocationButton();

    // Then continue with app setup
    fetchNewEvents(); // initial load

    // Start SSE (primary live updates)
    startEventStream();

    // Start polling ONLY as fallback
    setTimeout(() => {
        if (!sseConnected) {
            console.warn("SSE not connected — using fallback polling");
            startPolling();
        }
    }, 5000);

})();

// Hook 1: when fetchNewEvents succeeds
const _origFetchNewEvents = fetchNewEvents;
fetchNewEvents = async function () {
    await _origFetchNewEvents();
    markUpdate();
};

// Hook 2: when SSE receives new data
if (typeof eventSource !== "undefined") {
    eventSource.addEventListener("message", (event) => markUpdate());
}

// Watchdog: check every minute if data stalled for 5+ minutes
setInterval(() => {
    const minutesSinceLastUpdate = (Date.now() - lastUpdateTime) / 60000;
    if (minutesSinceLastUpdate > 5) {
        console.warn("⚠️ No new earthquake updates for 5 minutes. Reloading page...");
        window.location.reload();
    }
}, 60000);

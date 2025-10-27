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
    if (!markers.has(event.id)) {
        addOrUpdateEventMarker(event);
    }
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
    preferCanvas: true,
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

    if (isLatest && latestMarker && latestMarker._eventId) {
        const prevData = markers.get(latestMarker._eventId)?.data;
        if (prevData) {
            map.removeLayer(latestMarker);
            const oldCircle = L.circleMarker([prevData.lat, prevData.lon], {
                radius: magToRadius(prevData.magnitude),
                color: "#222",
                weight: 1,
                fillOpacity: 0.8,
                fillColor: magToColor(prevData.magnitude),
            }).bindPopup(`
              <strong>${prevData.location || "Unknown"}</strong><br>
              Mag: ${prevData.magnitude}<br>
              Depth: ${prevData.depth ?? "?"} km<br>
              ${formatDateTime(prevData.time)}<br>
              ${prevData.link ? `<a href="${prevData.link}" target="_blank">VIEW REPORT FROM PHIVOLCS</a>` : ""}
            `).addTo(map);

            oldCircle.bindTooltip(`M${prevData.magnitude}`, {
                permanent: true,
                direction: "center",
                className: "magnitude-label",
                opacity: 1
            });

            markers.set(prevData.id, { layer: oldCircle, data: prevData });
        }
    }

    let marker;

    // When placing latest marker (triangle)
    if (isLatest) {
        const triangle = L.shapeMarker(ev.lat, ev.lon, {
            shape: 'triangle',
            radius: magToRadius(ev.magnitude) * 1.4,
            color: '#ff0000',      // stroke red
            fillColor: '#ff6666',  // fill softer red
            fillOpacity: 0.95,
            weight: 2
        }).bindPopup(`
          <strong>${ev.location || "Unknown"}</strong><br>
          Mag: ${ev.magnitude}<br>
          Depth: ${ev.depth ?? "?"} km<br>
          ${formatDateTime(ev.time)}<br>
          ${ev.link ? `<a href="${ev.link}" target="_blank">VIEW REPORT FROM PHIVOLCS</a>` : ""}
          animateLatestMarker(triangle);
        `).addTo(map);

        triangle.bindTooltip(`M${ev.magnitude}`, {
            permanent: true,
            direction: "center",
            className: "magnitude-label latest",
            opacity: 1
        });

        marker = triangle;
    } else {
        // 🟢 Regular quake = circle
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

        marker = circle;
    }

    marker._eventId = ev.id;
    markers.set(ev.id, { layer: marker, data: ev });

    if (playSoundFlag && userLocation) {
        const dist = getDistanceKm(ev.lat, ev.lon, userLocation.lat, userLocation.lon);
        const isNearby = dist <= 100;
        playQuakeSound(isNearby, ev.magnitude);
    }

    if (isLatest) {
        latestMarker = markerLayer;

        // Animate, notify, shake map
        animateLatestMarker(markerLayer);
        showNotification(ev, markerLayer);
        addRealShakeMapLayer();

        // ✅ Bring the latest marker and tooltip above all others
        setTimeout(() => {
            try {
                markerLayer.bringToFront(); // Leaflet layer
                const tooltip = markerLayer.getTooltip();
                if (tooltip && tooltip._container) {
                    tooltip._container.style.zIndex = 9999; // tooltip front
                }

                // If using divIcon SVG (triangle), raise its z-index
                const el = markerLayer.getElement?.();
                if (el) {
                    el.style.zIndex = 9999;
                    el.style.position = "relative";
                }
            } catch (err) {
                console.warn("Failed to bring latest marker to front:", err);
            }
        }, 50); // slight delay ensures Leaflet finished rendering
    }
}

function animateLatestMarker(marker) {
    // Remove flash from other markers
    markers.forEach(({ layer }) => {
        const oldTooltip = layer.getTooltip()?._container;
        if (oldTooltip) oldTooltip.classList.remove("flash");

        // Remove flash from both circle and triangle markers
        if (layer._path) {
            layer._path.classList.remove("flash-circle");
        } else {
            const el = layer.getElement?.();
            if (el) el.classList.remove("flash-circle");
        }
    });

    // Add flash to this marker and label
    const tooltip = marker.getTooltip()?._container;
    if (tooltip) tooltip.classList.add("flash");

    // Handle both circleMarker and shapeMarker (triangle)
    if (marker._path) {
        marker._path.classList.add("flash-circle"); // Circle SVG
    } else {
        const el = marker.getElement?.();
        if (el) {
            el.classList.add("flash-circle"); // Triangle SVG
            el.style.filter = "drop-shadow(0 0 10px rgba(255, 60, 60, 0.9))";
        }
    }

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

    function animate(time) {
        const delta = (time - lastTime) / 1000;
        lastTime = time;
        step += delta * 30;
        const t = Math.min(step / totalSteps, 1);

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

        if (t < 1) requestAnimationFrame(animate);
        else {
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

function limitMarkers() {
    const limit = 250; // Adjust as needed
    const keys = Array.from(markers.keys());
    if (keys.length > limit) {
        const removeKeys = keys.slice(0, keys.length - limit);
        removeKeys.forEach((key) => {
            const { layer } = markers.get(key);
            map.removeLayer(layer);
            markers.delete(key);
        });
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
    if (!ev || !ev.lat || !ev.lon) return;

    // ✅ Ignore duplicates
    if (markers.has(ev.id)) return;

    // If a previous latest exists and a new latest is incoming, revert previous latest to a circle
    if (isLatest && latestMarker && latestMarker._eventId && latestMarker._eventId !== ev.id) {
        const prev = markers.get(latestMarker._eventId);
        if (prev && prev.data) {
            try {
                // remove the triangle/latest marker layer
                map.removeLayer(latestMarker);
            } catch (err) { /* ignore */ }

            const prevData = prev.data;
            // create a normal circle marker to replace the previous latest
            const oldCircle = L.circleMarker([prevData.lat, prevData.lon], {
                radius: magToRadius(prevData.magnitude),
                color: "#222",
                weight: 1,
                fillOpacity: 0.8,
                fillColor: magToColor(prevData.magnitude)
            }).bindPopup(`
                <strong>${prevData.location || "Unknown"}</strong><br>
                Mag: ${prevData.magnitude}<br>
                Depth: ${prevData.depth ?? "?"} km<br>
                ${formatDateTime(prevData.time)}<br>
                ${prevData.link ? `<a href="${prevData.link}" target="_blank">VIEW REPORT FROM PHIVOLCS</a>` : ""}
            `).addTo(map);

            oldCircle.bindTooltip(`M${prevData.magnitude}`, {
                permanent: true,
                direction: "center",
                className: "magnitude-label",
                opacity: 1
            });

            // replace in the markers map
            markers.set(prevData.id, { layer: oldCircle, data: prevData });
            latestMarker = null; // we'll set the new latest later
        }
    }

    // Create the marker: triangle if latest, circle otherwise
    let markerLayer;
    if (isLatest) {
        const size = Math.max(24, Math.round(magToRadius(ev.magnitude) * 2) + 8);
        const points = `${size / 2},0 0,${size} ${size},${size}`;
        const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
                   <polygon points="${points}" stroke="#8B0000" stroke-width="2" fill="${magToColor(ev.magnitude)}" fill-opacity="0.95" />
                 </svg>`;

        const icon = L.divIcon({
            className: "triangle-marker-divicon",
            html: svg,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2]
        });

        markerLayer = L.marker([ev.lat, ev.lon], { icon }).addTo(map);

        markerLayer.bindPopup(`
          <strong>${ev.location || "Unknown"}</strong><br>
          Mag: ${ev.magnitude}<br>
          Depth: ${ev.depth ?? "?"} km<br>
          ${formatDateTime(ev.time)}<br>
          ${ev.link ? `<a href="${ev.link}" target="_blank">VIEW REPORT FROM PHIVOLCS</a>` : ""}
        `);

        // Add a prominent tooltip for the latest
        markerLayer.bindTooltip(` M${ev.magnitude}`, {
            permanent: true,
            direction: "center",
            className: "magnitude-label latest",
            opacity: 1
        });

        // marker.getElement() returns the DIV; query the svg inside it:
        const el = markerLayer.getElement && markerLayer.getElement();
        if (el) {
            markerLayer._path = el.querySelector("svg") || el;
        }
    } else {
        // regular circle marker
        markerLayer = L.circleMarker([ev.lat, ev.lon], {
            radius: magToRadius(ev.magnitude),
            color: "#222",
            weight: 1,
            fillOpacity: 0.8,
            fillColor: magToColor(ev.magnitude),
        }).addTo(map);

        markerLayer.bindPopup(`
          <strong>${ev.location || "Unknown"}</strong><br>
          Mag: ${ev.magnitude}<br>
          Depth: ${ev.depth ?? "?"} km<br>
          ${formatDateTime(ev.time)}<br>
          ${ev.link ? `<a href="${ev.link}" target="_blank">VIEW REPORT FROM PHIVOLCS</a>` : ""}
        `);

        markerLayer.bindTooltip(`M${ev.magnitude}`, {
            permanent: true,
            direction: "center",
            className: "magnitude-label",
            opacity: 1
        });
    }

    // set housekeeping props and store
    markerLayer._eventId = ev.id;
    markers.set(ev.id, { layer: markerLayer, data: ev });

    // optionally play sound based on proximity
    if (playSoundFlag && userLocation) {
        const dist = getDistanceKm(ev.lat, ev.lon, userLocation.lat, userLocation.lon);
        const isNearby = dist <= 100;
        playQuakeSound(isNearby, ev.magnitude);
    }

    if (isLatest) {
        // Clear previous latest animation
        if (latestMarker && latestMarker._pulse) {
            clearInterval(latestMarker._pulse);
            latestMarker._pulse = null;
        }

        latestMarker = markerLayer;

        // Animate, notify, shake map
        try { animateLatestMarker(markerLayer); } catch (err) { console.warn("animateLatestMarker error:", err); }
        try { showNotification(ev, markerLayer); } catch (err) { console.warn("showNotification error:", err); }
        try { addRealShakeMapLayer(); } catch (err) { /* ignore */ }

        // Force latest marker and tooltip on top
        setTimeout(() => {
            try {
                // Bring marker layer front (works for circleMarker and normal markers)
                if (markerLayer.bringToFront) markerLayer.bringToFront();

                // If tooltip exists
                const tooltip = markerLayer.getTooltip();
                if (tooltip && tooltip._container) {
                    tooltip._container.style.zIndex = 9999;
                }

                // For divIcon / triangle markers
                const el = markerLayer.getElement?.();
                if (el) {
                    el.style.zIndex = 9999;
                    el.style.position = "relative"; // required for z-index
                }
            } catch (err) {
                console.warn("Failed to bring latest marker to front:", err);
            }
        }, 50); // small delay ensures Leaflet finished rendering
    }


}

// Runtime safeguard: hide on mobile, show on desktop
function handleMagnitudeLabelsResponsive() {
    const isMobile = window.innerWidth <= 768;
    document.querySelectorAll(".leaflet-tooltip.magnitude-label").forEach(el => {
        el.style.display = isMobile ? "none" : "block";
    });
}

// Run once on load and every resize
handleMagnitudeLabelsResponsive();
window.addEventListener("resize", handleMagnitudeLabelsResponsive);

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

        markUpdate();
    } catch (err) {
        console.warn("Error parsing SSE quake:", err);
    }
};

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
      <span class="location-bar-text">Allow access to show your location</span>
      <button id="enableLocationBtn">Enable Access to my Location</button>
    </div>
  `;

    document.body.appendChild(bar);

    // Add styles
    const style = document.createElement("style");
    style.textContent = `
    #enableLocationBar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(90deg, #151d3b 0%, #4e0707 100%);
      border-top: 2px solid #ffffff70;
      color: #e2e8f0;
      z-index: 3000;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 14px 10px;
      box-shadow: 0 -4px 16px rgba(0,0,0,0.4);
      animation: slideUp 0.4s ease forwards;
      font-family: "Inter", sans-serif;
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
      font-weight: 500;
      font-size: 0.9rem;
      line-height: 1.4;
      color: #ffffffff;
    }
    #enableLocationBtn {
      flex-shrink: 0;
      background: #882121ff;
      color: #ffffffff;
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.25s ease;
    }
    #enableLocationBtn:active {
      transform: scale(0.97);
      background: #ae2c2cff;
    }

    /* RESPONSIVE STYLES */
    @media (max-width: 768px) {
      .location-bar-text {
        font-size: 0.75rem;
      }
      #enableLocationBtn {
        font-size: 0.75rem;
        padding: 8px 14px;
      }
    }

    /* MOBILE COMPACT VERSION (smaller phones) */
    @media (max-width: 480px) {
      .location-bar-text {
        font-size: 0.7rem;
        content: "Allow access to show your location";
      }
      #enableLocationBtn {
        font-size: 0.7rem;
      }
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

    // Adjust text/button for mobile in JS (content can’t be changed via CSS alone)
    if (window.innerWidth <= 480) {
        bar.querySelector(".location-bar-text").textContent = "Allow access to show your location";
        bar.querySelector("#enableLocationBtn").textContent = "Enable Access";
    }

    // Button click handling
    const btn = document.getElementById("enableLocationBtn");
    btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Getting location...";
        const success = await requestLocationPermission(true);
        if (success) {
            btn.textContent = "Location Enabled";
            bar.style.animation = "slideDown 0.4s ease forwards";
            setTimeout(() => bar.remove(), 400);
        } else {
            btn.textContent = "Permission Denied";
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
// Add Responsive Legend
const legend = L.control({ position: "topleft" });

legend.onAdd = function (map) {
    const div = L.DomUtil.create("div", "info legend");
    const grades = [0, 3, 4, 5, 6, 7];
    const colors = ["#FEB24C", "#FD8D3C", "#FC4E2A", "#E31A1C", "#BD0026", "#800026"];

    // Responsive sizing
    const isMobile = window.innerWidth <= 768;
    const fontSize = isMobile ? "0.7rem" : "0.85rem";
    const iconSize = isMobile ? 14 : 18;
    const padding = isMobile ? "6px 8px" : "8px 12px";
    const maxHeight = isMobile ? "30vh" : "auto"; // slightly shorter
    const maxWidth = isMobile ? "45vw" : "220px";

    div.style.background = "rgba(255, 255, 255, 0.85)";
    div.style.padding = padding;
    div.style.borderRadius = "8px";
    div.style.boxShadow = "0 0 15px rgba(0,0,0,0.2)";
    div.style.fontSize = fontSize;
    div.style.lineHeight = "1.4";
    div.style.color = "#ffffffff";
    div.style.maxWidth = maxWidth;
    div.style.maxHeight = maxHeight;
    div.style.overflowY = "auto"; // always allow scrolling if needed
    div.style.marginBottom = isMobile ? "15px" : "0";
    div.style.marginRight = isMobile ? "10px" : "0"; // push in from right edge
    div.style.position = "relative"; // safer positioning

    div.innerHTML = "<strong>Magnitude</strong><br>";

    for (let i = 0; i < grades.length; i++) {
        div.innerHTML +=
            `<i style="background:${colors[i]}; width:${iconSize}px; height:${iconSize}px; display:inline-block; margin-right:8px; border-radius:50%;"></i>` +
            `${grades[i]}${grades[i + 1] ? "&ndash;" + grades[i + 1] : "+"}<br>`;
    }

    div.innerHTML += `<i style="background:#ff6666; width:${iconSize}px; height:${iconSize}px; display:inline-block; margin-right:8px; clip-path: polygon(50% 0%, 0% 100%, 100% 100%);"></i> Latest Earthquake`;

    return div;
};

legend.addTo(map);

// Update on resize to stay responsive
window.addEventListener("resize", () => {
    legend.remove();
    legend.addTo(map);
});


/************************************************************************
 * INIT
 ************************************************************************/
(function init() {
    currentRange = getDateRange("today");

    limitMarkers();

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
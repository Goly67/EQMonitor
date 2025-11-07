let scaleUpdateTimeout = null;
let flyTimeout = null
let userLocation = null;
let userMarker = null;
let lastEventLink = null;
let latestEarthquakeId = null;
let flying = false;
const CACHE_TTL = 60000;
let notificationPermission = null;
let serviceWorkerRegistration = null;
let lastNotifiedEarthquakeId = null;
let lastUpdateTime = Date.now();

// Function to mark when data was last updated
function markUpdate() {
    lastUpdateTime = Date.now();
}

const panel = document.getElementById('controls');
const burgerMenuBtn = document.getElementById('burgerMenuBtn');
const menuOverlay = document.getElementById('menuOverlay');


let faultLinesLayer = null;
let harmonizedFaultLinesLayer = null;

// Philippine bounds
const philippinesBounds = {
    north: 21,
    south: 4,
    east: 127,
    west: 116
};

function isInPhilippines(feature) {
    const coords = feature.geometry.coordinates;
    if (feature.geometry.type === 'LineString') {
        for (let point of coords) {
            const [lng, lat] = point;
            if (lat >= philippinesBounds.south && lat <= philippinesBounds.north &&
                lng >= philippinesBounds.west && lng <= philippinesBounds.east) {
                return true;
            }
        }
    } else if (feature.geometry.type === 'MultiLineString') {
        for (let line of coords) {
            for (let point of line) {
                const [lng, lat] = point;
                if (lat >= philippinesBounds.south && lat <= philippinesBounds.north &&
                    lng >= philippinesBounds.west && lng <= philippinesBounds.east) {
                    return true;
                }
            }
        }
    }
    return false;
}

async function loadFaultLines() {
    try {
        const response1 = await fetch('https://eq-monitor.vercel.app/scripts/gem_active_faults.geojson');
        const data1 = await response1.json();
        faultLinesLayer = L.geoJSON(data1, {
            filter: isInPhilippines,
            style: {
                color: 'red',
                weight: 1.5,
                opacity: 0.5
            }
        }).addTo(map);

        const response2 = await fetch('https://eq-monitor.vercel.app/scripts/gem_active_faults_harmonized.geojson');
        const data2 = await response2.json();
        harmonizedFaultLinesLayer = L.geoJSON(data2, {
            filter: isInPhilippines,
            style: {
                color: 'blue',
                weight: 1,
                opacity: 0.4,
                dashArray: '5, 5'
            }
        }).addTo(map);

        console.log('Philippine fault and trench lines loaded successfully.');
    } catch (error) {
        console.error('Error loading fault lines:', error);
        showCustomAlert('Failed to load Philippine fault lines. Check file paths or hosting.');
    }
}

// Call this function on page load or map ready (automatic, no toggle)
loadFaultLines();

function showCustomAlert(message) {
    // remove existing alert if open
    const oldAlert = document.getElementById("customAlert");
    if (oldAlert) oldAlert.remove();

    const alertBox = document.createElement("div");
    alertBox.id = "customAlert";
    alertBox.style.position = "fixed";
    alertBox.style.top = 0;
    alertBox.style.left = 0;
    alertBox.style.width = "100vw";
    alertBox.style.height = "100vh";
    alertBox.style.background = "rgba(0,0,0,0.65)";
    alertBox.style.display = "flex";
    alertBox.style.alignItems = "center";
    alertBox.style.justifyContent = "center";
    alertBox.style.zIndex = "999999";

    alertBox.innerHTML = `
    <div style="
      background:#99221c;
      padding:20px;
      border-radius:14px;
      max-width:350px;
      width:90%;
      font-family:system-ui;
      text-align:center;
      box-shadow:0 8px 20px rgba(0,0,0,0.25);
      animation: pop .25s ease;
    ">
      <div style="font-size:20px;font-weight:600;margin-bottom:8px;"><b>ALERT</b></div>
      <div style="font-size:15px;margin-bottom:18px;">${message}</div>
      <button id="alertOkBtn" style="
        background:#0078ff;
        border:none;
        padding:10px 18px;
        border-radius:10px;
        color:white;
        cursor:pointer;
        font-size:15px;
        width:100%;
      ">Okay</button>
    </div>

    <style>
    @keyframes pop {
      0% { transform:scale(.85); opacity:0; }
      100% { transform:scale(1); opacity:1; }
    }
    </style>
  `;

    document.body.appendChild(alertBox);
    document.getElementById("alertOkBtn").onclick = () => alertBox.remove();
}

/* window.addEventListener("load", () => {
    showCustomAlert("Custom alert system active and running!");
}); */

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

    if (isNearby && magnitude >= 4.0) {
        alarmSound.currentTime = 0;
        alarmSound.play().catch(err => console.warn("Alarm play failed:", err));
    } else {
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


let circleScale = 0.5;
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
        
        // Send desktop push notification if this is a new earthquake
        // Check both currentNotificationId and lastNotifiedEarthquakeId to avoid duplicates
        if (quakeId !== lastNotifiedEarthquakeId) {
            lastNotifiedEarthquakeId = quakeId;
            console.log('[Notification] ========================================');
            console.log('[Notification] NEW EARTHQUAKE DETECTED - Sending desktop push notification');
            console.log('[Notification] Earthquake ID:', quakeId);
            console.log('[Notification] Previous notified ID:', lastNotifiedEarthquakeId);
            console.log('[Notification] ========================================');
            sendBrowserNotification(ev, title, message, isAlert);
        } else {
            console.log('[Notification] ⚠️ Skipping duplicate notification for earthquake:', quakeId);
            console.log('[Notification] Last notified ID:', lastNotifiedEarthquakeId);
        }
    }

    // Determine if nearby
    let isNearby = false;
    if (userLocation) {
        const dist = getDistanceKm(ev.lat, ev.lon, userLocation.lat, userLocation.lon);
        if (dist <= 100) isNearby = true;
    }
    setTimeout(() => playQuakeSound(isNearby, ev.magnitude), 100);
}

/************************************************************************
 * BROWSER PUSH NOTIFICATIONS
 ************************************************************************/
async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.warn('This browser does not support notifications');
        return false;
    }

    if (Notification.permission === 'granted') {
        notificationPermission = 'granted';
        return true;
    }

    if (Notification.permission === 'denied') {
        console.warn('Notification permission denied');
        notificationPermission = 'denied';
        return false;
    }

    // Request permission
    try {
        const permission = await Notification.requestPermission();
        notificationPermission = permission;
        
        if (permission === 'granted') {
            console.log('Notification permission granted');
            return true;
        } else {
            console.log('Notification permission denied');
            return false;
        }
    } catch (error) {
        console.error('Error requesting notification permission:', error);
        return false;
    }
}

async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        console.warn('[Service Worker] Service Workers are not supported in this browser');
        return null;
    }

    try {
        console.log('[Service Worker] Attempting to register service worker...');
        const registration = await navigator.serviceWorker.register('/sw.js', {
            scope: '/'
        });
        
        console.log('[Service Worker] Registered successfully:', registration);
        serviceWorkerRegistration = registration;
        
        // Wait for service worker to be ready
        if (registration.installing) {
            console.log('[Service Worker] Service worker is installing...');
            await new Promise((resolve) => {
                registration.installing.addEventListener('statechange', function() {
                    console.log('[Service Worker] State changed to:', this.state);
                    if (this.state === 'activated' || this.state === 'installed') {
                        resolve();
                    }
                });
            });
        } else if (registration.waiting) {
            console.log('[Service Worker] Service worker is waiting...');
        } else if (registration.active) {
            console.log('[Service Worker] Service worker is already active');
        }
        
        // Check for updates
        registration.addEventListener('updatefound', () => {
            console.log('[Service Worker] Update found');
            const newWorker = registration.installing;
            newWorker.addEventListener('statechange', () => {
                console.log('[Service Worker] New worker state:', newWorker.state);
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    console.log('[Service Worker] New service worker available');
                }
            });
        });
        
        return registration;
    } catch (error) {
        console.error('[Service Worker] Registration failed:', error);
        console.error('[Service Worker] Error details:', error.message, error.stack);
        return null;
    }
}

async function sendBrowserNotification(ev, title, message, isAlert) {
    // Always check the actual permission status, not the cached variable
    const currentPermission = Notification.permission;
    
    if (currentPermission !== 'granted') {
        console.warn('[Notification] Permission not granted. Current status:', currentPermission);
        console.warn('[Notification] Please click "Enable Push Notifications" button to grant permission');
        return;
    }
    
    // Update permission state to match actual permission
    notificationPermission = 'granted';
    
    console.log('[Notification] ===== SENDING DESKTOP PUSH NOTIFICATION =====');
    console.log('[Notification] Earthquake ID:', ev.id);
    console.log('[Notification] Title:', title);
    console.log('[Notification] Message:', message);
    console.log('[Notification] Is Alert:', isAlert);

    function shortenLocation(location) {
        if (!location) return 'Unknown Location';
        
        // Remove the directional part like "036 km N 35° E of"
        let shortLoc = location
            .replace(/\d+\s*km\s*[NS]\s*\d+°\s*[EW]\s*of\s*/gi, '')
            .replace(/^\d+\s*km\s*/gi, '')
            .trim();
    
        const match = shortLoc.match(/^([A-Za-zÀ-ÿ\s'’\-.]+(?:\s*\([^)]+\))?)/);
        if (match) {
            shortLoc = match[1].trim();
        }
    
        // Safety check: prevent overlong text
        if (shortLoc.length > 60) {
            shortLoc = shortLoc.substring(0, 57) + '...';
        }
    
        return shortLoc;
    }
    
    const shortLocation = shortenLocation(ev.location);
    
    // Determine distance for context
    let distanceText = '';
    if (userLocation) {
        const dist = getDistanceKm(ev.lat, ev.lon, userLocation.lat, userLocation.lon);
        distanceText = dist <= 100 
            ? `⚠️ NEARBY - ${Math.round(dist)} km away` 
            : `${Math.round(dist)} km away`;
    }

    // Format: Depth below magnitude, then location, then distance, then time
    const notificationBody = `${ev.depth ?? '?'} km depth\n${shortLocation}${distanceText ? '\n' + distanceText : ''}\nTime: ${formatDateTime(ev.time)}`;
    
    // Use absolute path for icon or relative to root
    const iconPath = window.location.origin + '/logo.png';
    
    const notificationOptions = {
        body: notificationBody,
        icon: iconPath,
        badge: iconPath,
        tag: `earthquake-${ev.id}`,
        requireInteraction: isAlert, // Keep high-magnitude alerts visible until user interacts
        timestamp: ev.time ? new Date(ev.time).getTime() : Date.now(),
        vibrate: isAlert ? [200, 100, 200, 100, 200] : [200, 100, 200],
        data: {
            url: window.location.href,
            earthquakeId: ev.id,
            magnitude: ev.magnitude,
            location: ev.location
        }
    };

    try {
        // Always use direct Notification API for desktop notifications
        if (Notification.permission === 'granted') {
            console.log('[Notification] Creating desktop notification using Notification API');
            console.log('[Notification] Options:', notificationOptions);
            
            // Create desktop notification - this will show as a system notification
            const notification = new Notification(title, notificationOptions);
            
            console.log('[Notification] ✅ Desktop notification object created:', notification);
            
            // Handle click - focus window when notification is clicked
            notification.onclick = (event) => {
                console.log('[Notification] Notification clicked');
                event.preventDefault();
                window.focus();
                notification.close();
            };
            
            // Handle errors
            notification.onerror = (error) => {
                console.error('[Notification] ❌ Desktop notification error:', error);
                console.error('[Notification] Error type:', typeof error);
            };
            
            // Log when notification is shown
            notification.onshow = () => {
                console.log('[Notification] ✅✅✅ Desktop notification DISPLAYED successfully!');
            };
        
            
            // Store notification reference to prevent garbage collection
            window._lastNotification = notification;
            
            // Auto-close after 10 seconds if not high priority
            if (!isAlert) {
                setTimeout(() => {
                    if (notification) {
                        notification.close();
                    }
                }, 10000);
            }
            
            // Double-check: verify notification was created
            if (!notification) {
                console.error('[Notification] ❌ Notification object is null/undefined!');
            }
        } else {
            console.warn('[Notification] ❌ Cannot show desktop notification - permission not granted');
            console.warn('[Notification] Current permission:', Notification.permission);
        }
    } catch (error) {
        console.error('[Notification] ❌❌❌ ERROR creating desktop notification:', error);
        console.error('[Notification] Error name:', error.name);
        console.error('[Notification] Error message:', error.message);
        console.error('[Notification] Error stack:', error.stack);
        
        // If direct API fails, try service worker as fallback
        if (serviceWorkerRegistration && serviceWorkerRegistration.active) {
            try {
                console.log('[Notification] Attempting fallback to service worker');
                await serviceWorkerRegistration.showNotification(title, notificationOptions);
                console.log('[Notification] Service worker notification sent');
            } catch (swError) {
                console.error('[Notification] Service worker fallback also failed:', swError);
            }
        }
    }
}

function triggerPermissionPrompt() {
    if (Notification.permission === 'default') {
        // Add a tiny overlay that auto-clicks itself on user interaction
        const hiddenBtn = document.createElement('button');
        hiddenBtn.style.position = 'absolute';
        hiddenBtn.style.opacity = '0';
        hiddenBtn.style.pointerEvents = 'none';
        document.body.appendChild(hiddenBtn);

        const handler = async () => {
            try {
                console.log('[Notification] Asking permission via trusted user gesture...');
                await hiddenBtn.click(); // Must be inside real user click
                const permission = await Notification.requestPermission();
                console.log('Notification result:', permission);
            } catch (err) {
                console.error('Permission error:', err);
            }
            window.removeEventListener('click', handler);
            hiddenBtn.remove();
        };

        // Hook into any first user click
        window.addEventListener('click', handler, { once: true });
    }
}

// Initialize notification system on page load
async function initNotificationSystem() {
    await registerServiceWorker();
    triggerPermissionPrompt();

    notificationPermission = Notification.permission;

    // Check if notifications are already enabled
    if (Notification.permission === 'granted') {
        const btn = document.getElementById('btnEnableNotifications');
        if (btn) {
            btn.textContent = '✓ Notifications Enabled';
            btn.style.background = '#28a745';
            btn.disabled = true;
        }
        console.log('[Notification] Notifications already enabled on page load');
    } else {
        console.log('[Notification] Notifications not enabled. Current permission:', Notification.permission);
    }

    if (Notification.permission !== 'granted') {
        console.log('[Notification] Waiting for user interaction to request permission...');
        forceNotificationPermission();
    } else {
        console.log('[Notification] Permission already granted.');
    }
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
 * FETCH EVENTS (with cache + Facebook RSS fallback)
 ************************************************************************/
async function fetchNewEvents() {
    setStatus("Fetching events...");
    const cacheKey = "cachedEarthquakes";
    const cacheTimeKey = "cachedEarthquakesTime";
    const fbFeedUrl = "https://rss.app/feeds/U6XZP9zYYmVM8EiP.xml";

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

        // ✅ Try to fetch from PHIVOLCS / other sources
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

        if (!events.length) throw new Error("No events received");

        // ✅ Always newest first
        events.sort((a, b) => new Date(b.time) - new Date(a.time));

        // 🧭 latest quake
        const latest = events[0];

        // Add all quakes, but only animate/sound the newest
        events.forEach(ev => addOrUpdateEventMarker(ev, ev.id === latest.id, ev.id === latest.id));

        // ✅ Cache successful result
        localStorage.setItem(cacheKey, JSON.stringify(events));
        localStorage.setItem(cacheTimeKey, Date.now().toString());

        latestEarthquakeId = latest.id;
        setStatus(`Fetched ${events.length} events — latest: ${latest.location} (M${latest.magnitude})`);

    } catch (e) {
        console.warn("⚠️ PHIVOLCS fetch failed:", e.message);
        setStatus("Website down — switching to Facebook fallback...");

        // 🧠 Try PHIVOLCS Facebook RSS fallback
        try {
            console.warn("[EarthquakeMonitor] Website down — switching to Facebook fallback...");

            // ⚠️ Show red warning banner BELOW the header bar (responsive)
            let banner = document.querySelector("#fallbackBanner");
            if (!banner) {
                const header = document.querySelector(".header-bar");
                const headerHeight = header ? header.offsetHeight : 60;

                banner = document.createElement("div");
                banner.id = "fallbackBanner";
                banner.textContent = "PHIVOLCS WEBSITE IS DOWN";

                Object.assign(banner.style, {
                    position: "fixed",
                    top: `${headerHeight + 10}px`, // slightly more space below header
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "#c62828",
                    color: "#fff",
                    fontWeight: "600",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    padding: "10px 8px", // more horizontal + vertical padding
                    zIndex: "3000",
                    boxShadow: "0 3px 8px rgba(0,0,0,0.3)",
                    fontSize: "clamp(13px, 2.2vw, 17px)", // a lil more readable
                    lineHeight: "1.5", // improved text spacing
                    wordBreak: "break-word",
                    boxSizing: "border-box",
                    borderRadius: "10px", // smoother corners
                    maxWidth: "90vw",
                    whiteSpace: "normal",
                    textWrap: "balance", // makes wrapping more natural (modern browsers)
                });

                document.body.appendChild(banner);

                // Adjust banner position on resize/orientation change
                window.addEventListener("resize", () => {
                    const newHeaderHeight = header ? header.offsetHeight : 60;
                    banner.style.top = `${newHeaderHeight + 8}px`;
                });
            }


            addNotification("PHIVOLCS DATA FALLBACK", "Using Facebook feed data (website may be down)", true);

            const rssRes = await fetch("https://rss.app/feeds/U6XZP9zYYmVM8EiP.xml");
            const rssText = await rssRes.text();

            const parser = new DOMParser();
            const xml = parser.parseFromString(rssText, "text/xml");
            const items = [...xml.querySelectorAll("item")];
            if (!items.length) throw new Error("No Facebook RSS items found");

            const fallbackEvents = [];

            items.forEach((item, index) => {
                const raw = item.querySelector("description")?.textContent || "";
                const cleanText = raw
                    .replace(/<[^>]+>/g, "")           // remove HTML
                    .replace(/#\S+/g, "")              // remove hashtags
                    .replace(/https?:\/\/\S+/g, "")    // remove link
                    .replace(/\s+/g, " ")              // normalize spaces
                    .trim();

                // Extract fields
                const magnitude = parseFloat(cleanText.match(/Magnitude\s*=?\s*([\d.]+)/i)?.[1] || 0);
                const depth = parseFloat(cleanText.match(/Depth\s*=?\s*(\d+)/i)?.[1] || 0);
                const lat = parseFloat(cleanText.match(/Location\s*=\s*([0-9.]+)°\s*[NS]/i)?.[1] || 0);
                const lon = parseFloat(cleanText.match(/,\s*([0-9.]+)°\s*[EW]/i)?.[1] || 0);

                const dateMatch = cleanText.match(/Date and Time:\s*(.+?)(?=Magnitude|$)/i);
                const time = dateMatch ? dateMatch[1].trim() : "Unknown time";

                // Extract human-readable place
                const locMatch = cleanText.match(/E of (.+?)\)/i);
                const location = locMatch ? locMatch[1].trim() : "Philippines";

                if (lat && lon) {
                    fallbackEvents.push({
                        id: `fb_${index}`,
                        lat,
                        lon,
                        magnitude,
                        depth,
                        time,
                        location,
                        link: null // no clickable link in popup
                    });
                }
            });

            if (!fallbackEvents.length) throw new Error("No valid earthquake entries found in Facebook feed");

            // Sort newest first
            fallbackEvents.sort((a, b) => new Date(b.time) - new Date(a.time));
            const latest = fallbackEvents[0];

            // Add markers (triangles/circles + animation)
            fallbackEvents.forEach(ev => addOrUpdateEventMarker(ev, ev.id === latest.id, ev.id === latest.id));

            latestEarthquakeId = latest.id;
            setStatus(`Fallback: Showing ${fallbackEvents.length} events from Facebook feed`);

            // Cache fallback data
            localStorage.setItem("cachedEarthquakes", JSON.stringify(fallbackEvents));
            localStorage.setItem("cachedEarthquakesTime", Date.now().toString());

        } catch (fbErr) {
            console.error("❌ Facebook fallback also failed:", fbErr);
            setStatus("All sources unavailable");

            const cached = localStorage.getItem("cachedEarthquakes");
            const cachedTime = localStorage.getItem("cachedEarthquakesTime");
            if (cached) {
                const events = JSON.parse(cached);
                const ageMins = Math.floor((Date.now() - cachedTime) / 60000);
                setStatus(`Showing cached earthquakes (saved ${ageMins} min ago)`);
                events.forEach(ev => addOrUpdateEventMarker(ev, false, false));
            } else {
                setStatus("No cached earthquakes available 😕");
            }
        }

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

// NOTIFICATION ENABLE BUTTON
document.getElementById("btnEnableNotifications").addEventListener("click", async () => {
    const btn = document.getElementById("btnEnableNotifications");
    btn.disabled = true;
    btn.textContent = "Requesting permission...";
    
    // Make sure service worker is registered first
    if (!serviceWorkerRegistration) {
        console.log('[Notification] Registering service worker before requesting permission...');
        await registerServiceWorker();
    }
    
    const granted = await requestNotificationPermission();
    
    // Always sync permission state with actual browser permission
    notificationPermission = Notification.permission;
    
    if (granted && Notification.permission === 'granted') {
        btn.textContent = "✓ Notifications Enabled";
        btn.style.background = "#28a745";
        addNotification('Push Notifications Enabled', 'You will receive desktop push notifications for new earthquakes', false);
        console.log('[Notification] Permission granted and synced. Status:', Notification.permission);
    } else {
        btn.textContent = "Enable Push Notifications";
        btn.disabled = false;
        if (Notification.permission === 'denied') {
            showCustomAlert('Notification permission was denied. Please enable it in your browser settings:\n\nChrome: Settings > Site Settings > Notifications\n\nOr click the lock icon in the address bar and allow notifications.');
        } else {
            showCustomAlert('Notification permission was not granted. Please try again.');
        }
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

let audioContext;

function autoUnlockAudio() {
    if (audioUnlocked) return;

    // Create a new audio context if needed
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    const unlockAudio = async () => {
        if (audioUnlocked) return;

        try {
            if (audioContext.state === "suspended") {
                await audioContext.resume();
            }

            audioUnlocked = true;
            console.log("🎧 Audio unlocked automatically after first interaction!");

            // Update UI if button exists
            const btn = document.getElementById("btnUnlockAudio");
            if (btn) {
                btn.disabled = true;
                btn.textContent = "EARTHQUAKE AUDIO IS ON";
            }

            // Clean up listeners
            window.removeEventListener("click", unlockAudio);
            window.removeEventListener("scroll", unlockAudio);
            window.removeEventListener("keydown", unlockAudio);
        } catch (err) {
            console.warn("Audio unlock failed:", err);
        }
    };

    // Wait for first real interaction
    window.addEventListener("click", unlockAudio, { once: true });
    window.addEventListener("scroll", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
}

document.getElementById("btnTestAlarm").addEventListener("click", () => {
    if (!audioUnlocked) {
        showCustomAlert("Please unlock audio first by clicking 'Unlock Audio' button");
        return;
    }

    // Create test earthquake close to user location (within 100km to trigger alarm)
    // This will trigger the alarm sound when nearby (within 100km) and magnitude >= 4.0
    let testLat, testLon;
    
    if (userLocation) {
        // Place earthquake approximately 50km away (within the 100km "nearby" threshold)
        // 50km ≈ 0.45 degrees
        const distanceKm = 50;
        const bearing = 0; // North direction (0 degrees)
        const earthRadiusKm = 6371;
        const angularDistance = distanceKm / earthRadiusKm;
        
        const lat1 = userLocation.lat * Math.PI / 180;
        const lon1 = userLocation.lon * Math.PI / 180;
        const bearingRad = bearing * Math.PI / 180;
        
        testLat = Math.asin(
            Math.sin(lat1) * Math.cos(angularDistance) +
            Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad)
        ) * 180 / Math.PI;
        
        testLon = (lon1 + Math.atan2(
            Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1),
            Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(testLat * Math.PI / 180)
        )) * 180 / Math.PI;
        
        console.log("🚨 Test earthquake placed ~50km away from user location (within alarm range)");
        console.log("🚨 User location:", userLocation.lat, userLocation.lon);
        console.log("🚨 Test earthquake location:", testLat, testLon);
        
        // Verify distance
        const calculatedDistance = getDistanceKm(userLocation.lat, userLocation.lon, testLat, testLon);
        console.log("🚨 Calculated distance:", Math.round(calculatedDistance), "km (within 100km = nearby)");
    } else {
        // If no user location, place it at default location
        // User should enable location to test alarm properly
        testLat = 12.8797;
        testLon = 121.7740;
        console.log("🚨 User location not available - please enable location to test alarm sound");
        showCustomAlert("Please enable your location to test the alarm sound. The alarm only plays for earthquakes within 100km of your location.");
    }
    
    const testEv = {
        id: "TEST_ALARM_" + Date.now(),
        lat: testLat,
        lon: testLon,
        magnitude: 5.5, // 5.0+ magnitude to trigger alarm
        depth: 10 + Math.random() * 50,
        time: new Date().toISOString(),
        location: "Test Alarm Location (5.0+ Magnitude) - Nearby"
    };

    console.log("🚨 Testing 5.0+ magnitude alarm (will play alarm if within 100km of your location)...");
    
    // Reset notification tracking so test notification will show
    lastNotifiedEarthquakeId = null;
    currentNotificationId = null;
    
    // Add the marker - this will trigger showNotification and playQuakeSound
    // The alarm will only play if the earthquake is within 100km (isNearby = true) and magnitude >= 4.0
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

    // Store the previous latest earthquake ID before clearing
    const previousLatestId = latestEarthquakeId;
    latestEarthquakeId = null;
    
    // Reset notification tracking - this allows the latest earthquake to notify again
    // if it's different from what we had before
    lastNotifiedEarthquakeId = previousLatestId; // Keep previous to compare
    currentNotificationId = null;

    markers.forEach(({ layer }) => {
        if (layer._pulse) clearInterval(layer._pulse);
        map.removeLayer(layer);
    });
    markers.clear();
    if (flyTimeout) clearTimeout(flyTimeout);
    latestMarker = null;

    // Use regular fetchNewEvents to ensure notifications work
    console.log('[Refresh] Refreshing earthquake data...');
    fetchNewEvents();
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

        // Get the latest earthquake
        const latest = events[0];
        
        // Add all events, but only animate/notify the latest
        events.forEach((ev, idx) => {
            const isLatest = ev.id === latest.id;
            addOrUpdateEventMarker(ev, isLatest, false); // false = no sound, but still notify
        });

        // Update latest earthquake ID
        if (latest) {
            latestEarthquakeId = latest.id;
        }

        setStatus(`Fetched ${events.length} events`);
    } catch (e) {
        console.error(e);
        setStatus("Error fetching events: " + e.message);
    }
}

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
        bar.querySelector("#enableLocationBtn").textContent = "Enable access to show your location";
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
 * Request location (only called after user gesture)
 ************************************************************************/
async function requestLocationPermission(forceAsk = false) {
    if (!("geolocation" in navigator)) {
        showCustomAlert("Geolocation not supported by this browser.");
        return false;
    }

    if (location.protocol !== "https:" && location.hostname !== "localhost") {
        showCustomAlert("⚠️ Location access requires HTTPS. Please use a secure (https://) site.");
        return false;
    }

    let state = "prompt";
    try {
        const status = await navigator.permissions.query({ name: "geolocation" });
        state = status.state;
    } catch { }

    if (state === "granted" && !forceAsk) return getAndStoreUserLocation();

    if (state === "prompt" || forceAsk) {
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
                    console.warn("⚠️ Location error:", err);
                    if (err.code === 1)
                        showCustomAlert(`This is an unofficial browser!<br>Please proceed to Chrome or Safari for location access.`);
                    else
                        showCustomAlert(`Unable to get location.<br>${err.message}`);

                    localStorage.setItem("locationPermission", "denied");
                    resolve(false);
                },
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
            );
        });
    }

    if (state === "denied") {
        showCustomAlert(
            "Location access has been blocked.\n\n" +
            "Please go to your browser settings > Site Settings > Allow Location."
        );
        return false;
    }
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
    initLocationButton();
    autoUnlockAudio();

    initNotificationSystem(); // Initialize push notifications
    fetchNewEvents(); // initial load

    // No SSE — just use regular polling
console.log("[EarthquakeMonitor] Using polling for updates");
startPolling();

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
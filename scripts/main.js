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

// ===== ACTIVE FAULT TRACKING =====
// Map to track earthquakes by location (latitude/longitude rounded to 0.1 precision)
const locationQuakeMap = new Map(); // key: "lat,lon", value: { count, earthquakes: [], active: true }
const activeFaultBanner = document.getElementById('activeFaultBanner');
const activeFaultMessage = document.getElementById('activeFaultMessage');
const activeFaultClose = document.getElementById('activeFaultClose');
let currentActiveFault = null; // Track which fault is currently shown

// Helper function to get location key (round to 0.1 precision to group nearby earthquakes)
function getLocationKey(lat, lon) {
    const precision = 0.1;
    const roundLat = Math.round(lat / precision) * precision;
    const roundLon = Math.round(lon / precision) * precision;
    return `${roundLat.toFixed(1)},${roundLon.toFixed(1)}`;
}

// Track earthquake and check if it triggers active fault announcement
function trackEarthquakeLocation(ev) {
    if (!ev.lat || !ev.lon) return;
    
    const key = getLocationKey(ev.lat, ev.lon);
    let locationData = locationQuakeMap.get(key);
    
    if (!locationData) {
        locationData = { count: 0, earthquakes: [], active: false, lat: ev.lat, lon: ev.lon };
        locationQuakeMap.set(key, locationData);
    }
    
    locationData.count++;
    locationData.earthquakes.push({
        id: ev.id,
        time: ev.time,
        magnitude: ev.magnitude,
        location: ev.location
    });
    
    // Keep only last 10 earthquakes per location
    if (locationData.earthquakes.length > 10) {
        locationData.earthquakes.shift();
    }
    
    // Show announcement if 4 or more earthquakes at this location
    if (locationData.count >= 4 && !locationData.active) {
        locationData.active = true;
        showActiveFaultBanner(locationData, key);
    } else if (locationData.count >= 4 && locationData.active) {
        // Update existing banner with latest data
        updateActiveFaultBanner(locationData);
    }
}

// Function to format time for display
function formatActiveFaultTime(isoTime) {
    try {
        const date = new Date(isoTime);
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const day = date.getDate();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        return `${month}/${day} ${hours}:${minutes}`;
    } catch {
        return 'Unknown';
    }
}

// Show active fault banner
function showActiveFaultBanner(locationData, locationKey) {
    if (currentActiveFault) {
        closeActiveFaultBanner();
    }
    
    currentActiveFault = { locationKey, locationData };
    
    const latestQuake = locationData.earthquakes[locationData.earthquakes.length - 1];
    const timeStr = formatActiveFaultTime(latestQuake.time);
    const magStr = latestQuake.magnitude.toFixed(1);
    
    activeFaultMessage.textContent = `${locationData.count} earthquakes • ${timeStr} M${magStr} • Click to view`;
    
    activeFaultBanner.style.display = 'block';
    activeFaultBanner.classList.remove('closing');
    void activeFaultBanner.offsetWidth; // Force reflow
    activeFaultBanner.classList.add('active');
}

// Update existing active fault banner
function updateActiveFaultBanner(locationData) {
    const latestQuake = locationData.earthquakes[locationData.earthquakes.length - 1];
    const timeStr = formatActiveFaultTime(latestQuake.time);
    const magStr = latestQuake.magnitude.toFixed(1);
    
    activeFaultMessage.textContent = `${locationData.count} earthquakes • ${timeStr} M${magStr} • Click to view`;
}

// Close active fault banner
function closeActiveFaultBanner() {
    if (!activeFaultBanner || !activeFaultBanner.classList.contains('active')) return;
    
    activeFaultBanner.classList.remove('active');
    activeFaultBanner.classList.add('closing');
    
    const onAnimationEnd = () => {
        activeFaultBanner.style.display = 'none';
        activeFaultBanner.classList.remove('closing');
        activeFaultBanner.removeEventListener('animationend', onAnimationEnd);
    };
    
    activeFaultBanner.addEventListener('animationend', onAnimationEnd);
    currentActiveFault = null;
}

// Event listeners for banner
if (activeFaultClose) {
    activeFaultClose.addEventListener('click', (e) => {
        e.stopPropagation();
        closeActiveFaultBanner();
    });
}

if (activeFaultBanner) {
    activeFaultBanner.addEventListener('click', (e) => {
        if (e.target === activeFaultClose) return;
        
        // Fly to the active fault location
        if (currentActiveFault) {
            const { locationData } = currentActiveFault;
            map.flyTo([locationData.lat, locationData.lon], 12, {
                duration: 1.5
            });
        }
        e.stopPropagation();
    });
}

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
        const response1 = await fetch('https://raw.githubusercontent.com/Goly67/EQMonitor/main/scripts/gem_active_faults.geojson');
        const data1 = await response1.json();
        faultLinesLayer = L.geoJSON(data1, {
            filter: isInPhilippines,
            style: {
                color: 'red',
                weight: 1.5,
                opacity: 0.5
            }
        }).addTo(map);

        const response2 = await fetch('https://raw.githubusercontent.com/Goly67/EQMonitor/main/scripts/gem_active_faults_harmonized.geojson');
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

// Custom Alert that can run a callback when OK is clicked
function showCustomAlert(message, onOk = null) {
  const oldAlert = document.getElementById("customAlert");
  if (oldAlert) oldAlert.remove();

  const overlay = document.createElement("div");
  overlay.id = "customAlert";
  overlay.className = "eq-alert-overlay";

overlay.innerHTML = `
    <div class="eq-alert-card" role="dialog" aria-modal="true" aria-label="Alert">
        <div class="eq-alert-header">
            <div class="eq-alert-icon" aria-hidden="true">
                <span class="material-symbols-outlined" style="color: var(--color-warning); font-size: 22px;">
                    notifications
                </span>
            </div>
            <h3 class="eq-alert-title">Notification</h3>
        </div>

        <div class="eq-alert-body">${message}</div>

        <div class="eq-alert-actions">
            <button id="alertOkBtn" class="eq-alert-btn eq-alert-btn--primary">Okay</button>
        </div>
    </div>
`;

  document.body.appendChild(overlay);

  const close = (runOk = false) => {
    overlay.classList.add("closing");
    const removeNow = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown);
      if (runOk && typeof onOk === "function") onOk();
    };
    // Wait for animation
    setTimeout(removeNow, 250);
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") close(false);
  };
  document.addEventListener("keydown", onKeyDown);

  overlay.addEventListener("click", (e) => {
    // click outside card closes
    if (e.target === overlay) close(false);
  });

  document.getElementById("alertOkBtn").onclick = () => close(true);

  // Focus for accessibility
  document.getElementById("alertOkBtn").focus();
}

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

// Admin access button
const adminBtn = document.createElement('button');
adminBtn.textContent = 'Admin Panel';
adminBtn.style.cssText = 'width: 100%; margin: 10px 0;';
adminBtn.addEventListener('click', () => {
    if (!firebase.auth) {
        alert("Firebase Auth not available. Please check Firebase configuration.");
        return;
    }
    const googleProvider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(googleProvider).then((result) => {
        const user = result.user;
        // Replace with your authorized email(s)
        const allowedEmails = ['tifys587@gmail.com'];
        if (allowedEmails.includes(user.email)) {
            isAdmin = true;
            localStorage.setItem("isAdmin", "true");
            viewerName = "Admin";
            updateLastSeenOnly(); // Update session with new name
            // Refresh the presence panel
            sessionsRef.once('value', snap => {
                const sessions = snap.val() || {};
                buildPresencePanel(sessions);
                refreshPresenceMarkers(sessions);
            });
        } else {
            alert("Not authorized for admin access.");
            firebase.auth().signOut();
        }
    }).catch((error) => {
        console.error("Sign in failed:", error);
        alert("Sign in failed. Please try again.");
    });
});
panel.appendChild(adminBtn);

// NOTIFICATION SYSTEM - FINAL WORKING VERSION
const notificationBell = document.getElementById('notificationBell');
const notificationPanel = document.getElementById('notificationPanel');
const notificationPanelClose = document.getElementById('notificationPanelClose');
const notificationPanelContent = document.getElementById('notificationPanelContent');
const notificationBadge = document.getElementById('notificationBadge');

// Presence tracking UI
const presenceBtn = document.getElementById("presenceBtn");
const presencePanel = document.getElementById("presencePanel");
const presencePanelClose = document.getElementById("presencePanelClose");
const presencePanelContent = document.getElementById("presencePanelContent");
const presenceCountEl = document.getElementById("presenceCount");

const sessionsRef = firebase.database().ref("sessions"); // count live
const presenceMarkers = new Map();
let isAdmin = localStorage.getItem("isAdmin") === "true";

// Unique viewer id persisted per browser
let viewerId = localStorage.getItem("viewerId");
if (!viewerId) {
    viewerId = crypto.randomUUID();
    localStorage.setItem("viewerId", viewerId);
}

let viewerName = "Guest";
localStorage.setItem("viewerName", viewerName);

let viewerLocation = null;

function buildPresencePanel(sessions) {
    const allEntries = Object.entries(sessions || {});

    if (!isAdmin) {
        const myEntry = sessions[viewerId] ? [[viewerId, sessions[viewerId]]] : [];
        if (myEntry.length === 0) {
            presencePanelContent.innerHTML = '<div class="presence-panel-empty">No location active yet.</div>';
            return;
        }
        const [id, s] = myEntry[0];
        const ageSec = Math.floor((Date.now() - (s.lastSeen || 0)) / 1000);
        const locText = (s.lat != null && s.lon != null) ? `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}` : "location unknown";
        presencePanelContent.innerHTML = `<div class="presence-item presence-self"><strong>You</strong> · ${locText} · active ${ageSec}s ago</div>`;
        return;
    }

    if (allEntries.length === 0) {
        presencePanelContent.innerHTML = '<div class="presence-panel-empty">No one else is viewing right now.</div>';
        return;
    }

    const now = Date.now();
    const rows = allEntries.map(([id, s]) => {
        const ageSec = Math.floor((now - (s.lastSeen || 0)) / 1000);
        const locText = (s.lat != null && s.lon != null) ? `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}` : "location unknown";
        const name = id === viewerId ? "You" : (s.displayName || "Unknown");
        const selfTag = id === viewerId ? " (you)" : "";
        return `<div class="presence-item${id === viewerId ? " presence-self" : ""}"><strong>${name}</strong>${selfTag} · ${locText} · active ${ageSec}s ago</div>`;
    });

    presencePanelContent.innerHTML = rows.join("");
}

function refreshPresenceMarkers(sessions) {
    presenceMarkers.forEach(marker => map.removeLayer(marker));
    presenceMarkers.clear();

    const targetSessions = isAdmin ? sessions : {[viewerId]: sessions[viewerId]};

    Object.entries(targetSessions || {}).forEach(([id, s]) => {
        if (!s || s.lat == null || s.lon == null) return;

        try {
            const marker = L.circleMarker([s.lat, s.lon], {
                radius: id === viewerId ? 9 : 6,
                fillColor: id === viewerId ? "#0047AB" : "#EF6631",
                color: "#ffffff",
                weight: 1,
                fillOpacity: 0.9,
                opacity: 0.9
            }).addTo(map);

            const nameLabel = id === viewerId ? "You" : (s.displayName || "Guest");
            marker.bindPopup(`<strong>${nameLabel}</strong><br/>${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}<br/>Last active: ${new Date(s.lastSeen || 0).toLocaleTimeString()}`);
            presenceMarkers.set(id, marker);
        } catch (err) {
            console.warn("Presence marker failed:", err);
        }
    });
}

function updateMySession(lat, lon) {
    viewerLocation = { lat, lon };
    const sessionData = {
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        status: "online",
        displayName: viewerName || "Guest",
        role: isAdmin ? "admin" : "member",
        lat: Number(lat),
        lon: Number(lon)
    };

    const targetRef = presenceSessionRef || sessionsRef.child(viewerId);
    targetRef.set(sessionData).catch(err => console.error("Failed updating session", err));
}

function updateLastSeenOnly() {
    const updates = {
        lastSeen: Date.now(),
        displayName: viewerName || "Guest",
        status: "online",
        role: isAdmin ? "admin" : "member"
    };

    const targetRef = presenceSessionRef || sessionsRef.child(viewerId);
    targetRef.update(updates).catch(err => console.error("Failed updating last seen", err));
}

// Presence listener + map markers
sessionsRef.on("value", snap => {
    const sessions = snap.val() || {};
    const now = Date.now();
    const cutoff = now - 5 * 60 * 1000; // 5 minutes

    const activeSessions = {};
    Object.entries(sessions).forEach(([id, s]) => {
        if ((s.lastSeen || 0) < cutoff) {
            sessionsRef.child(id).remove();
            return;
        }
        activeSessions[id] = s;
    });

    let activeCount = Object.keys(activeSessions).length;
    if (!isAdmin) {
        activeCount = activeSessions[viewerId] ? 1 : 0;
    }
    if (presenceCountEl) {
        presenceCountEl.textContent = activeCount;
    }

    buildPresencePanel(activeSessions);
    refreshPresenceMarkers(activeSessions);
});

// Regular heartbeat for our own session
setInterval(() => {
    if (viewerLocation) {
        updateMySession(viewerLocation.lat, viewerLocation.lon);
    } else {
        updateLastSeenOnly();
    }
}, 20 * 1000);

// Remove session on unload
window.addEventListener("beforeunload", () => {
    sessionsRef.child(viewerId).remove();
});

// Attempt to get geolocation
if (navigator.geolocation) {
    navigator.geolocation.watchPosition(position => {
        updateMySession(position.coords.latitude, position.coords.longitude);
    }, err => {
        console.warn("Geolocation failed:", err);
        // write presence without location if denied
        updateLastSeenOnly();
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 });
} else {
    console.warn("Geolocation not supported in this browser.");
    updateLastSeenOnly();
}

if (!viewerId) {
    viewerId = crypto.randomUUID();
    localStorage.setItem("viewerId", viewerId);
}

let notifications = [];

// NEW - WORKING VERSION:
function addNotification(title, message, isAlert = false, time = null, link = null) {
    console.log('[addNotification] Creating notification:', { title, message, isAlert, time, link });

    // Create notification object
    const notification = {
        id: Date.now() + Math.random(),
        title: title || 'Notification',
        message: message || 'No message',
        isAlert: isAlert || false,
        time: time || new Date().toLocaleTimeString(),
        link: link
    };

    console.log('[addNotification] Notification object:', notification);

    // Add to array (newest first)
    notifications.unshift(notification);
    console.log('[addNotification] Total notifications now:', notifications.length);

    // Keep max 10
    if (notifications.length > 10) {
        notifications.pop();
    }

    // IMPORTANT: Update the UI
    console.log('[addNotification] Calling updateNotificationUI...');
    updateNotificationUI();
    console.log('[addNotification] Done!');
}

// ===== MAKE SURE updateNotificationUI IS ALSO CORRECT =====

function updateNotificationUI() {
    console.log('[updateNotificationUI] Rendering', notifications.length, 'notifications');

    if (!notificationPanelContent) {
        console.error('[updateNotificationUI] ERROR: notificationPanelContent is NULL!');
        return;
    }

    // If empty, show message
    if (notifications.length === 0) {
        console.log('[updateNotificationUI] No notifications, showing empty message');
        notificationPanelContent.innerHTML = '<div class="notification-panel-empty">No notifications yet</div>';
        if (notificationBadge) {
            notificationBadge.style.display = 'none';
        }
        return;
    }

    // Update badge
    if (notificationBadge) {
        notificationBadge.textContent = notifications.length;
        notificationBadge.style.display = 'flex';
        console.log('[updateNotificationUI] Badge updated to:', notifications.length);
    }

    let html = '';
    notifications.forEach((notif, idx) => {
        console.log('[updateNotificationUI] Rendering notification', idx + 1, ':', notif.title);

        html += `
      <div class="notification-item ${notif.isAlert ? 'alert' : ''}">
        <div class="notification-item-title">${notif.title}</div>
        <div>${notif.message}</div>
        <div class="notification-item-time">${notif.time}</div>

        ${notif.link ? `
            <div class="notification-item-link">
                <a href="${notif.link}" target="_blank" style="color:#4aa3ff; text-decoration:underline;">
                    View Earthquake Details
                </a>
            </div>
        ` : ''}
      </div>
    `;
    });
    notificationPanelContent.innerHTML = html;
    console.log('[updateNotificationUI] Successfully rendered all notifications');
}

// ===== NOTIFICATION PANEL CONTROLS =====

function forceClosePresencePanel() {
    if (!presencePanel.classList.contains("active")) return;

    presencePanel.classList.remove("active");
    presencePanel.classList.add("closing");

    presencePanel.addEventListener(
        "animationend",
        () => {
            presencePanel.style.display = "none";
            presencePanel.classList.remove("closing");
        },
        { once: true }
    );
}

// ===== NOTIFICATION PANEL CONTROLS =====
if (notificationBell) {
    notificationBell.addEventListener('click', (e) => {
        e.stopPropagation();

        // Close presence panel if it is open
        forceClosePresencePanel();

        if (!notificationPanel.classList.contains('active')) {
            notificationPanel.style.display = 'block';
            notificationPanel.classList.remove("closing");
            void notificationPanel.offsetWidth;
            notificationPanel.classList.add('active');

        } else {
            notificationPanel.classList.remove('active');
            notificationPanel.classList.add('closing');

            notificationPanel.addEventListener('animationend', () => {
                notificationPanel.classList.remove('closing');
                notificationPanel.style.display = 'none';
            }, { once: true });
        }
    });
}

/************************************************************************
 * FIXED SINGLE AUDIO SYSTEM
 ************************************************************************/
const quakeSound = document.getElementById("quakeSound");
const quakeNearby = document.getElementById("quakeNearbySound");
const alarmSound = document.getElementById("alarmSound");
const unlockBtn = document.getElementById("btnUnlockAudio");

let audioUnlocked = false;

// 🔓 Unlock on first user action
function unlockAudio() {
    if (audioUnlocked) return;
    try {
        [quakeSound, quakeNearby, alarmSound].forEach(a => {
            a.play().then(() => {
                a.pause();
                a.currentTime = 0;
            }).catch(() => { });
        });
        audioUnlocked = true;
        console.log("🎧 Audio unlocked and ready!");

        if (unlockBtn) {
            unlockBtn.disabled = true;
            unlockBtn.textContent = "EARTHQUAKE AUDIO IS ON";
        }
    } catch (err) {
        console.warn("Audio unlock failed:", err);
    }
}

// 👆 Unlock on first interaction
["click", "scroll", "keydown", "touchstart"].forEach(ev =>
    window.addEventListener(ev, unlockAudio, { once: true })
);

// 🧩 Manual unlock button
unlockBtn?.addEventListener("click", unlockAudio);

// 🔊 Play sound
function playQuakeSound(isNearby = false, magnitude = 0) {
    if (!audioUnlocked) return;

    let baseSound;
    if (magnitude >= 5.0) baseSound = alarmSound;
    else if (isNearby) baseSound = quakeNearby;
    else baseSound = quakeSound;

    const clone = baseSound.cloneNode();
    clone.volume = currentMasterVolume;
    clone.play().catch(err => console.warn("Audio play failed:", err));

    // Track active sound
    activeSounds.push(clone);

    // Remove from active list once done
    clone.addEventListener("ended", () => {
        activeSounds = activeSounds.filter(s => s !== clone);
    });
}
/************************************************************************
 * CONFIG
 ************************************************************************/
const CONFIG = {
    API_ENDPOINT: "https://earthquakeapi.forestparty223.workers.dev/api/earthquakes",
    DEFAULT_POLL_MS: 15000,
};
let currentSource = "forestparty";


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
// Set max bounds to restrict map view to Philippines area only
const philippinesMaxBounds = L.latLngBounds(
    L.latLng(2, 114),    // Southwest corner (south, west)
    L.latLng(22, 136)    // Northeast corner (north, east)
);

const map = L.map("map", {
    maxBounds: philippinesMaxBounds,
    maxBoundsViscosity: 1.0, // Prevent bouncing back when dragging outside bounds
    minZoom: 5, // Minimum zoom level - prevents zooming out to see the world
    maxZoom: 18 // Maximum zoom level for detailed viewing
}).setView([13.4, 121.8], 6); // Centered on Marinduque - center of Philippines

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    preferCanvas: true,
    maxZoom: 18,
    attribution: "© OpenStreetMap contributors",
}).addTo(map);
map.on("zoomend", updateCircleScaleByZoom);

/***********************************************************************
* MASTER VOLUME CONTROL (FIXED - WORKING VERSION)
***********************************************************************/

// Global variable to store current master volume
let currentMasterVolume = parseFloat(localStorage.getItem("quakeMasterVolume")) || 0.8;

// Get the slider element
const masterVolumeSlider = document.getElementById("masterVolume");
masterVolumeSlider.value = currentMasterVolume;

// Apply saved volume to all base audio elements immediately
quakeSound.volume = currentMasterVolume;
quakeNearby.volume = currentMasterVolume;
alarmSound.volume = currentMasterVolume;

let activeSounds = [];

// Real-time volume update
masterVolumeSlider.addEventListener("input", (e) => {
    const newVolume = parseFloat(e.target.value);
    currentMasterVolume = newVolume;
    localStorage.setItem("quakeMasterVolume", newVolume);

    // Update ALL currently playing sounds
    activeSounds.forEach(sound => sound.volume = newVolume);
});

function playQuakeSound(isNearby = false, magnitude = 0) {
    if (!audioUnlocked) return;

    let baseSound;
    if (magnitude >= 5.0) baseSound = alarmSound;
    else if (isNearby) baseSound = quakeNearby;
    else baseSound = quakeSound;

    const clone = baseSound.cloneNode();
    clone.volume = currentMasterVolume;
    clone.play().catch(err => console.warn("Audio play failed:", err));

    // Track active sound
    activeSounds.push(clone);

    // Remove from active list once done
    clone.addEventListener("ended", () => {
        activeSounds = activeSounds.filter(s => s !== clone);
    });
}

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

// STAR ICON HELPERS (for latest earthquake marker)
function starPoints(size, spikes = 5, innerRatio = 0.5) {
    const cx = size / 2;
    const cy = size / 2;
    const outerRadius = size / 2;
    const innerRadius = outerRadius * innerRatio;
    let rot = -Math.PI / 2;
    const step = Math.PI / spikes;
    const pts = [];

    for (let i = 0; i < spikes; i++) {
        pts.push([cx + Math.cos(rot) * outerRadius, cy + Math.sin(rot) * outerRadius]);
        rot += step;
        pts.push([cx + Math.cos(rot) * innerRadius, cy + Math.sin(rot) * innerRadius]);
        rot += step;
    }

    return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

function buildStarSvg(size, fillColor, strokeColor = '#8B0000') {
    const points = starPoints(size);
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <polygon points="${points}" stroke="${strokeColor}" stroke-width="1" fill="${fillColor}" fill-opacity="0.95"/>
  </svg>`;
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

    // Track earthquake location for active fault detection
    trackEarthquakeLocation(ev);

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

    // When placing latest marker
    if (isLatest) {
        const triangle = L.shapeMarker(ev.lat, ev.lon, {
            shape: 'star',
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

                    // Ensure tooltip stays within viewport
                    const rect = tooltip._container.getBoundingClientRect();
                    if (rect.right > window.innerWidth) {
                        tooltip._container.style.left = `${window.innerWidth - rect.width - 10}px`;
                    }
                    if (rect.bottom > window.innerHeight) {
                        tooltip._container.style.top = `${window.innerHeight - rect.height - 10}px`;
                    }
                }

                // If using divIcon SVG, raise its z-index
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

    // Handle both circleMarker and shapeMarker
    if (marker._path) {
        marker._path.classList.add("flash-circle"); // Circle SVG
    } else {
        const el = marker.getElement?.();
        if (el) {
            el.classList.add("flash-circle"); // DivIcon SVG
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

        addNotification(title, message, isAlert, formatDateTime(ev.time), ev.link);

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
 * NOTIFICATION & SOUND - Fixed and consolidated
 ************************************************************************/
// Helper: format time to readable string (example, adjust to your format)
function formatDateTime(iso) {
    try {
        const d = new Date(iso);
        return d.toLocaleString();
    } catch (e) {
        return String(iso);
    }
}

function getDistanceKm(lat1, lon1, lat2, lon2) {
    // Haversine formula
    function toRad(v) { return v * Math.PI / 180; }
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/************************************************************************
 * showNotification - called when a new quake event is processed
 ************************************************************************/
function showNotification(ev, marker) {
    const quakeId = ev.id;

    // Only update UI local notifs if quakeId changed
    if (quakeId !== currentNotificationId) {
        currentNotificationId = quakeId;
        const isAlert = ev.magnitude >= 5.0;
        const title = `Magnitude ${ev.magnitude} Earthquake`;
        const message = `${ev.location} (${ev.depth ?? '?'} km depth)`;

        addNotification(title, message, isAlert, formatDateTime(ev.time), ev.link);
    }

    // Only send desktop/system notification if it's a different quake than last notified
    if (quakeId && quakeId !== lastNotifiedEarthquakeId) {
        console.log('[Notification] NEW EARTHQUAKE - will attempt to notify.');
        console.log('[Notification] Earthquake ID:', quakeId);
        console.log('[Notification] Last notified ID:', lastNotifiedEarthquakeId);
        lastNotifiedEarthquakeId = quakeId;
        sendBrowserNotification(ev, `Magnitude ${ev.magnitude} Earthquake`, `${ev.location}`, ev.magnitude >= 5.0);
    } else {
        console.log('[Notification] Skipping notification (duplicate or no id).');
    }

    // Determine if nearby for sound
    let isNearby = false;
    if (userLocation && ev.lat != null && ev.lon != null) {
        const dist = getDistanceKm(ev.lat, ev.lon, userLocation.lat, userLocation.lon);
        if (dist <= 100) isNearby = true;
    }
    setTimeout(() => playQuakeSound(isNearby, ev.magnitude), 100);
}

/************************************************************************
 * SERVICE WORKER registration (robust)
 ************************************************************************/
async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        console.warn('[Service Worker] Not supported in this browser.');
        return null;
    }

    // Notifications and ServiceWorkers require secure origin (https) unless localhost.
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        console.warn('[Service Worker] Page is not secure (HTTPS). Service workers & notifications may fail.');
    }

    const tryPaths = [
        '/sw.js',
        '/EQMonitor/sw.js',
        './sw.js'
    ];

    for (const p of tryPaths) {
        try {
            console.log(`[Service Worker] Trying to register ${p}`);
            const reg = await navigator.serviceWorker.register(p, { scope: '/' });
            serviceWorkerRegistration = reg;
            console.log('[Service Worker] Registered at:', p, reg);
            setupServiceWorkerListeners(reg);
            return reg;
        } catch (err) {
            console.warn(`[Service Worker] Failed to register ${p}:`, err && err.message ? err.message : err);
        }
    }

    console.error('[Service Worker] All registration attempts failed.');
    return null;
}

function setupServiceWorkerListeners(registration) {
    if (!registration) return;
    registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        console.log('[Service Worker] updatefound, newWorker state:', newWorker && newWorker.state);
        if (newWorker) {
            newWorker.addEventListener('statechange', () => {
                console.log('[Service Worker] New worker state:', newWorker.state);
            });
        }
    });
}

/************************************************************************
 * Request permission helpers (use a real user gesture)
 ************************************************************************/
async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.warn('[Notification] Browser does not support the Notifications API.');
        return false;
    }

    if (Notification.permission === 'granted') {
        notificationPermission = 'granted';
        return true;
    }
    if (Notification.permission === 'denied') {
        notificationPermission = 'denied';
        return false;
    }

    try {
        const permission = await Notification.requestPermission();
        notificationPermission = permission;
        console.log('[Notification] requestPermission result:', permission);
        return permission === 'granted';
    } catch (err) {
        console.error('[Notification] requestPermission error:', err);
        return false;
    }
}

/*
 * Force permission: this attaches to a visible button (user gesture)
 * If you already have a button with id="btnEnableNotifications", it uses that.
 * If not, it creates a small floating button.
 */
function forceNotificationPermission() {
    // If already granted or denied, nothing to do
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') return;
    if (Notification.permission === 'denied') return;

    let btn = document.getElementById('btnEnableNotifications');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'btnEnableNotifications';
        btn.textContent = 'Enable Push Notifications';
        // simple unobtrusive style; you can style via CSS instead
        btn.style.position = 'fixed';
        btn.style.right = '12px';
        btn.style.bottom = '12px';
        btn.style.zIndex = 9999;
        btn.style.padding = '8px 12px';
        btn.style.borderRadius = '8px';
        btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
        document.body.appendChild(btn);
    }

    btn.disabled = false;
    btn.style.opacity = 1;
    btn.addEventListener('click', async function handler(e) {
        btn.disabled = true;
        btn.textContent = 'Requesting...';
        try {
            const ok = await requestNotificationPermission();
            if (ok) {
                btn.textContent = '✓ Notifications Enabled';
                btn.style.background = '#28a745';
                btn.disabled = true;
            } else {
                btn.textContent = 'Notifications Blocked';
                btn.disabled = false;
            }
        } catch (err) {
            console.error('forceNotificationPermission error:', err);
            btn.disabled = false;
            btn.textContent = 'Enable Push Notifications';
        }
        btn.removeEventListener('click', handler);
    }, { once: true });
}

/************************************************************************
 * Create desktop notification (with fallback to service worker)
 ************************************************************************/
async function sendBrowserNotification(ev, title, message, isAlert) {
    if (!('Notification' in window)) {
        console.warn('[Notification] Browser lacks Notification API.');
        return;
    }

    // Always check actual permission
    const currentPermission = Notification.permission;
    if (currentPermission !== 'granted') {
        console.warn('[Notification] Permission not granted:', currentPermission);
        return;
    }
    notificationPermission = 'granted';

    function shortenLocation(loc) {
        if (!loc) return 'Unknown location';

        let shortLoc = loc.replace(/\s+/g, ' ').trim();

        if (shortLoc.toLowerCase().includes(' of ')) {
            shortLoc = shortLoc.split(/\s+of\s+/i).pop().trim();
        }

        // Clean up any tabs or newlines
        shortLoc = shortLoc.replace(/\n|\t/g, ' ').trim();

        // Limit to prevent super long names
        if (shortLoc.length > 90) shortLoc = shortLoc.slice(0, 87) + '...';

        return shortLoc || 'Unknown location';
    }


    const shortLocation = shortenLocation(ev.location);

    // Distance text
    let distanceText = '';
    if (userLocation && ev.lat != null && ev.lon != null) {
        const d = Math.round(getDistanceKm(ev.lat, ev.lon, userLocation.lat, userLocation.lon));
        distanceText = d <= 100 ? `⚠️ NEARBY - ${d} km away` : `${d} km away`;
    }

    const bodyParts = [
        `${ev.depth ?? '?'} km depth`,
        shortLocation,
        distanceText || null,
        `Time: ${formatDateTime(ev.time)}`
    ].filter(Boolean);

    const notificationBody = bodyParts.join('\n');

    // Icon path: adjust if your icon is located elsewhere
    const iconPath = 'https://raw.githubusercontent.com/Goly67/EQMonitor/main/logo.png';

    const notificationOptions = {
        body: notificationBody,
        icon: iconPath,
        badge: iconPath,
        tag: `earthquake-${ev.id}`,
        requireInteraction: !!isAlert,
        vibrate: isAlert ? [200, 100, 200, 100, 200] : [200, 100, 200],
        data: {
            url: window.location.href,
            earthquakeId: ev.id,
            magnitude: ev.magnitude,
            location: ev.location
        }
    };

    try {
        // Primary: direct Notification API (works for desktop)
        const n = new Notification(title, notificationOptions);
        console.log('[Notification] Created via Notification constructor:', n);
        n.onclick = (evt) => {
            evt.preventDefault();
            window.focus();
            try { n.close(); } catch { }
        };
        n.onshow = () => console.log('[Notification] displayed');
        n.onerror = (err) => console.error('[Notification] error', err);

        // Keep reference to avoid immediate GC in some browsers
        window._lastNotification = n;

        // Auto-close non-alerts
        if (!isAlert) {
            setTimeout(() => {
                try { n.close(); } catch (e) { }
            }, 10000);
        }

    } catch (err) {
        console.error('[Notification] Constructor failed, trying service worker fallback:', err);
        // Fallback - show via service worker registration if available
        try {
            if (serviceWorkerRegistration && typeof serviceWorkerRegistration.showNotification === 'function') {
                await serviceWorkerRegistration.showNotification(title, notificationOptions);
                console.log('[Notification] Shown via service worker.');
            } else {
                console.warn('[Notification] No active service worker registration for fallback.');
            }
        } catch (swErr) {
            console.error('[Notification] ServiceWorker fallback failed:', swErr);
        }
    }
}

// ===== PRESENCE TRACKING (viewers online) =====

let presenceSessionRef = null;
let presenceAllRef = null;
let presenceHeartbeat = null;

/**
 * Render the presence list into the panel and update the count button.
 */
function formatPresenceRelativeTime(pastMs) {
    const now = Date.now();
    const diffMs = now - pastMs;
    const diffMins = Math.max(1, Math.round(diffMs / 60000));

    if (diffMins < 60) {
        return diffMins === 1 ? "1 minute" : `${diffMins} minutes`;
    }

    const diffHours = Math.round(diffMins / 60);
    if (diffHours < 24) {
        return diffHours === 1 ? "1 hour" : `${diffHours} hours`;
    }

    const diffDays = Math.round(diffHours / 24);
    return diffDays === 1 ? "1 day" : `${diffDays} days`;
}

/**
 * Render the presence list into the panel and update the count button.
 */
function renderPresence(sessions) {
    const allSessions = sessions || {};

    // Show panel and map markers with location if provided.
    buildPresencePanel(allSessions);
    refreshPresenceMarkers(allSessions);

    if (!presenceCountEl) return;

    const activeCount = Object.keys(allSessions).length;
    presenceCountEl.textContent = activeCount.toString();
}


/**
 * Initialize Firebase presence tracking.
 */
function initPresenceTracking() {
    if (typeof firebase === "undefined" || !firebase.database) {
        console.warn("Firebase not available; presence tracking disabled.");
        return;
    }

    const db = firebase.database();

    // Session record for this viewer
    presenceSessionRef = db.ref("sessions/" + viewerId);
    const now = Date.now();

    // Set initial session data with proper error handling
    presenceSessionRef
        .set({
            firstSeen: now,
            lastSeen: now,
            status: "online",
            displayName: viewerName || "Guest",
            role: isAdmin ? "admin" : "member",
            lat: viewerLocation ? viewerLocation.lat : null,
            lon: viewerLocation ? viewerLocation.lon : null
        })
        .catch((err) => {
            console.error("[Presence] Failed to set initial session data:", err);
            if (err.code === 'PERMISSION_DENIED') {
                console.error('[Presence] Permission denied - check Firebase Rules');
            }
        });

    // Ensure status switches to offline on disconnect with error handling
    presenceSessionRef
        .onDisconnect()
        .update({
            lastSeen: firebase.database.ServerValue.TIMESTAMP,
            status: "offline"
        })
        .catch((err) => {
            console.error("[Presence] Failed to set disconnect handler:", err);
        });

    // Heartbeat to keep lastSeen fresh while the tab is open
    presenceHeartbeat = setInterval(() => {
        const dataUpdate = {
            lastSeen: Date.now(),
            status: "online",
            displayName: viewerName || "Guest",
            role: isAdmin ? "admin" : "member"
        };
        if (viewerLocation) {
            dataUpdate.lat = viewerLocation.lat;
            dataUpdate.lon = viewerLocation.lon;
        }

        presenceSessionRef
            .update(dataUpdate)
            .catch(() => { });
    }, 20000); // 20s

    // Listen to all sessions to update UI in real time
    presenceAllRef = db.ref("sessions");
    presenceAllRef.on("value", (snap) => {
        renderPresence(snap.val() || {});
    });

    // Mark offline on visibility change if needed (extra safety)
    document.addEventListener("visibilitychange", () => {
        if (!presenceSessionRef) return;
        if (document.hidden) {
            presenceSessionRef
                .update({
                    lastSeen: Date.now(),
                    status: "offline"
                })
                .catch(() => { });
        } else {
            presenceSessionRef
                .update({
                    lastSeen: Date.now(),
                    status: "online"
                })
                .catch(() => { });
        }
    });
}

// ===== CLEAN PRESENCE PANEL SYSTEM =====

// Prevent missing elements
if (!presenceBtn || !presencePanel || !presencePanelClose) {
    console.error("Presence panel elements missing.");
}

// OPEN / CLOSE helper
function openPresencePanel() {
    presencePanel.style.display = "flex";

    // Restart animation cleanly
    presencePanel.classList.remove("closing");
    void presencePanel.offsetWidth; // force reflow

    presencePanel.classList.add("active");
}

function closePresencePanel() {
    if (!presencePanel.classList.contains("active")) return;

    // Start closing animation
    presencePanel.classList.remove("active");
    presencePanel.classList.add("closing");

    // Wait for animation to finish before hiding
    const onAnimationEnd = () => {
        presencePanel.style.display = "none";
        presencePanel.classList.remove("closing");
        presencePanel.removeEventListener("animationend", onAnimationEnd);
    };

    presencePanel.addEventListener("animationend", onAnimationEnd);
}

// ===== TOGGLE when clicking the presence button =====
function forceCloseNotificationPanel() {
    if (!notificationPanel.classList.contains("active")) return;

    notificationPanel.classList.remove("active");
    notificationPanel.classList.add("closing");

    const onNotifAnimEnd = () => {
        notificationPanel.style.display = "none";
        notificationPanel.classList.remove("closing");
        notificationPanel.removeEventListener("animationend", onNotifAnimEnd);
    };

    notificationPanel.addEventListener("animationend", onNotifAnimEnd);
}

presenceBtn.addEventListener("click", (e) => {
    e.stopPropagation();

    // Close notifications if open
    forceCloseNotificationPanel();

    if (!presencePanel.classList.contains("active")) {
        openPresencePanel();
    } else {
        closePresencePanel();
    }
});

// ===== Close when clicking X =====
presencePanelClose.addEventListener("click", (e) => {
    e.stopPropagation();
    closePresencePanel();
});

// ===== Prevent clicks inside the panel from closing it =====
presencePanel.addEventListener("click", (e) => {
    e.stopPropagation();
});

// ===== Close when clicking outside =====
document.addEventListener("click", (e) => {
    const clickedOutside =
        !presencePanel.contains(e.target) &&
        !presenceBtn.contains(e.target);

    if (presencePanel.classList.contains("active") && clickedOutside) {
        closePresencePanel();
    }
});

/************************************************************************
 * Initialization - run on page load
 ************************************************************************/
async function initNotificationSystem() {
    // Register worker
    await registerServiceWorker();

    // Sync local var with real permission
    notificationPermission = (typeof Notification !== 'undefined') ? Notification.permission : 'default';
    console.log('[Notification] Current permission at init:', notificationPermission);

    // If not granted, create a visible enable button for user to click
    if (notificationPermission !== 'granted') {
        forceNotificationPermission();
    } else {
        // update UI if you have a button
        const btn = document.getElementById('btnEnableNotifications');
        if (btn) {
            btn.textContent = '✓ Notifications Enabled';
            btn.style.background = '#28a745';
            btn.disabled = true;
        }
        console.log('[Notification] Permission already granted at init.');
    }
}

/************************************************************************
 * Simple placeholder functions used above - replace with your app functions
 ************************************************************************/

window.addEventListener('click', async function handleFirstClick() {
    if (Notification.permission === 'default') {
        console.log('[AutoPermission] Requesting permission after first user gesture...');
        await requestNotificationPermission();
    }
    window.removeEventListener('click', handleFirstClick);
});


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
 * FETCH EVENTS (with cache + Facebook RSS fallback + ForestParty API)
 ************************************************************************/
async function fetchNewEvents() {
    setStatus("Fetching events...");
    const cacheKey = "cachedEarthquakes";
    const cacheTimeKey = "cachedEarthquakesTime";
    const fbFeedUrl = "https://earthquakeapi.forestparty223.workers.dev/api/earthquakes";

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
        } else if (currentSource === "forestparty") {
            url = "https://earthquakeapi.forestparty223.workers.dev/api/earthquakes";
        } else {
            throw new Error("Unknown source selected");
        }

        // ✅ Fetch from the selected source
        const resp = await fetch(url + (url.includes("?") ? "&" : "?") + `t=${Date.now()}`, { cache: "no-store" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();

        // Normalize events based on source
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
        } else if (currentSource === "forestparty") {
            events = json.map(e => {
                let time;
                try {
                    const parts = e.date_time.split(" - ");
                    if (parts.length === 2) {
                        const [dateStr, timeStr] = parts;
                        time = new Date(`${dateStr} ${timeStr}`).toISOString();
                    } else {
                        time = new Date(e.date_time).toISOString();
                    }
                } catch {
                    time = new Date().toISOString();
                }

                let location = (e.location || "Philippines")
                    .replace(/^\d+\s*km\s*/i, "")
                    .replace(/\n|\t/g, " ")
                    .trim()
                    .replace(/\s+/g, " ");

                const id = e.details_link || Math.random().toString(36).substr(2, 9);

                return {
                    id,
                    lat: e.latitude,
                    lon: e.longitude,
                    magnitude: e.magnitude,
                    depth: e.depth_km,
                    time,
                    location,
                    link: e.details_link
                };
            })
                .filter(ev => ev.lat && ev.lon && ev.time && ev.location);

            // --- FILTER ONLY TODAY'S EVENTS ---
            const today = new Date();
            today.setHours(0, 0, 0, 0); // 12:00 AM today
            events = events.filter(ev => new Date(ev.time) >= today);
        }

        if (!events.length) throw new Error("No events received");

        // ✅ Sort newest first
        events.sort((a, b) => new Date(b.time) - new Date(a.time));


        const latest = events[0];
        const isNewQuake = latestEarthquakeId !== latest.id;

        // Animate/sound only if new quake detected
        events.forEach(ev => addOrUpdateEventMarker(
            ev,
            ev.id === latest.id && isNewQuake,
            ev.id === latest.id && isNewQuake
        ));

        latestEarthquakeId = latest.id;

        // ✅ Cache successful result
        localStorage.setItem(cacheKey, JSON.stringify(events));
        localStorage.setItem(cacheTimeKey, Date.now().toString());

        setStatus(`Fetched ${events.length} events — latest: ${latest.location} (M${latest.magnitude})`);

    } catch (e) {
        console.warn("⚠️ Fetch failed:", e.message);
        setStatus("Website down — switching to Facebook fallback...");

        // Fallback: PHIVOLCS Facebook RSS
        try {
            const rssRes = await fetch(fbFeedUrl);
            const rssText = await rssRes.text();
            const parser = new DOMParser();
            const xml = parser.parseFromString(rssText, "text/xml");
            const items = [...xml.querySelectorAll("item")];
            if (!items.length) throw new Error("No Facebook RSS items found");

            const fallbackEvents = items.map((item, index) => {
                const raw = item.querySelector("description")?.textContent || "";
                const cleanText = raw
                    .replace(/<[^>]+>/g, "")
                    .replace(/#\S+/g, "")
                    .replace(/https?:\/\/\S+/g, "")
                    .replace(/\s+/g, " ")
                    .trim();

                const magnitude = parseFloat(cleanText.match(/Magnitude\s*=?\s*([\d.]+)/i)?.[1] || 0);
                const depth = parseFloat(cleanText.match(/Depth\s*=?\s*(\d+)/i)?.[1] || 0);
                const lat = parseFloat(cleanText.match(/Location\s*=\s*([0-9.]+)°\s*[NS]/i)?.[1] || 0);
                const lon = parseFloat(cleanText.match(/,\s*([0-9.]+)°\s*[EW]/i)?.[1] || 0);
                const dateMatch = cleanText.match(/Date and Time:\s*(.+?)(?=Magnitude|$)/i);
                const time = dateMatch ? dateMatch[1].trim() : "Unknown time";
                const locMatch = cleanText.match(/E of (.+?)\)/i);
                const location = locMatch ? locMatch[1].trim() : "Philippines";

                if (lat && lon) return { id: `fb_${index}`, lat, lon, magnitude, depth, time, location, link: null };
                return null;
            }).filter(Boolean);

            if (!fallbackEvents.length) throw new Error("No valid Facebook entries");

            fallbackEvents.sort((a, b) => new Date(b.time) - new Date(a.time));
            const latest = fallbackEvents[0];

            fallbackEvents.forEach(ev => addOrUpdateEventMarker(ev, ev.id === latest.id, ev.id === latest.id));

            latestEarthquakeId = latest.id;
            setStatus(`Fallback: Showing ${fallbackEvents.length} events from Facebook feed`);

            localStorage.setItem(cacheKey, JSON.stringify(fallbackEvents));
            localStorage.setItem(cacheTimeKey, Date.now().toString());

        } catch (fbErr) {
            console.error("❌ Facebook fallback also failed:", fbErr);
            setStatus("All sources unavailable");

            const cached = localStorage.getItem(cacheKey);
            const cachedTime = localStorage.getItem(cacheTimeKey);
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
    // Fixed test location to allow banner to appear after 4 clicks
    const testLat = 12.8797;
    const testLon = 121.7740;
    
    const testEv = {
        id: "TEST_" + Date.now(),
        lat: testLat,
        lon: testLon,
        magnitude: 4 + Math.random() * 3,
        depth: 10 + Math.random() * 50,
        time: new Date().toISOString(),
        location: "Test Active Fault Zone"
    };
    addOrUpdateEventMarker(normalizeEvent(testEv), true);
    console.log("Test earthquake added. Click 4 times total at same location to see Active Fault banner.");
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
                // remove the star/latest marker layer
                map.removeLayer(latestMarker);
            } catch (err) { /* ignore */ }

            const prevData = prev.data;
            // create a normal circle marker to replace the previous latest
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

            // replace in the markers map
            markers.set(prevData.id, { layer: oldCircle, data: prevData });
            latestMarker = null; // we'll set the new latest later
        }
    }

    // Create the marker: star if latest, circle otherwise
    let markerLayer;
    if (isLatest) {
        const size = Math.max(24, Math.round(magToRadius(ev.magnitude) * 2) + 8);
        const svg = buildStarSvg(size, magToColor(ev.magnitude), '#8B0000');

        const icon = L.divIcon({
            className: "star-marker-divicon",
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
                    tooltip._container.style.zIndex = 9999; // tooltip front

                    // Ensure tooltip stays within viewport
                    const rect = tooltip._container.getBoundingClientRect();
                    if (rect.right > window.innerWidth) {
                        tooltip._container.style.left = `${window.innerWidth - rect.width - 10}px`;
                    }
                    if (rect.bottom > window.innerHeight) {
                        tooltip._container.style.top = `${window.innerHeight - rect.height - 10}px`;
                    }
                }

                // If using divIcon SVG, raise its z-index
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

// If already granted before, do NOT show the bottom bar again
const savedPerm = localStorage.getItem('locationPermission');
const savedPref = localStorage.getItem('userLocationPreference');
const locationAlreadyGranted = savedPerm === 'granted' || savedPref === 'allowed';

if (locationAlreadyGranted) {
    // Request current location silently and continue initializing the rest of the script.
    // Do NOT return here — we need the remaining initialization (event listeners, panels, etc.) to run.
    requestLocationPermission(false).catch(err => console.warn('Silent location fetch failed:', err));
}


async function initLocationButton() {
    // If the user already granted geolocation permission (browser-level)
    // or previously allowed it in the app, do not show the footer bar.
    try {
        const storedPerm = localStorage.getItem('locationPermission');
        const storedPref = localStorage.getItem('userLocationPreference');

        if (storedPerm === 'granted' || storedPref === 'allowed') {
            try { await getAndStoreUserLocation(); } catch (e) { /* ignore */ }
            return;
        }

        if (navigator.permissions && navigator.permissions.query) {
            const p = await navigator.permissions.query({ name: 'geolocation' });
            if (p && p.state === 'granted') {
                localStorage.setItem('locationPermission', 'granted');
                localStorage.setItem('userLocationPreference', 'allowed');
                try { await getAndStoreUserLocation(); } catch (e) { /* ignore */ }
                return;
            }
        }
    } catch (err) {
        console.warn('initLocationButton permission check failed', err);
    }

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
      background: linear-gradient(90deg, var(--color-background) 0%, rgba(var(--color-teal-800-rgb, 41, 150, 161), 0.95) 100%);
      border-top: 2px solid #ffffff70;
      color: var(--color-text);
      z-index: 3000;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 14px 10px;
      box-shadow: 0 -4px 16px rgba(0,0,0,0.25);
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
      color: var(--color-text);
    }
    #enableLocationBtn {
      flex-shrink: 0;
      background: rgba(20, 68, 78, 1);
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
      background: rgba(57, 133, 150, 1);
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
    const btn = document.getElementById('enableLocationBtn');
    if (btn) {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            btn.disabled = true;
            btn.textContent = 'Getting location...';
            const success = await requestLocationPermission(true);
            if (success) {
                btn.textContent = 'Location Enabled';
            } else {
                btn.textContent = 'Permission Denied';
                setTimeout(() => { btn.disabled = false; btn.textContent = 'Enable Access'; }, 2000);
            }
        });
    }

}

/************************************************************************
 * Request location (only called after user gesture)
 ************************************************************************/

function hideLocationBar() {
    const bar = document.getElementById('enableLocationBar');
    const btn = document.getElementById('enableLocationBtn');
    if (bar) {
        bar.style.animation = 'slideDown 0.4s ease forwards';
        setTimeout(() => bar.remove(), 400);
    }
    if (btn) btn.style.display = 'none';
}


function getAndStoreUserLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            console.warn("Geolocation not available (silent).");
            resolve(false);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                userLocation = {
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                };
                console.log("✅ Silently obtained location:", userLocation);

                // Persist state so UI logic knows we have permission
                localStorage.setItem("locationPermission", "granted");
                localStorage.setItem("userLocationPreference", "allowed");
                hideLocationBar();

                // Use the canonical marker function (keeps behavior consistent)
                try { addUserMarker(); } catch (err) { console.warn("addUserMarker error:", err); }

                resolve(true);
            },
            (err) => {
                console.warn("Silent location failed:", err);
                localStorage.setItem("locationPermission", "denied");
                resolve(false);
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
        );
    });
}

// Helper to request location with user gesture
// Helper to request location with user gesture
function requestLocationPermission() {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      showCustomAlert("Geolocation is not supported by this browser.");
      return resolve(false);
    }

    // --- REMOVE OR COMMENT OUT THIS BLOCK ---
    // if (location.protocol !== "https:" && location.hostname !== "localhost") {
    //   showCustomAlert("Location access requires HTTPS. Please use a secure https site.");
    //   return resolve(false);
    // }
    // ----------------------------------------

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLocation = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };

        localStorage.setItem("userLocation", JSON.stringify(userLocation));
        localStorage.setItem("locationPermission", "granted");
        localStorage.setItem("userLocationPreference", "allowed");

        // Use optional chaining just in case function is missing
        if (typeof hideLocationBar === 'function') hideLocationBar();
        if (typeof addUserMarker === 'function') addUserMarker();
        
        resolve(true);
      },
      (err) => {
        console.warn("Location error:", err); // Added for debugging
        localStorage.setItem("locationPermission", "denied");
        
        // Optional: Show alert if it actually fails
        // showCustomAlert("Location access denied or error occurred."); 
        
        resolve(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  });
}


// Hide location bar/button
function hideLocationBar() {
    const bar = document.getElementById('enableLocationBar');
    const btn = document.getElementById('enableLocationBtn');
    if (bar) {
        bar.style.animation = 'slideDown 0.4s ease forwards';
        setTimeout(() => bar.remove(), 400);
    }
    if (btn) btn.style.display = 'none';
}

// Store and add user marker
function getAndStoreUserLocation() {
    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                userLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
                localStorage.setItem('userLocation', JSON.stringify(userLocation));
                hideLocationBar();
                addUserMarker();
                resolve(true);
            },
            (err) => {
                console.warn("Silent location failed:", err);
                localStorage.setItem('locationPermission', 'denied');
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
    if (!userLocation || !map) return;
    if (userMarker) map.removeLayer(userMarker);
    const pulsingIcon = L.divIcon({
        className: 'user-location-marker',
        html: '<div class="pulse-ring"></div><div class="user-dot"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
    userMarker = L.marker([userLocation.lat, userLocation.lon], { icon: pulsingIcon })
        .addTo(map)
        .bindPopup('You are here').openPopup();
    map.setView([userLocation.lat, userLocation.lon], 7);
}

// ==========================================
// 📍 FINAL FIXED LOCATION LOGIC
// ==========================================

// If we have persisted coords, use them immediately to show the marker and hide prompts
const savedLocJSON = localStorage.getItem('userLocation');
if (savedLocJSON) {
    try {
        const parsed = JSON.parse(savedLocJSON);
        if (parsed && parsed.lat && parsed.lon) {
            userLocation = parsed;
            // create marker if not already
            if (!userMarker) {
                const pulsingIcon = L.divIcon({
                    className: 'user-location-marker',
                    html: '<div class="pulse-ring"></div><div class="user-dot"></div>',
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                });
                userMarker = L.marker([userLocation.lat, userLocation.lon], { icon: pulsingIcon }).addTo(map);
                userMarker.bindPopup('Your Location');
            } else {
                userMarker.setLatLng([userLocation.lat, userLocation.lon]);
            }

            // Hide/remove any UI prompts
            document.getElementById('enableLocationBar')?.remove();
            const footerBtn = document.getElementById('enableLocationBtn');
            if (footerBtn) footerBtn.style.display = 'none';
        }
    } catch (e) {
        console.warn('Invalid saved userLocation JSON', e);
    }
}

function initLocationFeature() {
    const footerBtn = document.getElementById('enableLocationBtn');
    const savedStatus = localStorage.getItem('userLocationPreference');
    const savedPerm = localStorage.getItem('locationPermission');
    const savedPref = localStorage.getItem('userLocationPreference');
    if (savedPerm === 'granted' && savedPref === 'allowed') {
        const savedLocJSON = localStorage.getItem('userLocation');
        if (savedLocJSON) {
            try {
                userLocation = JSON.parse(savedLocJSON);
                addUserMarker();
                hideLocationBar();
            } catch (e) {
                console.warn("Invalid saved location:", e);
            }
        } else {
            getAndStoreUserLocation();
        }
    }

    // 1. If user previously ALLOWED it, load it silently.
    if (savedStatus === 'allowed') {
        if (footerBtn) footerBtn.style.display = 'none'; // Hide button immediately
        fetchUserLocation(); // Get location
    }
    // 2. If NOT allowed yet, just listen for the click. DO NOT ASK AUTOMATICALLY.
    else {
        if (footerBtn) {
            footerBtn.style.display = 'flex'; // Ensure button is visible

            // Remove old listeners to prevent duplicates (cloning trick)
            const newBtn = footerBtn.cloneNode(true);
            footerBtn.parentNode.replaceChild(newBtn, footerBtn);

            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                askForLocationPermission();
            });
        }
    }
}

function askForLocationPermission() {
  showCustomAlert(
    "Enable location to see your position on the map relative to earthquakes.",
    async () => {
      // OK click is a user gesture, so geolocation permission prompt is allowed here
      localStorage.setItem("userLocationPreference", "allowed");

      const ok = await requestLocationPermission(true); // forceAsk = true
      if (!ok) {
        // Allow retry later if user cancels/denies
        localStorage.removeItem("userLocationPreference");
        localStorage.setItem("locationPermission", "denied");
      }
    }
  );
}

function fetchUserLocation() {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
        (position) => {
            // store canonical userLocation object
            userLocation = {
                lat: position.coords.latitude,
                lon: position.coords.longitude,
                accuracy: position.coords.accuracy
            };

            // persist state
            localStorage.setItem("locationPermission", "granted");
            localStorage.setItem("userLocationPreference", "allowed");

            // create/update marker using the already-tested addUserMarker()
            try { addUserMarker(); } catch (err) {
                console.warn("addUserMarker failed; falling back to simple marker:", err);
                if (userMarker) { userMarker.setLatLng([userLocation.lat, userLocation.lon]); }
                else { userMarker = L.marker([userLocation.lat, userLocation.lon]).addTo(map); }
            }

            // hide the footer/enable button if present
            const footerBtn = document.getElementById('enableLocationBtn');
            if (footerBtn) footerBtn.style.display = 'none';
        },
        (error) => {
            console.warn("Location denied or failed:", error);
            const footerBtn = document.getElementById('enableLocationBtn');
            if (footerBtn) footerBtn.style.display = 'flex';
            localStorage.removeItem('userLocationPreference'); // allow retry
            localStorage.setItem('locationPermission', 'denied');
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
}

// Initialize when map is ready
document.addEventListener('DOMContentLoaded', initLocationFeature);

/************************************************************
 * LEGEND: Slide-hide + Toggle button + Confirm notif
 ************************************************************/

// Storage key so the user's preference persists
const LEGEND_COLLAPSE_KEY = "legendCollapsed_v1";

// Inject styles once
function injectLegendToggleStyles() {
    if (document.getElementById("legendToggleStyles")) return;

    const style = document.createElement("style");
    style.id = "legendToggleStyles";
    style.textContent = `
    .legend-wrap {
      position: relative;
      overflow: visible !important;
      transform: translateX(0);
      transition: transform 220ms ease;
      will-change: transform;
    }

    /* Slide left so only the button stays visible */
    .legend-wrap.legend-collapsed {
      transform: translateX(calc(-100% + 0px));
    }

    .legend-toggle-btn {
      position: absolute;
      top: 5px;
      right: -42px;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(0,0,0,0.55);
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      line-height: 1;
      box-shadow: 0 6px 18px rgba(0,0,0,0.25);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      user-select: none;
    }

    .legend-toggle-btn:active {
      transform: scale(0.96);
    }

    @media (max-width: 768px) {
      .legend-toggle-btn {
        width: 40px;
        height: 40px;
        right: -44px;
        border-radius: 12px;
        font-size: 20px;
      }
      .legend-wrap.legend-collapsed {
        transform: translateX(calc(-100% + 2px));
      }
    }
  `;
    document.head.appendChild(style);
}

injectLegendToggleStyles();

// Add Responsive Legend (WITH TOGGLE)
const legend = L.control({ position: "topleft" });

legend.onAdd = function (map) {
    const div = L.DomUtil.create("div", "info legend");
    div.classList.add("legend-wrap");

    // Prevent map dragging/zoom when interacting with legend
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);

    const grades = [0, 3, 4, 5, 6, 7];
    const colors = ["#FEB24C", "#FD8D3C", "#FC4E2A", "#E31A1C", "#BD0026", "#800026"];

    // Responsive sizing
    const isMobile = window.innerWidth <= 768;
    const fontSize = isMobile ? "0.75rem" : "0.85rem";

    // Icon sizes
    const iconSize = isMobile ? 22 : 18;
    const starIconSize = isMobile ? iconSize + 4 : iconSize;

    // Spacing
    const rowGap = isMobile ? 7 : 5;
    const headerGap = isMobile ? 10 : 6;

    const padding = isMobile ? "10px 12px" : "10px 14px";
    const maxHeight = isMobile ? "auto" : "auto";
    const maxWidth = isMobile ? "55vw" : "220px";

    div.style.background = "var(--color-surface)";
    div.style.padding = padding;
    div.style.borderRadius = "8px";
    div.style.boxShadow = "0 0 15px rgba(0,0,0,0.2)";
    div.style.fontSize = fontSize;
    div.style.lineHeight = "1.25";
    div.style.color = "var(--color-text)";
    div.style.maxWidth = maxWidth;
    div.style.maxHeight = maxHeight;
    div.style.overflowY = "visible";
    div.style.marginBottom = isMobile ? "15px" : "0";
    div.style.marginRight = isMobile ? "10px" : "0";
    div.style.position = "relative";

    // Content
    div.innerHTML = `<div style="font-weight:700; margin-bottom:${headerGap}px;">Magnitude</div>`;

    for (let i = 0; i < grades.length; i++) {
        div.innerHTML += `
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:${rowGap}px;">
        <i style="
          background:${colors[i]};
          width:${iconSize}px;
          height:${iconSize}px;
          display:inline-block;
          border-radius:50%;
          flex:0 0 auto;
        "></i>
        <span style="line-height:1;">${grades[i]}${grades[i + 1] ? "&ndash;" + grades[i + 1] : "+"}</span>
      </div>
    `;
    }

    // Add "Latest Earthquake" entry inside the card
    div.innerHTML += `
    <div style="display:flex; align-items:center; gap:10px; margin-top:${headerGap}px;">
      <i style="
        background:#ff6666;
        width:${starIconSize}px;
        height:${starIconSize}px;
        display:inline-block;
        clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
        flex:0 0 auto;
      "></i>
      <span style="line-height:1;">Latest Earthquake</span>
    </div>
  `;

    // Toggle button
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "legend-toggle-btn";

    function applyLegendState(collapsed) {
        if (collapsed) {
            div.classList.add("legend-collapsed");
            toggleBtn.innerHTML = "›"; // show (slide right)
            toggleBtn.title = "Show legend";
        } else {
            div.classList.remove("legend-collapsed");
            toggleBtn.innerHTML = "‹"; // hide (slide left)
            toggleBtn.title = "Hide legend";
        }
    }

    const initialCollapsed = localStorage.getItem(LEGEND_COLLAPSE_KEY) === "1";
    applyLegendState(initialCollapsed);

    toggleBtn.addEventListener("click", (e) => {
        L.DomEvent.stop(e);

        const isCollapsedNow = div.classList.contains("legend-collapsed");
        const nextCollapsed = !isCollapsedNow;

        localStorage.setItem(LEGEND_COLLAPSE_KEY, nextCollapsed ? "1" : "0");
        applyLegendState(nextCollapsed);
    });

    div.appendChild(toggleBtn);
    return div;
};

legend.addTo(map);

// Update on resize to stay responsive (rebuild legend UI)
window.addEventListener("resize", () => {
    legend.remove();
    legend.addTo(map);
});

function isMobileOrApple() {
    return true;
}

window.addEventListener("click", async function handleFirstClick() {
    if (Notification.permission === "default") {
        await requestNotificationPermission();
    }
    window.removeEventListener("click", handleFirstClick);
});

let deferredPrompt = null;

/**
 * Close modal with closing animation
 */
function closeModalWithAnimation(card) {
    if (!card) return;
    
    // Add closing class to trigger animation
    card.classList.add("closing");
    
    // Remove after animation completes (300ms)
    setTimeout(() => {
        card.classList.remove("closing");
        card.classList.remove("active");
    }, 300);
}

function initPWAInstallCard() {
    const card = document.getElementById("pwaInstallCard");
    const installBtn = document.getElementById("pwaInstallBtn");
    const laterBtn = document.getElementById("pwaInstallLater");

    if (!card || !installBtn || !laterBtn) return;

    // 1. Force-show on mobile
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;

    if (isMobile && !isStandalone) {
        card.classList.add("active");
        installBtn.textContent = "Checking compatibility...";
        installBtn.disabled = true;

        // FIX: Don't wait forever. If browser is silent (iOS/Simulator), enable button anyway.
        setTimeout(() => {
            if (!deferredPrompt) {
                installBtn.disabled = false;
                installBtn.textContent = "Install App";
            }
        }, 2000); // Wait 2 seconds max
    }

    // 2. Listen for "Real" Install Prompt (Android/Chrome)
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredPrompt = e;
        card.classList.add("active");
        installBtn.disabled = false;
        installBtn.textContent = "Install App";
    });

    // 3. Handle Click
    installBtn.addEventListener("click", async (e) => {
        e.stopPropagation();

        // If we have the native prompt (Android/Desktop Chrome)
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                closeModalWithAnimation(card);
            }
            deferredPrompt = null;
            return;
        }

        // If NO prompt (iOS or Simulator), show manual instructions
        showCustomAlert(
            "To install this app:\n\n" +
            "📱 iOS (Safari): Tap 'Share' button → 'Add to Home Screen'\n"
        );
    });

    laterBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeModalWithAnimation(card);
    });
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('SW Registered!', reg))
        .catch(err => console.error('SW Failed:', err));
}


/************************************************************************
 * INIT
 ************************************************************************/
(function init() {
    currentRange = getDateRange("today");
    limitMarkers();
    // Only show location bar if permission was not already granted
    if (!locationAlreadyGranted) {
        initLocationButton();
    }
    initNotificationSystem(); // Initialize push notifications
    initPresenceTracking();
    initPWAInstallCard(); // Initialize PWA install modal
    fetchNewEvents(); // initial load

    // No SSE — just use regular polling
    console.log("[EarthquakeMonitor] Using polling for updates");
    startPolling();

})();

console.log('[Init] Notifications array initialized');

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

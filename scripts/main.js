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

// Admin auth — verified server-side via Firebase Auth + RTDB rules
const OWNER_EMAIL = 'tifys587@gmail.com';
const ADMIN_EMAILS = [OWNER_EMAIL];
const btnAdminLogin = document.getElementById('btnAdminLogin');
const btnAdminLogout = document.getElementById('btnAdminLogout');
const adminSection = document.getElementById('adminSection');
const announcementInput = document.getElementById('announcementInput');
const btnPostAnnouncement = document.getElementById('btnPostAnnouncement');
const btnRemoveAnnouncement = document.getElementById('btnRemoveAnnouncement');
const adminAnnouncementBanner = document.getElementById('adminAnnouncementBanner');
const adminAnnouncementMessage = document.getElementById('adminAnnouncementMessage');
const adminNoticeToast = document.getElementById('adminNoticeToast');
const adminNoticeIcon = document.getElementById('adminNoticeIcon');
const adminNoticeMessage = document.getElementById('adminNoticeMessage');
let adminNoticeTimer = null;

function isAdminUser(user) {
    return !!(user && user.email && ADMIN_EMAILS.includes(user.email));
}

function showAdminNotice(message, type = "success") {
    if (!adminNoticeToast || !adminNoticeMessage) return;

    clearTimeout(adminNoticeTimer);
    adminNoticeToast.hidden = false;
    adminNoticeToast.classList.remove("show", "success", "error", "warning");
    adminNoticeToast.classList.add(type);
    adminNoticeMessage.textContent = message;
    if (adminNoticeIcon) {
        adminNoticeIcon.textContent = type === "error"
            ? "error"
            : type === "warning"
                ? "warning"
                : "check_circle";
    }

    requestAnimationFrame(() => adminNoticeToast.classList.add("show"));
    adminNoticeTimer = setTimeout(() => {
        adminNoticeToast.classList.remove("show");
        setTimeout(() => {
            adminNoticeToast.hidden = true;
        }, 220);
    }, 3200);
}

function updateAnnouncementBannerHeight() {
    if (!adminAnnouncementBanner || adminAnnouncementBanner.hidden) {
        document.documentElement.style.setProperty('--announcement-banner-height', '0px');
    } else {
        document.documentElement.style.setProperty('--announcement-banner-height', `${adminAnnouncementBanner.offsetHeight}px`);
    }
    if (typeof map !== 'undefined' && map) {
        map.invalidateSize();
    }
}

function updateAdminUI(user) {
    isAdmin = isAdminUser(user);

    if (btnAdminLogin) btnAdminLogin.hidden = isAdmin;
    if (btnAdminLogout) btnAdminLogout.hidden = !isAdmin;
    if (adminSection) adminSection.hidden = !isAdmin;

    if (isAdmin) {
        viewerName = "Admin (" + (user?.email || OWNER_EMAIL) + ")";
    } else {
        localStorage.removeItem("isAdmin");
        localStorage.removeItem("adminLoginTime");
        if (!user) viewerName = localStorage.getItem("viewerName") || "Guest";
    }

    updateLastSeenOnly();
    sessionsRef.once('value', snap => {
        const sessions = snap.val() || {};
        buildPresencePanel(sessions);
        refreshPresenceMarkers(sessions);
    });
}

function initAdminAuth() {
    if (!firebase.auth) {
        console.warn("Firebase Auth not available.");
        return;
    }

    btnAdminLogin?.addEventListener('click', () => {
        const googleProvider = new firebase.auth.GoogleAuthProvider();
        googleProvider.setCustomParameters({ prompt: 'select_account' });
        googleProvider.addScope('email');
        firebase.auth().signInWithPopup(googleProvider).catch((error) => {
            console.error("Sign in failed:", error);
            showAdminNotice("Sign in failed. Please try again.", "error");
        });
    });

    btnAdminLogout?.addEventListener('click', () => {
        firebase.auth().signOut();
    });

    firebase.auth().onAuthStateChanged((user) => {
        if (user && !isAdminUser(user)) {
            showAdminNotice("Not authorized for admin access.", "error");
            firebase.auth().signOut();
            return;
        }
        updateAdminUI(user);
    });
}

async function ensureAdminAuthToken() {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error("NOT_SIGNED_IN");
    if (!isAdminUser(user)) throw new Error("NOT_ADMIN");
    await user.getIdToken(true);
    return user;
}

async function postAnnouncement() {
    const text = announcementInput?.value.trim();
    if (!text) {
        showAdminNotice("Please enter an announcement message.", "warning");
        announcementInput?.focus();
        return;
    }

    try {
        const user = await ensureAdminAuthToken();
        await firebase.database().ref("announcements/current").set({
            text,
            author: user.displayName || "Admin",
            authorEmail: user.email,
            updatedAt: firebase.database.ServerValue.TIMESTAMP,
            active: true
        });
        announcementInput.value = "";
        showAdminNotice("Announcement posted.", "success");
    } catch (err) {
        console.error("Failed to post announcement:", err);
        if (err.message === "NOT_SIGNED_IN") {
            showAdminNotice("Please click Admin Login and sign in first.", "warning");
        } else if (err.message === "NOT_ADMIN") {
            showAdminNotice("Only the site owner can post announcements.", "error");
        } else if (err.code === "PERMISSION_DENIED") {
            showAdminNotice("Permission denied. Check Firebase database rules.", "error");
        } else {
            showAdminNotice("Failed to post announcement. Please try again.", "error");
        }
    }
}

async function removeAnnouncement() {
    try {
        await ensureAdminAuthToken();
        await firebase.database().ref("announcements/current").remove();
        if (announcementInput) announcementInput.value = "";
        showAdminNotice("Announcement removed.", "success");
    } catch (err) {
        console.error("Failed to remove announcement:", err);
        if (err.message === "NOT_SIGNED_IN") {
            showAdminNotice("Please click Admin Login and sign in first.", "warning");
        } else if (err.code === "PERMISSION_DENIED") {
            showAdminNotice("Permission denied. Check Firebase database rules.", "error");
        } else {
            showAdminNotice("Failed to remove announcement. Please try again.", "error");
        }
    }
}

function initAnnouncements() {
    if (!firebase.database) return;

    firebase.database().ref("announcements/current").on("value", (snap) => {
        const data = snap.val();
        const show = !!(data && data.active && data.text);

        if (adminAnnouncementBanner) {
            adminAnnouncementBanner.hidden = !show;
        }
        if (adminAnnouncementMessage) {
            adminAnnouncementMessage.textContent = show ? data.text : "";
        }
        if (show && announcementInput && isAdmin && !announcementInput.value) {
            announcementInput.value = data.text;
        }

        requestAnimationFrame(updateAnnouncementBannerHeight);
    });

    btnPostAnnouncement?.addEventListener('click', postAnnouncement);
    btnRemoveAnnouncement?.addEventListener('click', removeAnnouncement);
}

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
let isAdmin = false;
const PRESENCE_SESSION_TIMEOUT_MS = 60 * 1000;
const PRESENCE_AREA_RADIUS_METERS = 28000;
const PRESENCE_PANEL_DATE_FORMAT = {
    month: "short",
    day: "numeric",
    year: "numeric"
};
const PRESENCE_REGIONS = [
    { key: "ncr", name: "Metro Manila", center: [14.5995, 120.9842], bounds: [14.35, 120.85, 14.85, 121.15] },
    { key: "car", name: "Cordillera Administrative Region", center: [16.4023, 120.5960], bounds: [15.6, 120.3, 18.0, 121.4] },
    { key: "ilocos", name: "Ilocos Region", center: [16.0832, 120.6199], bounds: [15.6, 119.7, 18.7, 121.2] },
    { key: "cagayan-valley", name: "Cagayan Valley", center: [17.6132, 121.7270], bounds: [15.8, 121.0, 20.0, 122.7] },
    { key: "central-luzon", name: "Central Luzon", center: [15.4828, 120.7120], bounds: [14.7, 119.7, 16.2, 121.4] },
    { key: "calabarzon", name: "CALABARZON", center: [14.1008, 121.0794], bounds: [13.4, 120.4, 14.8, 122.4] },
    { key: "mimaropa", name: "MIMAROPA", center: [12.6074, 120.9842], bounds: [9.0, 117.0, 14.1, 122.2] },
    { key: "bicol", name: "Bicol Region", center: [13.4200, 123.4137], bounds: [12.0, 122.3, 14.4, 124.5] },
    { key: "western-visayas", name: "Western Visayas", center: [11.0050, 122.5373], bounds: [9.8, 121.6, 12.4, 123.7] },
    { key: "central-visayas", name: "Central Visayas", center: [10.3157, 123.8854], bounds: [9.0, 123.0, 11.3, 124.5] },
    { key: "eastern-visayas", name: "Eastern Visayas", center: [11.2448, 125.0388], bounds: [9.8, 124.0, 12.9, 126.0] },
    { key: "zamboanga-peninsula", name: "Zamboanga Peninsula", center: [7.8383, 123.2967], bounds: [6.5, 121.8, 8.8, 123.9] },
    { key: "northern-mindanao", name: "Northern Mindanao", center: [8.0202, 124.6857], bounds: [7.4, 123.5, 9.3, 125.7] },
    { key: "davao", name: "Davao Region", center: [7.1907, 125.4553], bounds: [5.8, 125.0, 8.2, 126.6] },
    { key: "soccsksargen", name: "SOCCSKSARGEN", center: [6.2707, 124.6857], bounds: [5.2, 123.4, 7.4, 125.4] },
    { key: "caraga", name: "Caraga", center: [8.8015, 125.7407], bounds: [7.7, 125.2, 10.2, 126.7] },
    { key: "barmm", name: "BARMM", center: [6.9568, 124.2422], bounds: [4.5, 119.0, 8.0, 125.3] }
];

// Unique viewer id persisted per browser
let viewerId = localStorage.getItem("viewerId");
if (!viewerId) {
    viewerId = crypto.randomUUID();
    localStorage.setItem("viewerId", viewerId);
}

let viewerName = "Guest";
localStorage.setItem("viewerName", viewerName);

let viewerLocation = null;

function getActivePresenceEntries(sessions) {
    const cutoff = Date.now() - PRESENCE_SESSION_TIMEOUT_MS;
    return Object.entries(sessions || {}).filter(([, s]) => {
        if (!s || s.status === "offline") return false;
        return !s.lastSeen || s.lastSeen >= cutoff;
    });
}

function getPresenceViewingText(count) {
    return count === 1 ? "1 person is viewing" : `${count} people are viewing`;
}

function getPresenceAreaViewingText(count) {
    return count === 1
        ? "1 person is viewing in this city or region"
        : `${count} people are viewing in this city or region`;
}

function isInRegionBounds(lat, lon, region) {
    const [south, west, north, east] = region.bounds;
    return lat >= south && lat <= north && lon >= west && lon <= east;
}

function getRegionDistanceScore(lat, lon, region) {
    const [regionLat, regionLon] = region.center;
    const latDiff = lat - regionLat;
    const lonDiff = lon - regionLon;
    return latDiff * latDiff + lonDiff * lonDiff;
}

function getNearestPresenceRegion(lat, lon) {
    const numericLat = Number(lat);
    const numericLon = Number(lon);
    if (!Number.isFinite(numericLat) || !Number.isFinite(numericLon)) return null;

    const matchingRegions = PRESENCE_REGIONS.filter(region => isInRegionBounds(numericLat, numericLon, region));
    if (matchingRegions.length === 0) return null;

    return matchingRegions.reduce((nearest, region) => {
        if (!nearest) return region;
        return getRegionDistanceScore(numericLat, numericLon, region) < getRegionDistanceScore(numericLat, numericLon, nearest)
            ? region
            : nearest;
    }, null);
}

function getPresenceAreaFromRegion(region) {
    if (!region) return null;

    return {
        areaLat: region.center[0],
        areaLon: region.center[1],
        areaKey: region.key,
        areaName: region.name
    };
}

function getPresenceAreaFromCoords(lat, lon) {
    const region = getNearestPresenceRegion(lat, lon);
    return getPresenceAreaFromRegion(region);
}

function getPresenceAreaFromSession(session) {
    if (!session) return null;

    if (session.areaKey) {
        const matchingRegion = PRESENCE_REGIONS.find(region => region.key === session.areaKey);
        if (matchingRegion) return getPresenceAreaFromRegion(matchingRegion);
    }

    if (session.areaLat != null && session.areaLon != null) {
        return getPresenceAreaFromCoords(session.areaLat, session.areaLon);
    }

    if (session.lat != null && session.lon != null) {
        return getPresenceAreaFromCoords(session.lat, session.lon);
    }

    return null;
}

function getPresenceAreaFields() {
    if (!viewerLocation) {
        return { areaLat: null, areaLon: null, areaKey: null, areaName: null, lat: null, lon: null };
    }

    return {
        areaLat: viewerLocation.areaLat,
        areaLon: viewerLocation.areaLon,
        areaKey: viewerLocation.areaKey,
        areaName: viewerLocation.areaName,
        lat: null,
        lon: null
    };
}

function getPresenceMap() {
    try {
        return map || null;
    } catch {
        return null;
    }
}

function updatePresenceAreaFromSavedLocation() {
    try {
        const savedLocation = JSON.parse(localStorage.getItem("userLocation") || "null");
        if (!savedLocation || savedLocation.lat == null || savedLocation.lon == null) return false;
        const savedLat = Number(savedLocation.lat);
        const savedLon = Number(savedLocation.lon);
        if (!Number.isFinite(savedLat) || !Number.isFinite(savedLon)) return false;
        updateMySession(savedLat, savedLon);
        return true;
    } catch {
        return false;
    }
}

function getPresenceSessionRef() {
    try {
        return presenceSessionRef || sessionsRef.child(viewerId);
    } catch {
        return sessionsRef.child(viewerId);
    }
}

function ensurePresencePrivacyStyles() {
    if (document.getElementById("presencePrivacyStyles")) return;

    const style = document.createElement("style");
    style.id = "presencePrivacyStyles";
    style.textContent = `
        .presence-btn.has-viewers {
            border: 2px solid var(--color-success, #21808d);
            box-shadow: 0 0 0 3px rgba(33, 128, 141, 0.18), 0 4px 12px rgba(0, 0, 0, 0.22);
        }

        .leaflet-interactive.presence-area-border {
            cursor: help;
            filter: drop-shadow(0 0 6px rgba(33, 128, 141, 0.35));
        }

        .leaflet-tooltip.presence-area-tooltip {
            border: 1px solid rgba(33, 128, 141, 0.45);
            border-radius: 8px;
            padding: 6px 9px;
            color: #172526;
            background: rgba(255, 255, 255, 0.96);
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
            font-size: 12px;
            font-weight: 700;
        }

    `;
    document.head.appendChild(style);
}

function updatePresenceButton(count) {
    if (!presenceBtn) return;

    ensurePresencePrivacyStyles();

    const viewingText = getPresenceViewingText(count);
    presenceBtn.classList.toggle("has-viewers", count > 0);
    presenceBtn.title = viewingText;
    presenceBtn.setAttribute("aria-label", viewingText);

    const labelEl = presenceBtn.querySelector(".presence-label");
    if (labelEl) labelEl.remove();

    if (presenceCountEl) {
        presenceCountEl.textContent = count.toString();
    }
}

function formatPresencePanelDate(timestamp) {
    const numericTimestamp = Number(timestamp);
    const date = Number.isFinite(numericTimestamp) ? new Date(numericTimestamp) : new Date();
    return date.toLocaleDateString(undefined, PRESENCE_PANEL_DATE_FORMAT);
}

function buildPresencePanel(sessions) {
    const allEntries = getActivePresenceEntries(sessions);
    const activeCount = allEntries.length;

    if (activeCount === 0) {
        presencePanelContent.innerHTML = '<div class="presence-panel-empty">No one is viewing right now.</div>';
        return;
    }

    const presenceNow = Date.now();
    // Sort entries by firstSeen descending (newest users first)
    const privacySortedEntries = allEntries.sort((a, b) => (b[1].firstSeen || 0) - (a[1].firstSeen || 0));
    let anonymousViewerNumber = 1;
    const privacyRows = privacySortedEntries.map(([id, s]) => {
        const lastSeenMs = Number.isFinite(Number(s.lastSeen)) ? Number(s.lastSeen) : presenceNow;
        const ageSec = Math.max(0, Math.floor((presenceNow - lastSeenMs) / 1000));
        const dateText = formatPresencePanelDate(lastSeenMs);
        const isSelf = id === viewerId;
        const name = isSelf ? "You" : `Person ${anonymousViewerNumber++}`;
        return `<div class="presence-item${isSelf ? " presence-self" : ""}"><strong>${name}</strong> &middot; ${dateText} &middot; active ${ageSec}s ago</div>`;
    });

    presencePanelContent.innerHTML = privacyRows.join("");
    return;
}

function refreshPresenceMarkers(sessions) {
    presenceMarkers.forEach(marker => {
        if (marker && typeof marker.remove === "function") {
            marker.remove();
        }
    });
    presenceMarkers.clear();

    const activeEntries = getActivePresenceEntries(sessions);
    const viewerAreas = new Map();
    activeEntries.forEach(([, session]) => {
        const area = getPresenceAreaFromSession(session);
        if (!area) return;

        const existing = viewerAreas.get(area.areaKey) || {
            count: 0,
            areaLat: area.areaLat,
            areaLon: area.areaLon,
            areaName: area.areaName
        };
        existing.count += 1;
        viewerAreas.set(area.areaKey, existing);
    });

    if (typeof L === "undefined") return;

    const presenceMap = getPresenceMap();
    if (!presenceMap) return;

    if (viewerAreas.size === 0) return;

    viewerAreas.forEach((area, areaKey) => {
        const border = L.circle([area.areaLat, area.areaLon], {
            radius: PRESENCE_AREA_RADIUS_METERS,
            color: "#21808d",
            weight: 3,
            opacity: 0.95,
            fill: true,
            fillColor: "#21808d",
            fillOpacity: 0.045,
            interactive: true,
            className: "presence-area-border"
        }).addTo(presenceMap);

        border.bindTooltip(getPresenceAreaViewingText(area.count), {
            direction: "top",
            sticky: true,
            opacity: 1,
            className: "presence-area-tooltip"
        });

        presenceMarkers.set(areaKey, border);
    });
}

function updateMySession(lat, lon) {
    viewerLocation = getPresenceAreaFromCoords(lat, lon);
    const areaFields = getPresenceAreaFields();
    const sessionData = {
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        status: "online",
        displayName: viewerName || "Guest",
        role: isAdmin ? "admin" : "member",
        ...areaFields
    };

    const targetRef = getPresenceSessionRef();
    targetRef.set(sessionData).catch(err => console.error("Failed updating session", err));
}

function updateLastSeenOnly() {
    const areaFields = getPresenceAreaFields();
    const updates = {
        lastSeen: Date.now(),
        displayName: viewerName || "Guest",
        status: "online",
        role: isAdmin ? "admin" : "member",
        ...areaFields
    };

    const targetRef = getPresenceSessionRef();
    targetRef.update(updates).catch(err => console.error("Failed updating last seen", err));
}

// Presence listener + viewer count
sessionsRef.on("value", snap => {
    const sessions = snap.val() || {};
    const now = Date.now();
    const cutoff = now - PRESENCE_SESSION_TIMEOUT_MS;

    const activeSessions = {};
    Object.entries(sessions).forEach(([id, s]) => {
        if ((s.lastSeen || 0) < cutoff) {
            sessionsRef.child(id).remove();
            return;
        }
        activeSessions[id] = s;
    });

    const activeCount = Object.keys(activeSessions).length;
    updatePresenceButton(activeCount);

    buildPresencePanel(activeSessions);
    refreshPresenceMarkers(activeSessions);
});

// Regular heartbeat for our own session
setInterval(() => {
    updateLastSeenOnly();
}, 20 * 1000);

// Remove session on unload
window.addEventListener("beforeunload", () => {
    sessionsRef.child(viewerId).remove();
});

function startPresenceAreaTracking() {
    const usedSavedLocation = updatePresenceAreaFromSavedLocation();

    if (!navigator.geolocation) {
        console.warn("Geolocation not supported; presence area border disabled.");
        if (!usedSavedLocation) updateLastSeenOnly();
        return;
    }

    navigator.geolocation.watchPosition(position => {
        updateMySession(position.coords.latitude, position.coords.longitude);
    }, err => {
        console.warn("Presence area geolocation failed:", err);
        if (!usedSavedLocation) updateLastSeenOnly();
    }, {
        enableHighAccuracy: false,
        maximumAge: 60000,
        timeout: 10000
    });
}

startPresenceAreaTracking();

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
    USGS_ENDPOINT: "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time&minlatitude=4&maxlatitude=21&minlongitude=116&maxlongitude=127&limit=2000",
    DEFAULT_POLL_MS: 15000,
};
let currentSource = "phivolcs";


let circleScale = 0.5;
let currentRange = { start: null, end: null };
const markers = new Map();
let latestMarker = null;
let pollHandle = null;
let currentNotificationId = null;

function clearAllEarthquakeMarkers() {
    markers.forEach(({ layer }) => {
        try {
            map.removeLayer(layer);
        } catch (err) { /* ignore */ }
    });
    markers.clear();
    latestMarker = null;
    latestEarthquakeId = null;
}

document.getElementById("sourceSelector").addEventListener("change", function (e) {
    currentSource = e.target.value;
    clearAllEarthquakeMarkers();
    setStatus(`Switching to ${currentSource === "usgs" ? "USGS" : "PHIVOLCS"}...`);
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

// Dedicated panes so the latest star always renders above older circles + tooltips
map.createPane("earthquakeCircles");
map.getPane("earthquakeCircles").style.zIndex = "450";
map.createPane("latestEarthquake");
map.getPane("latestEarthquake").style.zIndex = "850";
map.createPane("earthquakeLabels");
map.getPane("earthquakeLabels").style.zIndex = "950";
map.getPane("earthquakeLabels").style.pointerEvents = "none";

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
        source: raw.source ?? currentSource,
    };
}

function getReportSourceLabel(ev) {
    return ev?.source === "usgs" ? "USGS" : "PHIVOLCS";
}

function reportLinkHtml(ev) {
    if (!ev?.link) return "";
    return `<a href="${ev.link}" target="_blank" rel="noopener noreferrer">View report from ${getReportSourceLabel(ev)}</a>`;
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

function ensureLatestMarkerOnTop() {
    if (!latestMarker) return;
    const markerLayer = latestMarker;

    const elevate = () => {
        try {
            // Push every older earthquake behind the latest star
            markers.forEach(({ layer }) => {
                if (layer === markerLayer) return;
                applyMarkerStacking(layer);
            });

            if (markerLayer.bringToFront) markerLayer.bringToFront();
            applyMarkerStacking(markerLayer, true);

            const latestPane = map.getPane("latestEarthquake");
            const el = markerLayer.getElement?.();
            if (el && latestPane) {
                latestPane.appendChild(el);
                el.style.zIndex = "99999";
                el.style.pointerEvents = "auto";
            }

            const tooltip = markerLayer.getTooltip();
            if (tooltip?._container) {
                const tooltipPane = map.getPane("earthquakeLabels") || map.getPane("tooltipPane");
                if (tooltipPane) tooltipPane.appendChild(tooltip._container);
                tooltip._container.style.zIndex = "100500";
                tooltip._container.classList.add("latest-on-top");

                const rect = tooltip._container.getBoundingClientRect();
                if (rect.right > window.innerWidth) {
                    tooltip._container.style.left = `${window.innerWidth - rect.width - 10}px`;
                }
                if (rect.bottom > window.innerHeight) {
                    tooltip._container.style.top = `${window.innerHeight - rect.height - 10}px`;
                }
            }
        } catch (err) {
            console.warn("Failed to bring latest marker to front:", err);
        }
    };

    elevate();
    requestAnimationFrame(elevate);
    setTimeout(elevate, 50);
    setTimeout(elevate, 200);
    setTimeout(elevate, 500);
}

function getEventTimeMs(ev) {
    const timeMs = new Date(ev?.time).getTime();
    return Number.isFinite(timeMs) ? timeMs : 0;
}

function getEventStackIndex(ev, isLatest = false) {
    const base = Math.floor(getEventTimeMs(ev) / 1000);
    return (isLatest ? 100000 : 1000) + (base % 800000);
}

function applyMarkerStacking(layer, isLatest = false) {
    if (!layer) return;
    const data = markers.get(layer._eventId)?.data;
    const zIndex = getEventStackIndex(data, isLatest);

    if (layer.setZIndexOffset) {
        layer.setZIndexOffset(isLatest ? 1000000 : zIndex);
    }

    if (layer._path) {
        layer._path.style.zIndex = String(zIndex);
    }

    const el = layer.getElement?.();
    if (el) {
        el.style.zIndex = String(isLatest ? 1000000 : zIndex);
    }

    const tooltipEl = layer.getTooltip()?._container;
    if (tooltipEl) {
        const labelPane = map.getPane("earthquakeLabels") || map.getPane("tooltipPane");
        if (labelPane && tooltipEl.parentNode !== labelPane) {
            labelPane.appendChild(tooltipEl);
        }
        tooltipEl.style.zIndex = String(isLatest ? 100500 : zIndex + 500);
    }
}

function restackEarthquakeMarkers() {
    const layers = Array.from(markers.values())
        .map(({ layer, data }) => ({ layer, data }))
        .sort((a, b) => getEventTimeMs(a.data) - getEventTimeMs(b.data));

    layers.forEach(({ layer }) => {
        if (layer !== latestMarker && layer.bringToFront) {
            layer.bringToFront();
        }
        applyMarkerStacking(layer, layer === latestMarker);
    });

    if (latestMarker) {
        if (latestMarker.bringToFront) latestMarker.bringToFront();
        applyMarkerStacking(latestMarker, true);
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

    // Show viewer counts without exposing viewer coordinates.
    buildPresencePanel(allSessions);
    refreshPresenceMarkers(allSessions);

    const activeCount = getActivePresenceEntries(allSessions).length;
    updatePresenceButton(activeCount);
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
    const areaFields = getPresenceAreaFields();

    // Set initial session data with proper error handling
    presenceSessionRef
        .set({
            firstSeen: now,
            lastSeen: now,
            status: "online",
            displayName: viewerName || "Guest",
            role: isAdmin ? "admin" : "member",
            ...areaFields
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
            role: isAdmin ? "admin" : "member",
            ...getPresenceAreaFields()
        };

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
 * FETCH EVENTS
 ************************************************************************/
const FETCH_TIMEOUT_MS = 12000;

function getCacheKey() {
    return `cachedEarthquakes_${currentSource}`;
}

function getCacheTimeKey() {
    return `cachedEarthquakesTime_${currentSource}`;
}

function filterEventsByDateRange(events) {
    if (!currentRange?.start || !currentRange?.end) return events;
    const startMs = currentRange.start.getTime();
    const endMs = currentRange.end.getTime();
    return events.filter(ev => {
        const t = new Date(ev.time).getTime();
        return !isNaN(t) && t >= startMs && t <= endMs;
    });
}

function parseWorkerEarthquakes(json) {
    if (!Array.isArray(json)) return [];
    return json.map(e => {
        let time;
        try {
            const rawTime = e.date_time || e.time;
            if (!rawTime) {
                time = new Date().toISOString();
            } else {
                const parts = String(rawTime).split(" - ");
                time = parts.length === 2
                    ? new Date(`${parts[0]} ${parts[1]}`).toISOString()
                    : new Date(rawTime).toISOString();
            }
        } catch {
            time = new Date().toISOString();
        }

        const lat = parseFloat(e.latitude ?? e.lat);
        const lon = parseFloat(e.longitude ?? e.lon);
        const location = (e.location || "Philippines")
            .replace(/^\d+\s*km\s*/i, "")
            .replace(/\n|\t/g, " ")
            .trim()
            .replace(/\s+/g, " ");

        return {
            id: String(e.details_link || e.id || `${time}_${lat}_${lon}`),
            lat,
            lon,
            magnitude: parseFloat(e.magnitude) || 0,
            depth: e.depth_km ?? e.depth ?? null,
            time,
            location,
            link: e.details_link ?? e.link ?? null,
            source: "phivolcs",
        };
    }).filter(ev => ev.lat && ev.lon && !isNaN(ev.lat) && !isNaN(ev.lon));
}

function parseUsgsEarthquakes(json) {
    return (json.features || []).map(f => ({
        id: f.id,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        magnitude: f.properties.mag,
        depth: f.geometry.coordinates[2],
        time: new Date(f.properties.time).toISOString(),
        location: f.properties.place,
        link: f.properties.url,
        source: "usgs",
    })).filter(e => e.lat && e.lon);
}

function formatUsgsIso(date) {
    return date.toISOString().slice(0, 19) + "Z";
}

async function fetchJsonWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS, useCacheBuster = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const fetchUrl = useCacheBuster
            ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`
            : url;
        const resp = await fetch(fetchUrl, {
            cache: "no-store",
            signal: controller.signal
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } finally {
        clearTimeout(timer);
    }
}

function buildWorkerUrl() {
    let url = CONFIG.API_ENDPOINT;
    if (currentRange.start && currentRange.end) {
        url += `?start=${currentRange.start.toISOString()}&end=${currentRange.end.toISOString()}`;
    }
    return url;
}

function buildUsgsUrl() {
    let url = CONFIG.USGS_ENDPOINT;
    if (currentRange.start && currentRange.end) {
        const start = new Date(currentRange.start);
        let end = new Date(Math.min(currentRange.end.getTime(), Date.now()));
        if (start > end) end = new Date();
        url += `&starttime=${encodeURIComponent(formatUsgsIso(start))}`;
        url += `&endtime=${encodeURIComponent(formatUsgsIso(end))}`;
    }
    return url;
}

function renderEarthquakeEvents(events, sourceLabel) {
    if (!events.length) throw new Error("No events received");

    events.sort((a, b) => new Date(b.time) - new Date(a.time));

    const latest = events[0];
    const isNewQuake = latestEarthquakeId !== latest.id;

    // Add oldest events first so the latest star is rendered last and stays on top
    const oldestFirst = [...events].sort((a, b) => new Date(a.time) - new Date(b.time));
    oldestFirst.forEach(ev => addOrUpdateEventMarker(
        ev,
        ev.id === latest.id,
        ev.id === latest.id && isNewQuake
    ));

    restackEarthquakeMarkers();
    ensureLatestMarkerOnTop();

    latestEarthquakeId = latest.id;
    localStorage.setItem(getCacheKey(), JSON.stringify(events));
    localStorage.setItem(getCacheTimeKey(), Date.now().toString());
    setStatus(`${sourceLabel}: ${events.length} events — latest: ${latest.location} (M${latest.magnitude})`);
}

function showCachedEarthquakes() {
    const cached = localStorage.getItem(getCacheKey());
    const cachedTime = localStorage.getItem(getCacheTimeKey());
    if (!cached) {
        setStatus("No earthquakes available — try switching to USGS");
        return false;
    }

    const events = JSON.parse(cached);
    const ageMins = Math.floor((Date.now() - parseInt(cachedTime, 10)) / 60000);
    events.sort((a, b) => new Date(b.time) - new Date(a.time));
    const latest = events[0];
    const oldestFirst = [...events].sort((a, b) => new Date(a.time) - new Date(b.time));
    oldestFirst.forEach(ev => addOrUpdateEventMarker(ev, ev.id === latest.id, false));
    restackEarthquakeMarkers();
    ensureLatestMarkerOnTop();
    setStatus(`Showing cached earthquakes (saved ${ageMins} min ago)`);
    return true;
}

async function fetchFromWorker() {
    const json = await fetchJsonWithTimeout(buildWorkerUrl(), FETCH_TIMEOUT_MS, true);
    return filterEventsByDateRange(parseWorkerEarthquakes(json));
}

async function fetchFromUsgs() {
    const json = await fetchJsonWithTimeout(buildUsgsUrl(), FETCH_TIMEOUT_MS, false);
    return filterEventsByDateRange(parseUsgsEarthquakes(json));
}

async function fetchNewEvents() {
    setStatus("Fetching events...");

    try {
        let events = [];
        let sourceLabel = "";

        if (currentSource === "usgs") {
            events = await fetchFromUsgs();
            sourceLabel = "USGS";
        } else if (currentSource === "phivolcs") {
            events = await fetchFromWorker();
            sourceLabel = "PHIVOLCS";
        } else {
            throw new Error("Unknown source selected");
        }

        renderEarthquakeEvents(events, sourceLabel);
    } catch (e) {
        console.warn("Fetch failed:", e.message);
        setStatus("Live sources unavailable — trying cache...");
        if (!showCachedEarthquakes()) {
            setStatus("No earthquakes available. Select USGS or check your connection.");
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
        clearAllEarthquakeMarkers();
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
        clearAllEarthquakeMarkers();
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
    });
    clearAllEarthquakeMarkers();
    if (flyTimeout) clearTimeout(flyTimeout);

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

        const oldestFirst = [...events].sort((a, b) => new Date(a.time) - new Date(b.time));
        oldestFirst.forEach(ev => {
            addOrUpdateEventMarker(ev, ev.id === latest.id, false);
        });
        restackEarthquakeMarkers();
        ensureLatestMarkerOnTop();

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

    // If already on map, just re-elevate when it's the latest
    if (markers.has(ev.id)) {
        if (isLatest) {
            latestMarker = markers.get(ev.id).layer;
            ensureLatestMarkerOnTop();
        }
        return;
    }

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
                pane: "earthquakeCircles",
            }).bindPopup(`
                <strong>${prevData.location || "Unknown"}</strong><br>
                Mag: ${prevData.magnitude}<br>
                Depth: ${prevData.depth ?? "?"} km<br>
                ${formatDateTime(prevData.time)}<br>
                ${reportLinkHtml(prevData)}
            `).addTo(map);

            oldCircle.bindTooltip(`M${prevData.magnitude}`, {
                permanent: true,
                direction: "center",
                className: "magnitude-label",
                opacity: 1,
                pane: "earthquakeLabels"
            });

            // replace in the markers map
            markers.set(prevData.id, { layer: oldCircle, data: prevData });
            applyMarkerStacking(oldCircle, false);
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

        markerLayer = L.marker([ev.lat, ev.lon], {
            icon,
            pane: "latestEarthquake",
            zIndexOffset: 9999,
            riseOnHover: true
        }).addTo(map);

        markerLayer.bindPopup(`
          <strong>${ev.location || "Unknown"}</strong><br>
          Mag: ${ev.magnitude}<br>
          Depth: ${ev.depth ?? "?"} km<br>
          ${formatDateTime(ev.time)}<br>
          ${reportLinkHtml(ev)}
        `);

        // Add a prominent tooltip for the latest
        markerLayer.bindTooltip(` M${ev.magnitude}`, {
            permanent: true,
            direction: "center",
            className: "magnitude-label latest",
            opacity: 1,
            pane: "earthquakeLabels"
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
            pane: "earthquakeCircles",
        }).addTo(map);

        markerLayer.bindPopup(`
          <strong>${ev.location || "Unknown"}</strong><br>
          Mag: ${ev.magnitude}<br>
          Depth: ${ev.depth ?? "?"} km<br>
          ${formatDateTime(ev.time)}<br>
          ${reportLinkHtml(ev)}
        `);

        markerLayer.bindTooltip(`M${ev.magnitude}`, {
            permanent: true,
            direction: "center",
            className: "magnitude-label",
            opacity: 1,
            pane: "earthquakeLabels"
        });
    }

    // set housekeeping props and store
    markerLayer._eventId = ev.id;
    markers.set(ev.id, { layer: markerLayer, data: ev });
    applyMarkerStacking(markerLayer, isLatest);

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

        restackEarthquakeMarkers();
        ensureLatestMarkerOnTop();
    }
}

map.on("zoomend", () => {
    restackEarthquakeMarkers();
    ensureLatestMarkerOnTop();
});
map.on("moveend", () => {
    restackEarthquakeMarkers();
    ensureLatestMarkerOnTop();
});

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
            localStorage.setItem("userLocation", JSON.stringify(userLocation));
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
    initAdminAuth();
    initAnnouncements();
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

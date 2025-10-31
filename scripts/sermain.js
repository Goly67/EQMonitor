
// ===============================
// Maintenance Time Config
// ===============================
const NEW_START = "2025-10-31T20:30:00";
const NEW_END = "2025-11-01T08:00:00";

// ===============================
// Local Storage Helpers
// ===============================
function getStoredTimes() {
    const stored = localStorage.getItem("maintenanceTimes");
    if (!stored) return null;

    const data = JSON.parse(stored);

    return {
        startTime: new Date(data.startTime),
        endTime: new Date(data.endTime)
    };
}

function saveMaintenanceTimes(startTime, endTime) {
    localStorage.setItem(
        "maintenanceTimes",
        JSON.stringify({
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString()
        })
    );
}

// ===============================
// Date Handling
// ===============================
const newStart = new Date(NEW_START);
const newEnd = new Date(NEW_END);
const stored = getStoredTimes();

if (
    stored &&
    (stored.startTime.toISOString() !== newStart.toISOString() ||
        stored.endTime.toISOString() !== newEnd.toISOString())
) {
    console.log("⏱️ Maintenance time updated — refreshing cache");
    saveMaintenanceTimes(newStart, newEnd);
    location.reload();
}

let maintenanceStartTime = stored?.startTime || newStart;
let maintenanceEndTime = stored?.endTime || newEnd;
if (!stored) {
    saveMaintenanceTimes(newStart, newEnd);
}

// ===============================
// Countdown Logic
// ===============================
function updateCountdown() {
    const now = new Date();
    const total = maintenanceEndTime - maintenanceStartTime;
    const elapsed = now - maintenanceStartTime;

    if (now < maintenanceEndTime) {
        const remaining = maintenanceEndTime - now;

        const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
        const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

        daysEl.textContent = days.toString().padStart(2, '0');
        hoursEl.textContent = hours.toString().padStart(2, '0');
        minutesEl.textContent = minutes.toString().padStart(2, '0');
        secondsEl.textContent = seconds.toString().padStart(2, '0');

        let progress = (elapsed / total) * 100;
        progress = Math.max(0, Math.min(progress, 99)); // clamp 0–99%

        progressFill.style.setProperty("--progress-width", `${progress}%`);
        progressPercent.textContent = `${Math.round(progress)}%`;
    } else {
        // after exact end time, show 100
        progressFill.style.setProperty("--progress-width", `100%`);
        progressPercent.textContent = "100%";

        daysEl.textContent = hoursEl.textContent =
            minutesEl.textContent = secondsEl.textContent = "00";
    }

    updateTimeDisplays();
}

console.log("Start:", maintenanceStartTime);
console.log("End:", maintenanceEndTime);
console.log("Now:", new Date());


// ===============================
// UI Binding
// ===============================
const daysEl = document.getElementById('days');
const hoursEl = document.getElementById('hours');
const minutesEl = document.getElementById('minutes');
const secondsEl = document.getElementById('seconds');
const progressFill = document.getElementById('progressFill');
const progressPercent = document.getElementById('progressPercent');

function updateTimeDisplays() {
    const now = new Date();

    document.getElementById("startTime").textContent = maintenanceStartTime.toLocaleString();
    document.getElementById("endTime").textContent = maintenanceEndTime.toLocaleString();

    const timeStr = now.toLocaleTimeString();
    document.getElementById("footerTime").textContent = timeStr;
}

updateCountdown();
setInterval(updateCountdown, 1000);

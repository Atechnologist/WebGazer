const videoElement = document.getElementById('webcam');
const calibDot = document.getElementById('calib-dot');
const gazePointer = document.getElementById('gaze-pointer');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const debugLog = document.getElementById('debug-console');
const heatmapCanvas = document.getElementById('heatmap-canvas');
const heatmapCtx = heatmapCanvas.getContext('2d');

let detector = null, currentFeatures = null, calibrationStep = 0, isCalibrated = false;
let smoothFrames = 6, invertX = false, heatmapData = []; 
let hoverStartTime = null, relayActivated = false;
const DWELL_DELAY_MS = 2000;

const screenTargets = [{ x: 40, y: 40 }, { x: window.innerWidth - 40, y: 40 }, { x: 40, y: window.innerHeight - 40 }, { x: window.innerWidth - 40, y: window.innerHeight - 40 }];
let eyeGrid = { tl: null, tr: null, bl: null, br: null };
const smoothingBuffer = [];

function log(msg) { debugLog.innerText = "System Log: " + msg; }
function toggleSettings() { const panel = document.getElementById('settings-panel'); panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; }
function updateSettings() { smoothFrames = parseInt(document.getElementById('smooth-range').value); document.getElementById('smooth-val').innerText = smoothFrames + " frames"; invertX = document.getElementById('invert-x-check').checked; }
function clearHeatmap() { heatmapData = []; heatmapCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height); }
function resizeCanvas() { heatmapCanvas.width = window.innerWidth; heatmapCanvas.height = window.innerHeight; }

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

async function initSystem() {
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') { log("Security Block: Camera streams require an HTTPS secure connection."); statusText.innerText = "Deployment Error: Switch page to HTTPS."; return; }
    if (typeof tf === 'undefined' || typeof faceDetection === 'undefined') { log("Boot Error: Core browser scripts were blocked or timed out."); return; }
    try {
        log("Initializing graphics acceleration engine...");
        await tf.setBackend('webgl');
        await tf.ready();
        log("Downloading target model architecture...");
        detector = await faceDetection.createDetector(faceDetection.SupportedModels.MediaPipeFaceMesh, { runtime: 'tfjs', maxFaces: 1 });
        log("Requesting frontend webcam video tokens...");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        videoElement.srcObject = stream;
        videoElement.onloadedmetadata = () => { log("AI processing framework live. Ready to calibrate."); statusText.innerText = "Hold your device steady"; startBtn.disabled = false; processFramesLoop(); };
    } catch (err) { log("Boot Error: " + err.message); statusText.innerText = "Setup blocked. Check device hardware settings."; console.error(err); }
}

async function processFramesLoop() {
    if (detector && videoElement.readyState >= 2) {
        let videoTensor = null;
        try {
            videoTensor = tf.browser.fromPixels(videoElement);
            const faces = await detector.estimateFaces(videoTensor, { flipHorizontal: false });
            if (faces && faces.length > 0) {
                log(isCalibrated ? "Gaze tracking operational." : "Tracking active. Ready to calibrate.");
                const keypoints = faces[0].keypoints;
                const outer = keypoints[33];
                const inner = keypoints[133];
                const pupil = keypoints[468];
                if (outer && inner && pupil) {
                    const eyeCenterX = (inner.x + outer.x) / 2;
                    const eyeCenterY = (inner.y + outer.y) / 2;
                    const eyeWidth = Math.hypot(outer.x - inner.x, outer.y - inner.y);
                    let calculatedX = (pupil.x - eyeCenterX) / eyeWidth;
                    if (invertX) { calculatedX = -calculatedX; }
                    currentFeatures = { x: calculatedX, y: (pupil.y - eyeCenterY) / eyeWidth };
                    if (isCalibrated) { processGazeMapping(currentFeatures.x, currentFeatures.y); }
                }
            } else { log("Searching for eyes / face context... (No faces in frame)"); }
        } catch (e) { log("Frame Error: " + e.message); } finally { if (videoTensor) { videoTensor.dispose(); } }
    }
    requestAnimationFrame(processFramesLoop);
}

function startCalibration() { startBtn.style.display = 'none'; statusText.innerText = "Stare at the red dot and TAP the screen to capture."; calibrationStep = 0; showNextCalibrationDot(); }

function showNextCalibrationDot() {
    if (calibrationStep < 4) {
        calibDot.style.display = 'block';
        calibDot.style.left = `${screenTargets[calibrationStep].x}px`;
        calibDot.style.top = `${screenTargets[calibrationStep].y}px`;
    } else {
        calibDot.style.display = 'none';
        document.getElementById('ui-overlay').style.display = 'none';
        isCalibrated = true;
        gazePointer.style.display = 'block';
        
        // FIX: Display the relay switch interface target container as soon as calibration concludes!
        document.getElementById('relay-button-target').style.display = 'block';
        drawHeatmapLoop();
    }
}


const triggerEvent = 'ontouchstart' in window ? 'touchstart' : 'click';
window.addEventListener(triggerEvent, (e) => {
    if (calibrationStep >= 4 || isCalibrated || calibDot.style.display === 'none') return;
    if (e.target.id === 'start-btn' || e.target.id === 'settings-btn' || e.target.closest?.('#settings-panel')) return;
    if (!currentFeatures) return; 
    const keys = ['tl', 'tr', 'bl', 'br'];
    eyeGrid[keys[calibrationStep]] = { x: currentFeatures.x, y: currentFeatures.y };
    calibrationStep++;
    showNextCalibrationDot();
});

function processGazeMapping(ex, ey) {
    const { tl, tr, bl, br } = eyeGrid;
    const tx = (ex - tl.x) / ((tr.x - tl.x) || 0.001);
    const ty = (ey - tl.y) / ((bl.y - tl.y) || 0.001);
    const u = Math.max(0, Math.min(1, tx));
    const v = Math.max(0, Math.min(1, ty));
    let targetX = (1 - u) * (1 - v) * screenTargets[0].x + u * (1 - v) * screenTargets[1].x + (1 - u) * v * screenTargets[2].x + u * v * screenTargets[3].x;
    let targetY = (1 - u) * (1 - v) * screenTargets[0].y + u * (1 - v) * screenTargets[1].y + (1 - u) * v * screenTargets[2].y + u * v * screenTargets[3].y;
    smoothingBuffer.push({ x: targetX, y: targetY });
    while (smoothingBuffer.length > smoothFrames) { smoothingBuffer.shift(); }
    const avgX = smoothingBuffer.reduce((sum, p) => sum + p.x, 0) / smoothingBuffer.length;
    const avgY = smoothingBuffer.reduce((sum, p) => sum + p.y, 0) / smoothingBuffer.length;
    gazePointer.style.left = `${avgX}px`; gazePointer.style.top = `${avgY}px`;
    heatmapData.push({ x: avgX, y: avgY, weight: 1 });
    // Runtime duration configuration tracking parameters
let hoverStartTime = null;
const DWELL_DELAY_MS = 2000; // 2 seconds threshold loop check limit
let relayActivated = false;

function checkRelayButtonDwell(gx, gy) {
    const btn = document.getElementById('relay-button-target');
    if (!btn || relayActivated) return;

    // Fetch the real-time layout bounding box edges of the button container element
    const rect = btn.getBoundingClientRect();

    // Check if the current average green cursor coordinate is overlapping inside the element rectangle
    const isOverlapping = (gx >= rect.left && gx <= rect.right && gy >= rect.top && gy <= rect.bottom);

    if (isOverlapping) {
        if (!hoverStartTime) {
            hoverStartTime = performance.now(); // Mark the starting millisecond timestamp entry
            btn.classList.add('gaze-hover');
        }

        const durationLooked = performance.now() - hoverStartTime;
        const progressPercentage = Math.min(100, Math.floor((durationLooked / DWELL_DELAY_MS) * 100));
        
        btn.innerText = `TRIGGERING... [${progressPercentage}%]`;

        if (durationLooked >= DWELL_DELAY_MS) {
            relayActivated = true;
            btn.classList.remove('gaze-hover');
            btn.classList.add('triggered');
            btn.innerText = "💥 RELAY ACTIVE!";
            log("Automation Event: Relay macro executed successfully via Eye Gaze Dwell Track!");
            
            // OPTIONAL: Insert your physical hardware webhook API calls or fetch queries here
            // fetch('https://your-home-automation-ip/api/relay/toggle');
        }
    } else {
        // Reset state properties immediately if your gaze look path slips outside the element container margins
        hoverStartTime = null;
        btn.classList.remove('gaze-hover');
        btn.innerText = "RELAY SWITCH [0%]";
    }
}

    checkRelayButtonDwell(avgX, avgY);
}

function checkRelayButtonDwell(gx, gy) {
    const btn = document.getElementById('relay-button-target');
    if (!btn || relayActivated) return;
    const rect = btn.getBoundingClientRect();
    const isOverlapping = (gx >= rect.left && gx <= rect.right && gy >= rect.top && gy <= rect.bottom);
    if (isOverlapping) {
        if (!hoverStartTime) { hoverStartTime = performance.now(); btn.classList.add('gaze-hover'); }
        const durationLooked = performance.now() - hoverStartTime;
        const progressPercentage = Math.min(100, Math.floor((durationLooked / DWELL_DELAY_MS) * 100));
        btn.innerText = `TRIGGERING... [${progressPercentage}%]`;
        if (durationLooked >= DWELL_DELAY_MS) { relayActivated = true; btn.classList.remove('gaze-hover'); btn.classList.add('triggered'); btn.innerText = "💥 RELAY ACTIVE!"; log("Automation Event: Relay executed!"); }
    } else { hoverStartTime = null; btn.classList.remove('gaze-hover'); btn.innerText = "RELAY SWITCH [0%]"; }
}

function drawHeatmapLoop() {
    if (!isCalibrated) return;
    heatmapCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
    heatmapData.forEach(point => {
        let gradient = heatmapCtx.createRadialGradient(point.x, point.y, 2, point.x, point.y, 35);
        gradient.addColorStop(0, 'rgba(255, 0, 0, 0.15)'); gradient.addColorStop(0.5, 'rgba(255, 255, 0, 0.05)'); gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');          
        heatmapCtx.fillStyle = gradient; heatmapCtx.beginPath(); heatmapCtx.arc(point.x, point.y, 35, 0, Math.PI * 2); heatmapCtx.fill();
    });
    requestAnimationFrame(drawHeatmapLoop);
}

window.startCalibration = startCalibration;
window.toggleSettings = toggleSettings;
window.updateSettings = updateSettings;
window.clearHeatmap = clearHeatmap;

window.onload = () => { setTimeout(initSystem, 1000); };

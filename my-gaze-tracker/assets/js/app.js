const videoElement = document.getElementById('webcam');
const calibDot = document.getElementById('calib-dot');
const gazePointer = document.getElementById('gaze-pointer');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const debugLog = document.getElementById('debug-console');

let calibrationStep = 0;
let isCalibrated = false;

// FIX: Declare the dynamic coordinates directly during the initial variable assignment
const screenTargets = [
    { x: Math.round(window.innerWidth * 0.15), y: Math.round(window.innerHeight * 0.15) }, // Top Left (15% inset)
    { x: Math.round(window.innerWidth * 0.85), y: Math.round(window.innerHeight * 0.15) }, // Top Right
    { x: Math.round(window.innerWidth * 0.15), y: Math.round(window.innerHeight * 0.85) }, // Bottom Left
    { x: Math.round(window.innerWidth * 0.85), y: Math.round(window.innerHeight * 0.85) }  // Bottom Right
];

function log(msg) { debugLog.innerText = "System Log: " + msg; }



let eyeGrid = { tl: null, tr: null, bl: null, br: null };
const smoothingBuffer = [];

function log(msg) { debugLog.innerText = "System Log: " + msg; }

// On-screen mobile exception reporting engine
window.onerror = function (message, source, lineno, colno, error) {
    log("Fatal Error: " + message + " (" + (source ? source.split('/').pop() : '') + ":" + lineno + ")");
    return false;
};

function toggleSettings() { const panel = document.getElementById('settings-panel'); panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; }
function updateSettings() { smoothFrames = parseInt(document.getElementById('smooth-range').value); document.getElementById('smooth-val').innerText = smoothFrames + " frames"; invertX = document.getElementById('invert-x-check').checked; }
function clearHeatmap() { heatmapData = []; heatmapCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height); }

function resizeCanvas() {
    heatmapCanvas.width = window.innerWidth;
    heatmapCanvas.height = window.innerHeight;

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const boxWidth = window.innerWidth * 0.40;
    const boxHeight = window.innerHeight * 0.40;

}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

async function initSystem() {
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        log("Security Block: Camera streams require an HTTPS secure connection.");
        statusText.innerText = "Deployment Error: Switch page to HTTPS.";
        return;
    }
    if (typeof tf === 'undefined' || typeof faceLandmarksDetection === 'undefined') {
        log("Boot Error: Core browser scripts were blocked or timed out.");
        return;
    }
    try {
        log("Initializing graphics acceleration engine...");
        await tf.setBackend('webgl');
        await tf.ready();
        log(`Active Hardware Backend: ${tf.getBackend()}`);

        log("Downloading target model architecture...");
        detector = await faceLandmarksDetection.createDetector(
            faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
            { runtime: 'tfjs', refineLandmarks: true, maxFaces: 1 }
        );

        log("Requesting frontend webcam video tokens...");
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        });
        videoElement.srcObject = stream;
        videoElement.onloadedmetadata = () => {
            log("AI processing framework live. Ready to calibrate.");
            statusText.innerText = "Hold your device steady";
            startBtn.disabled = false;
            processFramesLoop();
        };
    } catch (err) {
        log("Boot Error: " + err.message);
        statusText.innerText = "Setup blocked. Check device hardware settings.";
        console.error(err);
    }
}

async function processFramesLoop() {
    if (detector && videoElement.readyState >= 2) {
        let videoTensor = null;
        try {
            videoTensor = tf.browser.fromPixels(videoElement);
            const faces = await detector.estimateFaces(videoTensor, { flipHorizontal: false });

            if (faces && faces.length > 0) {
                log(isCalibrated ? "Gaze tracking operational." : `Tracking active. Ready for calibration point ${calibrationStep + 1}/5`);
                const keypoints = faces[0].scaledMesh || faces[0].keypoints;
                
                if (keypoints) {
                    const outer = keypoints[33];
                    const inner = keypoints[133];
                    const pupil = keypoints[468];
                    
                    if (outer && inner && pupil) {
                        const ox = typeof outer.x !== 'undefined' ? outer.x : outer[0];
                        const oy = typeof outer.y !== 'undefined' ? outer.y : outer[1];
                        const ix = typeof inner.x !== 'undefined' ? inner.x : inner[0];
                        const iy = typeof inner.y !== 'undefined' ? inner.y : inner[1];
                        const px = typeof pupil.x !== 'undefined' ? pupil.x : pupil[0];
                        const py = typeof pupil.y !== 'undefined' ? pupil.y : pupil[1];

                        const eyeCenterX = (ix + ox) / 2;
                        const eyeCenterY = (iy + oy) / 2;
                        const eyeWidth = Math.hypot(ox - ix, oy - iy);
                        
                        let calculatedX = (px - eyeCenterX) / eyeWidth;
                        if (invertX) { calculatedX = -calculatedX; }
                        
                        currentFeatures = { x: calculatedX, y: (py - eyeCenterY) / eyeWidth };
                        if (isCalibrated) { processGazeMapping(currentFeatures.x, currentFeatures.y); }
                    }
                }
            } else {
                log("Searching for eyes / face context... (No faces in frame)");
            }
        } catch (e) {
            log("Frame Error: " + e.message);
        } finally {
            if (videoTensor) { videoTensor.dispose(); }
        }
    }
    requestAnimationFrame(processFramesLoop);
}

function startCalibration(event) {
    if (event) event.stopPropagation(); // CRITICAL: Blocks the button click from instantly triggering a tap on the first dot!
    
    startBtn.style.display = 'none';
    statusText.innerText = "Stare at the red dot and TAP the screen to capture.";
    calibrationStep = 0;
    
    webgazer.clearData();
    showNextCalibrationDot();
}

function showNextCalibrationDot() {
    if (calibrationStep < 5) {
        calibDot.style.display = 'block';
        calibDot.style.left = `${screenTargets[calibrationStep].x}px`;
        calibDot.style.top = `${screenTargets[calibrationStep].y}px`;
    } else {
        calibDot.style.display = 'none';
        document.getElementById('ui-overlay').style.display = 'none';
        isCalibrated = true;
        gazePointer.style.display = 'block';
        
        const targetBtn = document.getElementById('relay-button-target');
        if (targetBtn) {
            targetBtn.classList.add('active-ready');
            targetBtn.innerText = "🔄 LOGGING HEATMAP...";
        }
        
        if (!dwellTimerInterval) {
            dwellTimerInterval = setInterval(runBackgroundDwellCheck, 50);
        }
        drawHeatmapLoop();
    }
}

const triggerEvent = 'ontouchstart' in window ? 'touchstart' : 'click';
window.addEventListener(triggerEvent, (e) => {
    if (calibrationStep >= 5 || isCalibrated || calibDot.style.display === 'none') return;
    if (e.target.id === 'start-btn' || e.target.id === 'settings-btn' || e.target.closest?.('#settings-panel')) return;
    if (!currentFeatures) return;

    // First tap locks center anchor. The 4 corner calibration points map keys index 1,2,3,4 cleanly
    if (calibrationStep > 0) {
        const keys = ['tl', 'tr', 'bl', 'br'];
        eyeGrid[keys[calibrationStep - 1]] = { x: currentFeatures.x, y: currentFeatures.y };
    }
    
    calibrationStep++;
    showNextCalibrationDot();
});

function processGazeMapping(ex, ey) {
    const { tl, tr, bl, br } = eyeGrid;
    if (!tl || !tr || !bl || !br) return; // FIX 3: Safety check stops early array crashes during startup phase loops

    const tx = (ex - tl.x) / ((tr.x - tl.x) || 0.001);
    const ty = (ey - tl.y) / ((bl.y - tl.y) || 0.001);
    const u = Math.max(0, Math.min(1, tx));
    const v = Math.max(0, Math.min(1, ty));

    // FIX 4: Fixed all target selector indices mappings cleanly (Restoring matrix pointers 1, 2, 3, 4)
    let targetX = (1 - u) * (1 - v) * screenTargets[1].x + u * (1 - v) * screenTargets[2].x + (1 - u) * v * screenTargets[3].x + u * v * screenTargets[4].x;
    let targetY = (1 - u) * (1 - v) * screenTargets[1].y + u * (1 - v) * screenTargets[2].y + (1 - u) * v * screenTargets[3].y + u * v * screenTargets[4].y;

    smoothingBuffer.push({ x: targetX, y: targetY });
    while (smoothingBuffer.length > smoothFrames) { smoothingBuffer.shift(); }

    const avgX = smoothingBuffer.reduce((sum, pt) => sum + pt.x, 0) / smoothingBuffer.length;
    const avgY = smoothingBuffer.reduce((sum, pt) => sum + pt.y, 0) / smoothingBuffer.length;

    gazePointer.style.left = `${avgX}px`;
    gazePointer.style.top = `${avgY}px`;
    heatmapData.push({ x: avgX, y: avgY, weight: 1 });

    // 1. Continuous dynamic gravity well logic mapping heatmaps
    let trackingAnalysisBuffer = heatmapData.slice(-90); // Use the last 90 frames (~3 seconds)
    if (trackingAnalysisBuffer.length >= 30) {
        const computedUserCenterX = trackingAnalysisBuffer.reduce((sum, pt) => sum + pt.x, 0) / trackingAnalysisBuffer.length;
        const computedUserCenterY = trackingAnalysisBuffer.reduce((sum, pt) => sum + pt.y, 0) / trackingAnalysisBuffer.length;
        
        const btn = document.getElementById('relay-button-target');
        if (btn && !relayActivated) {
            // Restored the required string template literal backticks safely
            btn.style.left = `${computedUserCenterX}px`;
            btn.style.top = `${computedUserCenterY}px`;
            dynamicOffsetCalibrated = true;
        }
    }

    currentGazeX = avgX;
    currentGazeY = avgY;
}

function runBackgroundDwellCheck() {
    const btn = document.getElementById('relay-button-target');
    if (!btn || !btn.classList.contains('active-ready') || relayActivated) return;

    const rect = btn.getBoundingClientRect();
    const isOverlapping = (currentGazeX >= rect.left && currentGazeX <= rect.right && currentGazeY >= rect.top && currentGazeY <= rect.bottom);
    const LOOP_INTERVAL_MS = 50;

    if (isOverlapping && dynamicOffsetCalibrated) {
        btn.classList.add('gaze-hover');
        dwellAccumulatorMs += LOOP_INTERVAL_MS;
        
        if (dwellAccumulatorMs >= CAPACITOR_MAX_MS) {
            dwellAccumulatorMs = CAPACITOR_MAX_MS;
            relayActivated = true; // Locks loop during the active trigger phase
            
            btn.classList.remove('gaze-hover');
            btn.classList.add('triggered');
            btn.innerText = "💥 RELAY ACTIVE!";
            log("Automation Event: Relay executed smoothly via Gaze Focus!");
            
            setTimeout(() => {
                dwellAccumulatorMs = 0;
                relayActivated = false; // Unlocks look tracking calculations
                btn.classList.remove('triggered');
                btn.innerText = "RELAY SWITCH [0%]";
                log("Tracker reset complete. Ready for next loop.");
            }, 2500);
        }
    } else {
        btn.classList.remove('gaze-hover');
        dwellAccumulatorMs -= (LOOP_INTERVAL_MS * 1.5);
        if (dwellAccumulatorMs < 0) dwellAccumulatorMs = 0;
    }

    if (!relayActivated) {
        if (!dynamicOffsetCalibrated) {
            btn.innerText = "🔄 ALIGNING ZONE...";
        } else {
            const progressPercentage = Math.floor((dwellAccumulatorMs / CAPACITOR_MAX_MS) * 100);
            // Restored the required string template literal backticks safely
            btn.innerText = progressPercentage > 0 ? `TRIGGERING... [${progressPercentage}%]` : "RELAY SWITCH [0%]";
        }
    }
}

function drawHeatmapLoop() {
    if (!isCalibrated) return;
    heatmapCtx.clearRect(0, 0, heatmapCanvas.width, heatmapCanvas.height);
    heatmapData.forEach(point => {
        let gradient = heatmapCtx.createRadialGradient(point.x, point.y, 2, point.x, point.y, 35);
        gradient.addColorStop(0, 'rgba(255, 0, 0, 0.15)');
        gradient.addColorStop(0.5, 'rgba(255, 255, 0, 0.05)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        heatmapCtx.fillStyle = gradient;
        heatmapCtx.beginPath();
        heatmapCtx.arc(point.x, point.y, 35, 0, Math.PI * 2);
        heatmapCtx.fill();
    });
    requestAnimationFrame(drawHeatmapLoop);
}

window.onload = () => { setTimeout(initSystem, 1000); };

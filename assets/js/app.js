const videoElement = document.getElementById('webcam');
const calibDot = document.getElementById('calib-dot');
const gazePointer = document.getElementById('gaze-pointer');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const debugLog = document.getElementById('debug-console');

let faceLandmarker = null;
let currentFeatures = null;
let calibrationStep = 0;
let isCalibrated = false;

const screenTargets = [
    { x: 40, y: 40 },
    { x: window.innerWidth - 40, y: 40 },
    { x: 40, y: window.innerHeight - 40 },
    { x: window.innerWidth - 40, y: window.innerHeight - 40 }
];

let eyeGrid = { tl: null, tr: null, bl: null, br: null };
const smoothingBuffer = [];
const SMOOTH_FRAMES = 6;

function log(msg) { debugLog.innerText = "System Log: " + msg; }

async function initSystem() {
    let checkAttempts = 0;
    
    // Wait until the unified Google Vision architecture package finishes registering
    while (typeof FilesetResolver === 'undefined' || typeof FaceLandmarker === 'undefined') {
        checkAttempts++;
        log(`Connecting to AI Edge runtime... (Attempt ${checkAttempts}/20)`);
        if (checkAttempts > 20) {
            log("Boot Error: Google Vision libraries failed to load.");
            statusText.innerText = "Setup stalled. Check network proxy filters.";
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    try {
        log("Downloading neural face mesh files...");
        
        // Load the explicit asset resolver package from Google's verified cloud repo mirror
        const filesetResolver = await FilesetResolver.forVisionTasks(
            "https://jsdelivr.net"
        );

        // Instantiate the modern landmarker mapping configuration settings
        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: `https://googleapis.com`,
                delegate: "GPU"
            },
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false,
            runningMode: "VIDEO",
            numFaces: 1
        });

        log("Requesting physical webcam hardware permissions...");
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        });
        
        videoElement.srcObject = stream;
        videoElement.onloadedmetadata = () => {
            log("Webcam operational. AI pipeline tracking frame loops...");
            statusText.innerText = "Hold your tablet or phone steady";
            startBtn.disabled = false;
            processVideoFrameLoop();
        };

    } catch (err) {
        log("Boot Error: " + err.message);
        statusText.innerText = "Camera Access Blocked. Ensure page runs over HTTPS.";
        console.error(err);
    }
}

let lastVideoTime = -1;
async function processVideoFrameLoop() {
    if (videoElement.currentTime !== lastVideoTime) {
        lastVideoTime = videoElement.currentTime;
        
        if (faceLandmarker && videoElement.readyState >= 2) {
            const result = faceLandmarker.detectForVideo(videoElement, performance.now());
            
            if (result.faceLandmarks && result.faceLandmarks.length > 0) {
                log(isCalibrated ? "Gaze tracking operational." : "Tracking active. Ready to calibrate.");
                
                const landmarks = result.faceLandmarks[0];

                // Modern Google AI Edge Node Array Indexes mapping vectors:
                // Node 33 = Left eye outer edge, Node 133 = Left eye inner edge, Node 468 = Left pupil center matrix
                const outer = landmarks[33];
                const inner = landmarks[133];
                const pupil = landmarks[468];

                if (outer && inner && pupil) {
                    const eyeCenterX = (inner.x + outer.x) / 2;
                    const eyeCenterY = (inner.y + outer.y) / 2;
                    const eyeWidth = Math.hypot(outer.x - inner.x, outer.y - inner.y);

                    currentFeatures = {
                        x: (pupil.x - eyeCenterX) / eyeWidth,
                        y: (pupil.y - eyeCenterY) / eyeWidth
                    };

                    if (isCalibrated) {
                        processGazeMapping(currentFeatures.x, currentFeatures.y);
                    }
                }
            } else {
                log("Searching for eyes / face context...");
            }
        }
    }
    requestAnimationFrame(processVideoFrameLoop);
}

function startCalibration() {
    startBtn.style.display = 'none';
    statusText.innerText = "Stare at the red dot and TAP the screen to capture.";
    calibrationStep = 0;
    showNextCalibrationDot();
}

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
    }
}

const triggerEvent = 'ontouchstart' in window ? 'touchstart' : 'click';
window.addEventListener(triggerEvent, (e) => {
    if (calibrationStep >= 4 || isCalibrated || calibDot.style.display === 'none') return;
    if (e.target.id === 'start-btn') return;
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
    if (smoothingBuffer.length > SMOOTH_FRAMES) smoothingBuffer.shift();

    const avgX = smoothingBuffer.reduce((sum, p) => sum + p.x, 0) / smoothingBuffer.length;
    const avgY = smoothingBuffer.reduce((sum, p) => sum + p.y, 0) / smoothingBuffer.length;

    gazePointer.style.left = `${avgX}px`;
    gazePointer.style.top = `${avgY}px`;
}

window.onload = () => {
    setTimeout(initSystem, 500);
};

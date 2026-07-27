const videoElement = document.getElementById('webcam');
const calibDot = document.getElementById('calib-dot');
const gazePointer = document.getElementById('gaze-pointer');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const debugLog = document.getElementById('debug-console');

let calibrationStep = 0;
let isCalibrated = false;

const screenTargets = [
    { x: 40, y: 40 },
    { x: window.innerWidth - 40, y: 40 },
    { x: 40, y: window.innerHeight - 40 },
    { x: window.innerWidth - 40, y: window.innerHeight - 40 }
];

function log(msg) { debugLog.innerText = "System Log: " + msg; }

async function initSystem() {
    let checkAttempts = 0;
    
    // Updated check constraint to capture either regional global variable definition block
    while (typeof webgazer === 'undefined' && typeof window.webgazer === 'undefined') {
        checkAttempts++;
        log(`Connecting to core module engine... (Attempt ${checkAttempts}/20)`);
        if (checkAttempts > 20) {
            log("Boot Error: webgazer.js failed to load. Check browser network tab.");
            statusText.innerText = "Setup stalled. File missing or 404 error.";
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 500)); 
    }

    // Ensure our local tracker code context matches the verified active window handle
    const trackerInstance = typeof webgazer !== 'undefined' ? webgazer : window.webgazer;

    try {
        log("Requesting physical webcam hardware permissions...");
        
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        });
        
        videoElement.srcObject = stream;
        await new Promise((resolve) => { videoElement.onloadedmetadata = () => resolve(); });

        log("Webcam operational. Injecting global CDN parameters...");

        // Inject the explicit CDN path settings straight into the current runtime instance parameters
        if (trackerInstance.params) {
            trackerInstance.params.facemeshLoaderScript = "https://jsdelivr.net";
            trackerInstance.params.faceMeshWasmLocation = "https://jsdelivr.net";
        }

        // Initialize WebGazer engine properties on the active instance context
        await trackerInstance.setRegression('ridge')
            .setGazeListener((data, clock) => {
                if (isCalibrated && data) {
                    gazePointer.style.left = `${data.x}px`;
                    gazePointer.style.top = `${data.y}px`;
                }
            })
            .saveDataAcrossSessions(false)
            .begin();

        trackerInstance.showVideoPreview(false)
                       .showPredictionPoints(false);

        log("Gaze tracking active. Hardware synced.");
        statusText.innerText = "Hold your tablet or phone steady";
        startBtn.disabled = false;

    } catch (err) {
        log("Boot Error: " + err.message);
        statusText.innerText = "Camera Access Blocked. Ensure page runs over HTTPS.";
        console.error(err);
    }
}


function startCalibration() {
    startBtn.style.display = 'none';
    statusText.innerText = "Stare at the red dot and TAP the screen to capture.";
    calibrationStep = 0;
    webgazer.clearData();
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
        log("Gaze tracking operational.");
    }
}

const triggerEvent = 'ontouchstart' in window ? 'touchstart' : 'click';
window.addEventListener(triggerEvent, (e) => {
    if (calibrationStep >= 4 || isCalibrated || calibDot.style.display === 'none') return;
    if (e.target.id === 'start-btn') return;

    const currentPoint = screenTargets[calibrationStep];
    log(`Calibrating point ${calibrationStep + 1} at X: ${currentPoint.x}, Y: ${currentPoint.y}`);
    webgazer.recordScreenPosition(currentPoint.x, currentPoint.y, 'click');

    calibrationStep++;
    showNextCalibrationDot();
});

// Run initialization code 1 second after window elements prepare natively
window.onload = () => {
    setTimeout(initSystem, 1000);
};

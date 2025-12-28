/**
 * Head-Tracked Audio Panning Frontend
 * Uses Web Audio API and WebSocket connection to backend
 */

// WebSocket and audio variables
let socket = null;
let audioContext = null;
let audioElement = null;
let sourceNode = null;
let pannerNode = null;
let gainNode = null;
let isPlaying = false;
let isSystemActive = false;
let currentPan = 0;
let panOffset = 0; // For calibration if head isn't centered

// DOM Elements
let startBtn, stopBtn, playBtn;
let connectionStatus, trackingStatus, statusText, trackingText;
let panLevel, panValueDisplay, playIcon, playText;

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Get DOM elements
    startBtn = document.getElementById('startBtn');
    stopBtn = document.getElementById('stopBtn');
    playBtn = document.getElementById('playBtn');
    
    connectionStatus = document.getElementById('connectionStatus');
    trackingStatus = document.getElementById('trackingStatus');
    statusText = document.getElementById('statusText');
    trackingText = document.getElementById('trackingText');
    
    panLevel = document.getElementById('panLevel');
    panValueDisplay = document.getElementById('panValue');
    playIcon = document.getElementById('playIcon');
    playText = document.getElementById('playText');
    
    audioElement = document.getElementById('audioElement');
    
    // Set up WebSocket connection
    connectWebSocket();
    
    // Initialize Web Audio API (but don't start yet)
    initializeAudio();
    
    // Set volume from slider
    updateVolume(80);
});

/**
 * Establish WebSocket connection to backend
 */
function connectWebSocket() {
    // Connect to Flask-SocketIO server
    socket = io('http://localhost:5000');
    
    socket.on('connect', function() {
        console.log('WebSocket connected successfully');
        updateConnectionStatus(true, 'Connected to server');
    });
    
    socket.on('connection_response', function(data) {
        console.log('Server response:', data.message);
    });
    
    socket.on('pan_update', function(data) {
        // Update pan value from server
        updatePan(data.pan);
    });
    
    socket.on('tracking_started', function(data) {
        console.log('Tracking started:', data.message);
        updateTrackingStatus(true, 'Head tracking active');
    });
    
    socket.on('tracking_stopped', function(data) {
        console.log('Tracking stopped:', data.message);
        updateTrackingStatus(false, 'Head tracking idle');
    });
    
    socket.on('error', function(data) {
        console.error('Server error:', data.message);
        alert('Error: ' + data.message);
    });
    
    socket.on('disconnect', function() {
        console.log('WebSocket disconnected');
        updateConnectionStatus(false, 'Disconnected from server');
        updateTrackingStatus(false, 'Head tracking idle');
    });
}

/**
 * Initialize Web Audio API components
 */
function initializeAudio() {
    try {
        // Create AudioContext (cross-browser compatibility)
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioContext();
        
        // Create audio graph nodes
        sourceNode = audioContext.createMediaElementSource(audioElement);
        pannerNode = audioContext.createStereoPanner();
        gainNode = audioContext.createGain();
        
        // Connect nodes: source -> panner -> gain -> destination
        sourceNode.connect(pannerNode);
        pannerNode.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // Set initial pan to center
        pannerNode.pan.value = 0;
        
        console.log('Web Audio API initialized successfully');
        
        // Resume audio context on user interaction (browser requirement)
        document.addEventListener('click', function() {
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }
        }, { once: true });
        
    } catch (error) {
        console.error('Error initializing Web Audio API:', error);
        alert('Web Audio API not supported in this browser. Please use Chrome, Firefox, or Edge.');
    }
}

/**
 * Start the entire system (audio + camera tracking)
 */
function startSystem() {
    if (!socket || !socket.connected) {
        alert('Not connected to server. Please check if backend is running.');
        return;
    }
    
    // Request camera access first
    navigator.mediaDevices.getUserMedia({ video: true })
        .then(function(stream) {
            // Camera access granted, start tracking
            console.log('Camera access granted');
            
            // Send message to backend to start tracking
            socket.emit('start_tracking');
            
            // Enable buttons
            startBtn.disabled = true;
            stopBtn.disabled = false;
            playBtn.disabled = false;
            
            isSystemActive = true;
            
            // Update UI
            updateTrackingStatus(true, 'Starting tracking...');
            
        })
        .catch(function(error) {
            console.error('Camera access error:', error);
            alert('Camera access is required for head tracking. Please allow camera access.');
        });
}

/**
 * Stop the system
 */
function stopSystem() {
    if (socket && socket.connected) {
        socket.emit('stop_tracking');
    }
    
    // Stop audio if playing
    if (isPlaying) {
        toggleAudio();
    }
    
    // Reset buttons
    startBtn.disabled = false;
    stopBtn.disabled = true;
    playBtn.disabled = true;
    
    isSystemActive = false;
    
    // Reset pan visualization
    updatePan(0);
    updateTrackingStatus(false, 'Head tracking idle');
}

/**
 * Toggle audio play/pause
 */
function toggleAudio() {
    if (!audioContext) {
        console.error('Audio context not initialized');
        return;
    }
    
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    if (!isPlaying) {
        // Start playing
        audioElement.play()
            .then(() => {
                isPlaying = true;
                playIcon.className = 'fas fa-pause';
                playText.textContent = 'Pause Audio';
                console.log('Audio started playing');
            })
            .catch(error => {
                console.error('Error playing audio:', error);
                alert('Error playing audio. Make sure song.mp3 exists in the same folder.');
            });
    } else {
        // Pause playing
        audioElement.pause();
        isPlaying = false;
        playIcon.className = 'fas fa-play';
        playText.textContent = 'Play Audio';
        console.log('Audio paused');
    }
}

/**
 * Update pan value based on head position
 * @param {number} pan - Pan value from -1 (left) to +1 (right)
 */
function updatePan(pan) {
    if (!isSystemActive) return;
    
    // Apply calibration offset if needed
    let calibratedPan = pan + panOffset;
    
    // Clamp to valid range
    calibratedPan = Math.max(-1, Math.min(1, calibratedPan));
    
    // Store current pan
    currentPan = calibratedPan;
    
    // Update panner node with smoothing
    if (pannerNode) {
        // Apply smoothing to prevent audio glitches
        pannerNode.pan.setValueAtTime(pannerNode.pan.value, audioContext.currentTime);
        pannerNode.pan.linearRampToValueAtTime(calibratedPan, audioContext.currentTime + 0.1);
    }
    
    // Update visualization
    updatePanVisualization(calibratedPan);
}

/**
 * Update the pan visualization UI
 * @param {number} pan - Current pan value
 */
function updatePanVisualization(pan) {
    // Update meter position (-1 to 1 maps to 0% to 100% of container)
    const position = (pan + 1) / 2 * 100;
    panLevel.style.transform = `translateX(${position - 50}%)`;
    
    // Update numeric display
    panValueDisplay.textContent = pan.toFixed(2);
    
    // Color coding based on position
    if (Math.abs(pan) < 0.1) {
        panLevel.style.background = 'linear-gradient(90deg, #00ff88, #00ccff)';
        panValueDisplay.style.color = '#00ff88';
    } else if (pan < 0) {
        panLevel.style.background = 'linear-gradient(90deg, #ff4444, #ff8800)';
        panValueDisplay.style.color = '#ff8800';
    } else {
        panLevel.style.background = 'linear-gradient(90deg, #00aaff, #8800ff)';
        panValueDisplay.style.color = '#00aaff';
    }
}

/**
 * Reset pan calibration (set current position as center)
 */
function resetPan() {
    panOffset = -currentPan;
    console.log('Pan reset. Offset:', panOffset);
    
    // Show notification
    const notification = document.createElement('div');
    notification.textContent = 'Pan center calibrated';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #00ff88;
        color: #000;
        padding: 10px 20px;
        border-radius: 5px;
        z-index: 1000;
        font-weight: bold;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        document.body.removeChild(notification);
    }, 2000);
}

/**
 * Update audio volume
 * @param {number} volume - Volume level (0-100)
 */
function updateVolume(volume) {
    if (gainNode) {
        // Convert linear 0-100 to exponential 0-1 for better perceptual control
        const gainValue = volume / 100;
        gainNode.gain.setValueAtTime(gainNode.gain.value, audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(gainValue, audioContext.currentTime + 0.1);
    }
}

/**
 * Update connection status UI
 */
function updateConnectionStatus(connected, message) {
    connectionStatus.className = 'status-dot ' + (connected ? 'connected' : '');
    statusText.textContent = message;
}

/**
 * Update tracking status UI
 */
function updateTrackingStatus(active, message) {
    trackingStatus.className = 'status-dot ' + (active ? 'processing' : '');
    trackingText.textContent = message;
}

// Handle page unload
window.addEventListener('beforeunload', function() {
    if (socket && socket.connected) {
        socket.emit('stop_tracking');
        socket.disconnect();
    }
});

// Error handling for audio element
audioElement.addEventListener('error', function(e) {
    console.error('Audio error:', e);
    alert('Error loading audio file. Make sure song.mp3 exists in the same folder.');
});

// Audio ended event
audioElement.addEventListener('ended', function() {
    isPlaying = false;
    playIcon.className = 'fas fa-play';
    playText.textContent = 'Play Audio';
});
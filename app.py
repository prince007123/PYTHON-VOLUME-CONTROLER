"""
FINAL – Head PAN + Fist VOLUME (WORKING)
"""

import cv2
import numpy as np
import mediapipe as mp
from flask import Flask
from flask_socketio import SocketIO
import threading
import time
import base64
import math

print("🎥 Starting Head + Fist Tracking System...")

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# Globals
camera = None
is_running = False
clients = 0
frame_width, frame_height = 640, 480

# ---------------- MediaPipe ----------------
mp_face = mp.solutions.face_detection
mp_hands = mp.solutions.hands

face_detector = mp_face.FaceDetection(
    model_selection=0,
    min_detection_confidence=0.6
)

hand_detector = mp_hands.Hands(
    max_num_hands=1,
    min_detection_confidence=0.6,
    min_tracking_confidence=0.6
)

# ---------------- Pan smoothing ----------------
pan_history = []
SMOOTH = 6

def smooth_pan(val):
    pan_history.append(val)
    if len(pan_history) > SMOOTH:
        pan_history.pop(0)
    return float(np.mean(pan_history))

# ---------------- Volume from fist ----------------
def calculate_volume(hand_landmarks):
    thumb = hand_landmarks.landmark[4]   # thumb tip
    index = hand_landmarks.landmark[8]   # index tip

    dist = math.hypot(thumb.x - index.x, thumb.y - index.y)

    # Map distance → volume
    volume = np.interp(dist, [0.02, 0.18], [0.0, 1.0])
    volume = max(0.0, min(1.0, volume))
    return volume

# ---------------- Camera loop ----------------
def camera_loop():
    global camera, is_running

    print("📸 Camera loop started")

    while is_running and camera:
        ret, frame = camera.read()
        if not ret:
            continue

        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        pan = 0.0
        volume = 1.0
        confidence = 0.0

        # -------- FACE → PAN --------
        face_results = face_detector.process(rgb)
        if face_results.detections:
            det = face_results.detections[0]
            box = det.location_data.relative_bounding_box

            cx = box.xmin + box.width / 2
            SENSITIVITY = 3.0

            pan = ((cx * 2) - 1) * SENSITIVITY
            pan = max(-1, min(1, pan))
            pan = smooth_pan(pan)

            confidence = det.score[0]

            x = int(box.xmin * frame_width)
            y = int(box.ymin * frame_height)
            w = int(box.width * frame_width)
            h = int(box.height * frame_height)

            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 3)
            cv2.putText(frame, f"PAN: {pan:.2f}", (10, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 0, 255), 2)

        # -------- HAND → VOLUME --------
        hand_results = hand_detector.process(rgb)
        if hand_results.multi_hand_landmarks:
            volume = calculate_volume(hand_results.multi_hand_landmarks[0])
            cv2.putText(frame, f"VOL: {volume:.2f}", (10, 80),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)

        # -------- SEND DATA --------
        socketio.emit("audio_update", {
            "pan": pan,
            "volume": volume,
            "confidence": confidence
        })

        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        frame_b64 = base64.b64encode(buf).decode("utf-8")
        socketio.emit("video_frame", {"frame": frame_b64})

        time.sleep(0.03)

    print("📸 Camera loop stopped")

# ---------------- Frontend ----------------
@app.route("/")
def index():
    return """
<!DOCTYPE html>
<html>
<head>
  <title>Head + Fist Control</title>
  <style>
    body { background:#0a0a0a; color:white; text-align:center; font-family:Arial }
    img { border:3px solid #00ff88; border-radius:12px; max-width:80vw }
    .val { font-size:2.5em; color:#00ff88 }
    button { padding:15px 30px; font-size:18px; margin:20px; cursor:pointer }
  </style>
</head>
<body>
  <h1>🎧 Head PAN + ✊ Fist VOLUME</h1>
  <img id="cam"><br>
  <div class="val">PAN: <span id="pan">0.00</span></div>
  <div class="val">VOL: <span id="vol">1.00</span></div>
  <button onclick="start()">▶ Start</button>

  <audio id="audio" loop>
    <source src="/song.mp3" type="audio/mpeg">
  </audio>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.5.0/socket.io.min.js"></script>
  <script>
    const socket = io();
    const img = document.getElementById("cam");
    const panTxt = document.getElementById("pan");
    const volTxt = document.getElementById("vol");
    const audio = document.getElementById("audio");

    let ctx, panner, gain;

    function start() {
      if (!ctx) {
        ctx = new AudioContext();
        const src = ctx.createMediaElementSource(audio);
        panner = ctx.createStereoPanner();
        gain = ctx.createGain();
        src.connect(panner).connect(gain).connect(ctx.destination);
      }
      audio.play();
      socket.emit("start_tracking");
    }

    socket.on("video_frame", d => {
      img.src = "data:image/jpeg;base64," + d.frame;
    });

    socket.on("audio_update", d => {
      panTxt.innerText = d.pan.toFixed(2);
      volTxt.innerText = d.volume.toFixed(2);
      if (panner) panner.pan.value = d.pan;
      if (gain) gain.gain.value = d.volume;
    });
  </script>
</body>
</html>
"""

@socketio.on("start_tracking")
def start_tracking():
    global camera, is_running

    if camera is None:
        camera = cv2.VideoCapture(0, cv2.CAP_DSHOW)
        camera.set(cv2.CAP_PROP_FRAME_WIDTH, frame_width)
        camera.set(cv2.CAP_PROP_FRAME_HEIGHT, frame_height)

    if not is_running:
        is_running = True
        threading.Thread(target=camera_loop, daemon=True).start()
        print("▶ Tracking started")

@socketio.on("disconnect")
def disconnect():
    global is_running
    is_running = False

if __name__ == "__main__":
    print("🚀 Open http://localhost:5000")
    socketio.run(app, host="0.0.0.0", port=5000, allow_unsafe_werkzeug=True)

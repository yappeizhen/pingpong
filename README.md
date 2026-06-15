# Ping Pong 🏓
<img width="1728" height="995" alt="image" src="https://github.com/user-attachments/assets/677a6463-9728-4c7f-a150-34b10ce8554e" />

Play ping pong in your browser using your hands. Point a webcam at yourself, open your palm to spawn a paddle, and swing to hit the ball. Play solo against a CPU opponent or challenge a friend over the internet with real‑time multiplayer.

Built with React 19, Three.js, TypeScript, Vite, MediaPipe hand tracking, and WebRTC over Firebase signaling.

## Features

- **Hand‑tracked paddles** — MediaPipe `HandLandmarker` detects your palm in the webcam feed, so you control a paddle without any hardware.
- **3D physics** — A small custom physics engine on top of Three.js handles gravity, table bounces, paddle collisions, and spin.
- **Solo mode** — Rally against a CPU opponent that forward‑simulates the ball's trajectory, picks an intercept point, and chases it down with tunable reaction delay, speed, and aim error.
- **Multiplayer mode** — Create a room, share a 4‑character code (or a deep link), and play a peer‑to‑peer match over WebRTC. Firestore is used only for signaling and lobby state.
- **Deep‑link joins** — Visiting `?join=ABCD` in the URL jumps straight into the join flow.
- **Adaptive network smoothing** — The guest client interpolates and extrapolates remote ball state with jitter‑aware delay to hide packet variance.
- **Zero install for players** — Everything runs client‑side in a modern browser.

## How to play

1. Allow camera access when prompted.
2. **Open your palm** toward the camera to show your paddle. **Close your fist** to hide it.
3. Move your hand to move the paddle. Swing quickly to add power and spin.
4. First player to **7 points** wins the match.

Works best in good lighting with your hand clearly in frame.

## Tech stack

- **React 19** + **Zustand** for UI and state
- **Three.js** for 3D rendering
- **@mediapipe/tasks-vision** for hand landmark detection
- **Firebase / Firestore** for multiplayer signaling and room lobby
- **WebRTC `RTCPeerConnection`** data channels for low‑latency gameplay sync
- **Vite** + **TypeScript** for the build

## Project structure

```
src/
  cv/            MediaPipe hand tracking, palm detection, swipe detection
  game/          Three.js scene, ball physics, CPU opponent controller, constants
  multiplayer/   Firestore rooms, WebRTC signaling, game state sync
  services/      Firebase initialization
  state/         Zustand stores (gameStore, multiplayerStore)
  ui/components/ React components (StartScreen, Playfield, HUD, overlays…)
  types/         Shared TypeScript types
  hooks/         Shared React hooks
```

## Getting started

### Prerequisites

- **Node.js 18+** and **npm**
- A modern browser with WebRTC + `getUserMedia` (Chrome, Edge, Safari, Firefox)
- A webcam
- A Firebase project (only needed for multiplayer)

### Install

```bash
npm install
```

### Configure environment

Copy the example env file and fill in your Firebase project credentials:

```bash
cp .env.example .env
```

```
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id

# Optional: a Metered TURN server improves connectivity on restrictive networks
# VITE_METERED_API_KEY=your-metered-api-key
# VITE_METERED_APP_NAME=your-app-name
```

> Solo mode works without Firebase. Multiplayer requires Firestore to be enabled in your Firebase project.

### Run the dev server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The dev server also binds to your LAN IP so you can test multiplayer between two devices on the same network.

### Build for production

```bash
npm run build
npm run preview
```

## Scripts

| Command           | What it does                         |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start Vite dev server                |
| `npm run build`   | Type‑check and build to `dist/`      |
| `npm run preview` | Preview the production build locally |
| `npm run lint`    | Run ESLint                           |
| `npm run format`  | Format the project with Prettier     |

## Multiplayer notes

- Rooms are identified by a 4‑character code (e.g. `K7P2`). The host creates the room, the guest joins with the code.
- WebRTC data channels carry paddle position, ball state, and scoring events. Firestore is used only for signaling (SDP/ICE) and the waiting‑room lobby.
- The host is authoritative over ball physics; the guest renders an interpolated view with adaptive delay tuned to observed jitter.
- For clients behind strict NATs, configure a TURN server via the optional `VITE_METERED_*` env vars.

## Browser support

Requires a desktop or mobile browser with:

- `navigator.mediaDevices.getUserMedia`
- WebRTC `RTCPeerConnection` with `RTCDataChannel`
- WebGL 2 (Three.js renderer)

Recent versions of Chrome, Edge, Safari, and Firefox all qualify.

## License

MIT — see [`LICENSE`](LICENSE) if present, otherwise feel free to fork and play.

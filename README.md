# Local Network File Transfer (Student Prototype)

A basic web app that lets two devices on the **same Wi-Fi network** transfer
a file, without any cloud service in between. Built as a learning project —
not production-ready (no auth, no database, no encryption).

## Tech Stack
- React (loaded via CDN + Babel standalone — no build step required)
- Node.js + Express (HTTP server + REST endpoints)
- ws (WebSocket library, used only for progress/status messages)
- Node.js file streams (`fs.createReadStream` / `fs.createWriteStream`)

## How it works (big picture)
Only **one device** runs the server (e.g. your laptop). Both devices then
open a browser to that laptop's local IP address:

1. **Device A** (say, your laptop) runs `npm start`. The terminal prints
   something like `http://192.168.1.23:3000`.
2. **Device A**, in a browser, opens that address and clicks
   **"Create Session"**. It gets a short 6-character code and becomes the
   **sender**.
3. **Device B** (e.g. your phone or another laptop, on the *same Wi-Fi*),
   opens `http://192.168.1.23:3000` in its browser, clicks
   **"Join Session"**, and types in the code. It becomes the **receiver**.
4. The sender picks a file and clicks **Send File**. The browser streams it
   over HTTP to the server, which streams it to disk.
5. The receiver sees the file name/size appear (pushed over WebSocket) and
   clicks **Download**, which streams the file from the server to their
   browser.
6. Both sides see a simple live progress bar while this happens.

## Setup

```bash
cd local-file-transfer
npm install
npm start
```

The terminal will print two URLs — use the "other devices" one
(`http://<your-ip>:3000`) on both devices.

> Make sure both devices are connected to the same Wi-Fi network, and that
> your computer's firewall allows incoming connections on port 3000.

## Project structure

```
local-file-transfer/
├── server.js          # Express + WebSocket server, session + file streaming logic
├── package.json
├── uploads/           # Where uploaded files are temporarily stored
└── public/
    ├── index.html      # Loads React/Babel from CDN
    ├── style.css        # Simple, plain styling
    └── app.js           # All React components (home, create, join, transfer)
```

## How the project was built, stage by stage

1. **Basic React UI** – `public/app.js` renders a home screen with a title,
   description, and "Create Session" / "Join Session" buttons. No backend
   needed yet, just UI and local state.
2. **Express backend** – `server.js` sets up an Express app and serves the
   `public/` folder, so the frontend and backend share a single server and
   port (simplest option for a prototype).
3. **Create/join session** – Added `POST /api/session/create` (generates a
   short code + returns the server's local IP so the other device knows
   where to connect) and `GET /api/session/:code` (lets a device check a
   code is valid before joining). Sessions are stored in a plain in-memory
   JavaScript object — no database needed for a prototype.
4. **Single-file transfer** – Added `PUT /api/session/:code/upload` and
   `GET /api/session/:code/download`. The file is sent as the raw request
   body (not `multipart/form-data`), which keeps the server code simple —
   no extra parsing library required.
5. **File streaming** – Both routes use `fs.createWriteStream` and
   `fs.createReadStream` and `.pipe()` the data directly between the HTTP
   request/response and disk. The whole file is never held in memory at
   once, so this works for large files too.
6. **Basic WebSocket progress** – A `ws` WebSocket server tracks which
   sockets belong to which session code. As bytes flow through the
   upload/download streams, the server counts them and broadcasts a small
   `{ type, percent }` JSON message to that session's sockets, so each
   device can see the *other* device's live progress.
7. **Testing on two devices** – Run the server on one machine, then open
   its local network address from a second device on the same Wi-Fi (see
   Setup above) to try a real transfer.

## Known limitations (by design, for simplicity)
- One file at a time, no upload queue.
- No authentication — anyone who has the code (and is on the same network)
  can join a session.
- No encryption of the file in transit beyond whatever the local network
  provides.
- Sessions and uploaded files live only in memory/disk and are lost when
  the server restarts.

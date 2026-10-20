/**
 * Local Network File Transfer - Server
 * ------------------------------------
 * A simple Express + WebSocket server that:
 *  1. Lets one device "create a session" (gets a short code).
 *  2. Lets another device "join" using that code.
 *  3. Streams a file from the sender to the server, and from the
 *     server to the receiver, using fs streams (never loading the
 *     whole file into memory).
 *  4. Uses WebSockets only to broadcast simple progress/status
 *     messages between the two devices in real time.
 *
 * This is a learning prototype, not a production app:
 * no auth, no database, no encryption - just the basics.
 */

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

// Serve the React (CDN-based) frontend from /public
app.use(express.static(path.join(__dirname, "public")));

/**
 * In-memory session store. Since this is a small prototype we don't
 * need a database - everything resets when the server restarts.
 and  its the only way to share files is to keep the file in memory or on disk temporarily.
 *
 * sessions[code] = {
 *   file: { name, size, path } | null,
 *   sockets: Set of connected WebSocket clients for this session
 * }
 */
const sessions = {};

function generateCode() {
  // 6-character, easy-to-read uppercase hex code, e.g. "A3F9C1"
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Find the first non-internal IPv4 address (the device's Wi-Fi IP)
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

// Sends a JSON message to every socket connected to a given session
function broadcast(code, data) {
  const session = sessions[code];
  if (!session) return;
  const message = JSON.stringify(data);
  session.sockets.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/* ---------------------- Session routes ---------------------- */

// Create a new session (sender side)
app.post("/api/session/create", (req, res) => {
  const code = generateCode();
  sessions[code] = { file: null, sockets: new Set() };
  res.json({ code, ip: getLocalIp(), port: PORT });
});

// Check if a session exists (used when joining, and to check for a
// file that's already waiting)
app.get("/api/session/:code", (req, res) => {
  const session = sessions[req.params.code];
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  res.json({ exists: true, file: session.file });
});

/* ---------------------- File transfer routes ---------------------- */

// Sender uploads a file. The file's raw bytes are the request body -
// no multipart/form-data parsing needed, which keeps this simple.
app.put("/api/session/:code/upload", (req, res) => {
  const { code } = req.params;
  const session = sessions[code];
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const fileName = decodeURIComponent(req.headers["x-file-name"] || "file");
  const fileSize = parseInt(req.headers["x-file-size"] || "0", 10);
  const filePath = path.join(UPLOAD_DIR, `${code}-${fileName}`);// this line ensures that the uploaded file is saved in the UPLOAD_DIR with a unique name based on the session code and original file name.

  const writeStream = fs.createWriteStream(filePath); //this line creates a writable stream to the specified file path, allowing the server to write incoming file data directly to disk.
  let bytesReceived = 0;

  req.on("data", (chunk) => {
    bytesReceived += chunk.length;
    const percent = fileSize
      ? Math.min(100, Math.round((bytesReceived / fileSize) * 100))
      : 0;
    broadcast(code, { type: "upload-progress", percent });
  });

  req.on("error", () => {
    writeStream.destroy();
  });

  // Stream the incoming request body straight to disk
  req.pipe(writeStream);

  writeStream.on("finish", () => {
    session.file = { name: fileName, size: fileSize, path: filePath };
    broadcast(code, { type: "file-ready", name: fileName, size: fileSize });
    res.json({ success: true });
  });

  writeStream.on("error", (err) => {
    console.error("Upload write error:", err);
    res.status(500).json({ error: "Upload failed" });
  });
});

// Receiver downloads the file. We stream it from disk instead of
// reading it all into memory first.
app.get("/api/session/:code/download", (req, res) => {
  const { code } = req.params;
  const session = sessions[code];
  if (!session || !session.file) {
    return res.status(404).json({ error: "No file available yet" });
  }

  const { path: filePath, name, size } = session.file;
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Content-Length", size);
  res.setHeader("Content-Type", "application/octet-stream");

  const readStream = fs.createReadStream(filePath);
  let bytesSent = 0;

  readStream.on("data", (chunk) => {
    bytesSent += chunk.length;
    const percent = Math.min(100, Math.round((bytesSent / size) * 100));
    broadcast(code, { type: "download-progress", percent });
  });

  readStream.on("end", () => {
    broadcast(code, { type: "download-complete" });
  });

  readStream.on("error", (err) => {
    console.error("Download read error:", err);
    res.status(500).end();
  });

  readStream.pipe(res);
});

/* ---------------------- WebSocket signaling ---------------------- */
// The WebSocket connection is only used for small status/progress
// messages - the actual file bytes always travel over plain HTTP
// streams above.

wss.on("connection", (ws) => {
  let joinedCode = null;

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return; // ignore anything that isn't valid JSON
    }

    if (data.type === "join" && sessions[data.code]) {
      joinedCode = data.code;
      sessions[data.code].sockets.add(ws);
    }
  });

  ws.on("close", () => {
    if (joinedCode && sessions[joinedCode]) {
      sessions[joinedCode].sockets.delete(ws);
    }
  });
});

// this is the main entry point of the server, where it starts listening for incoming HTTP and WebSocket connections on the specified port and IP address. It also logs the local and network URLs for accessing the server.
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Local File Transfer server running`);
  console.log(`Open on this device:  http://localhost:${PORT}`);
  console.log(`Open on other devices: http://${getLocalIp()}:${PORT}`);
});

/**
 * Local Network File Transfer - Frontend (React)
 * -----------------------------------------------
 * Plain, beginner-friendly React written with hooks only.
 * No router, no state library - just useState/useEffect and a few
 * screens swapped based on a single "screen" variable.
 */

// Turns a byte count into something readable, e.g. 1536 -> "1.5 KB"
function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(1)} ${units[i]}`;
}

// Small reusable progress bar
function ProgressBar({ percent }) {
  return (
    <div className="progress-outer">
      <div className="progress-inner" style={{ width: `${percent}%` }}>
        {percent > 0 ? `${percent}%` : ""}
      </div>
    </div>
  );
}

/* ---------------------- Sender panel ---------------------- */

function SenderPanel({ code }) {
  const [file, setFile] = React.useState(null);
  const [progress, setProgress] = React.useState(0);
  const [status, setStatus] = React.useState("Select a file to send");

  React.useEffect(() => {
    // Open a WebSocket just to receive status updates about the
    // *other* device (e.g. "receiver is downloading: 40%").
    const ws = new WebSocket(`ws://${window.location.host}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", code }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "download-progress") {
        setStatus(`Receiver is downloading: ${data.percent}%`);
      }
      if (data.type === "download-complete") {
        setStatus("Receiver finished downloading the file.");
      }
    };

    return () => ws.close();
  }, [code]);

  function handleFileChange(e) {
    const chosen = e.target.files[0];
    if (chosen) {
      setFile(chosen);
      setProgress(0);
      setStatus("Ready to send");
    }
  }

  function handleSend() {
    if (!file) return;
    setStatus("Uploading...");

    // XMLHttpRequest (not fetch) so we can track upload progress.
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/session/${code}/upload`);
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.setRequestHeader("x-file-size", file.size);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        setStatus("File sent! Waiting for the other device to download it...");
      } else {
        setStatus("Upload failed. Please try again.");
      }
    };

    xhr.onerror = () => setStatus("Upload failed. Please try again.");

    xhr.send(file);
  }

  return (
    <div className="card">
      <h3>Send a File</h3>
      <p>
        On the other device, open a browser to this address and click
        "Join Session", then enter this code:
      </p>
      <div className="code-display">{code}</div>

      <div>
        <input type="file" onChange={handleFileChange} />
      </div>
      {file && (
        <p>
          Selected: <strong>{file.name}</strong> ({formatBytes(file.size)})
        </p>
      )}

      <button onClick={handleSend} disabled={!file}>
        Send File
      </button>

      <ProgressBar percent={progress} />
      <p className="status">{status}</p>
    </div>
  );
}

/* ---------------------- Receiver panel ---------------------- */

function ReceiverPanel({ code }) {
  const [fileInfo, setFileInfo] = React.useState(null);
  const [progress, setProgress] = React.useState(0);
  const [status, setStatus] = React.useState("Waiting for the sender to send a file...");

  React.useEffect(() => {
    // In case a file was already uploaded before we joined, check now.
    fetch(`/api/session/${code}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.file) {
          setFileInfo(data.file);
          setStatus("A file is ready to download!");
        }
      });

    const ws = new WebSocket(`ws://${window.location.host}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", code }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "upload-progress") {
        setStatus(`Sender is uploading: ${data.percent}%`);
      }
      if (data.type === "file-ready") {
        setFileInfo({ name: data.name, size: data.size });
        setStatus("A file is ready to download!");
      }
    };

    return () => ws.close();
  }, [code]);

  function handleDownload() {
    setStatus("Downloading...");

    const xhr = new XMLHttpRequest();
    xhr.open("GET", `/api/session/${code}/download`);
    xhr.responseType = "blob";

    xhr.onprogress = (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        // Turn the downloaded blob into a normal browser file download
        const blobUrl = URL.createObjectURL(xhr.response);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = fileInfo.name;
        link.click();
        URL.revokeObjectURL(blobUrl);
        setStatus("Download complete!");
      } else {
        setStatus("Download failed. Please try again.");
      }
    };

    xhr.onerror = () => setStatus("Download failed. Please try again.");

    xhr.send();
  }

  return (
    <div className="card">
      <h3>Receive a File</h3>
      <p className="status">{status}</p>

      {fileInfo && (
        <div>
          <p>
            <strong>{fileInfo.name}</strong> ({formatBytes(fileInfo.size)})
          </p>
          <button onClick={handleDownload}>Download</button>
        </div>
      )}

      <ProgressBar percent={progress} />
    </div>
  );
}

/* ---------------------- App shell (home / create / join) ---------------------- */

function App() {
  const [screen, setScreen] = React.useState("home"); // home | join | sender | receiver
  const [code, setCode] = React.useState("");
  const [serverInfo, setServerInfo] = React.useState(null);
  const [joinCodeInput, setJoinCodeInput] = React.useState("");
  const [joinError, setJoinError] = React.useState("");

  function handleCreate() {
    fetch("/api/session/create", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        setCode(data.code);
        setServerInfo({ ip: data.ip, port: data.port });
        setScreen("sender");
      });
  }

  function handleJoinSubmit(e) {
    e.preventDefault();
    setJoinError("");
    const enteredCode = joinCodeInput.trim().toUpperCase();

    fetch(`/api/session/${enteredCode}`)
      .then((res) => {
        if (!res.ok) throw new Error("not-found");
        return res.json();
      })
      .then(() => {
        setCode(enteredCode);
        setScreen("receiver");
      })
      .catch(() => setJoinError("Session not found. Check the code and try again."));
  }

  return (
    <div className="container">
      <h1>Local Network File Transfer</h1>
      <p className="subtitle">
        A simple student prototype to send a file between two devices on the
        same Wi-Fi network.
      </p>

      {screen === "home" && (
        <div className="card">
          <button onClick={handleCreate}>Create Session</button>
          <button onClick={() => setScreen("join")}>Join Session</button>
        </div>
      )}

      {screen === "join" && (
        <div className="card">
          <form onSubmit={handleJoinSubmit}>
            <input
              type="text"
              placeholder="Enter session code"
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value)}
            />
            <button type="submit">Join</button>
          </form>
          {joinError && <p className="error">{joinError}</p>}
          <button className="secondary" onClick={() => setScreen("home")}>
            Back
          </button>
        </div>
      )}

      {screen === "sender" && (
        <div>
          {serverInfo && (
            <p>
              Other device should open:{" "}
              <strong>
                http://{serverInfo.ip}:{serverInfo.port}
              </strong>
            </p>
          )}
          <SenderPanel code={code} />
        </div>
      )}

      {screen === "receiver" && <ReceiverPanel code={code} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

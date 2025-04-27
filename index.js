const express = require("express");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const multer = require("multer");
const {
  default: Gifted_Tech,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
} = require("maher-zubair-baileys");

const app = express();
const PORT = process.env.PORT || 5000;

// Create directories if not exists
if (!fs.existsSync("temp")) fs.mkdirSync("temp");
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

const upload = multer({ dest: "uploads/" });
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store all active sessions
const activeClients = new Map();

// HTML Homepage
app.get("/", (req, res) => {
  res.send(`
    <html>
    <head>
      <title>WhatsApp Auto Sender</title>
      <style>
        body { font-family: Arial; background: #f0f8ff; text-align: center; padding: 20px; }
        .box { background: #fff; border-radius: 10px; padding: 20px; margin: 10px auto; max-width: 500px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        input, button, select { width: 90%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; }
        button { background: #4CAF50; color: white; border: none; cursor: pointer; }
        button:hover { background: #45a049; }
      </style>
    </head>
    <body>
      <h1>WhatsApp Bulk Sender</h1>
      
      <div class="box">
        <h3>Generate Pairing Code</h3>
        <form action="/code" method="GET">
          <input type="text" name="number" placeholder="Your WhatsApp Number" required>
          <button type="submit">Get Pairing Code</button>
        </form>
      </div>

      <div class="box">
        <h3>Send Messages</h3>
        <form action="/send-message" method="POST" enctype="multipart/form-data">
          <input type="text" name="taskId" placeholder="Your Task ID" required>
          <select name="targetType" required>
            <option value="">Select Target Type</option>
            <option value="number">Number</option>
            <option value="group">Group</option>
          </select>
          <input type="text" name="target" placeholder="Target Number/Group ID" required>
          <input type="file" name="messageFile" accept=".txt" required>
          <input type="number" name="delaySec" placeholder="Delay (Seconds)" required>
          <button type="submit">Start Sending</button>
        </form>
      </div>

      <div class="box">
        <h3>Stop Task</h3>
        <form action="/stop-task" method="POST">
          <input type="text" name="taskId" placeholder="Enter Task ID to Stop" required>
          <button type="submit" style="background: #f44336;">Stop My Task</button>
        </form>
      </div>

      <div class="box">
        <h3>Active Users: ${activeClients.size}</h3>
        <p>Render.com Free Tier = 10 Users Max (500 MB RAM)</p>
      </div>
    </body>
    </html>
  `);
});

// Generate Pairing Code
app.get("/code", async (req, res) => {
  const num = req.query.number.replace(/[^0-9]/g, "");
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  const tempPath = path.join("temp", taskId);

  if (!fs.existsSync(tempPath)) fs.mkdirSync(tempPath, { recursive: true });

  try {
    const { state, saveCreds } = await useMultiFileAuthState(tempPath);
    const waClient = Gifted_Tech({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino()) },
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
    });

    if (!waClient.authState.creds.registered) {
      const code = await waClient.requestPairingCode(num);
      activeClients.set(taskId, { client: waClient, number: num, authPath: tempPath });

      res.send(`
        <div class="box" style="max-width: 600px;">
          <h2>✅ Task Created Successfully!</h2>
          <p><strong>Task ID:</strong> ${taskId}</p>
          <p><strong>Pairing Code:</strong> ${code}</p>
          <p>Use this Task ID to send messages later.</p>
          <a href="/" style="display: inline-block; margin-top: 20px; padding: 10px 15px; background: #4CAF50; color: white; text-decoration: none; border-radius: 5px;">Go Back</a>
        </div>
      `);
    }

    waClient.ev.on("creds.update", saveCreds);
    waClient.ev.on("connection.update", (s) => {
      if (s.connection === "close") {
        console.log(`[${taskId}] Disconnected! Reconnecting in 10 sec...`);
        setTimeout(() => initializeClient(taskId, num, tempPath), 10000);
      }
    });
  } catch (err) {
    res.send(`<h2>Error: ${err.message}</h2><a href="/">Go Back</a>`);
  }
});

// Reconnect Logic
async function initializeClient(taskId, num, tempPath) {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(tempPath);
    const waClient = Gifted_Tech({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino()) },
      logger: pino({ level: "silent" }),
    });

    activeClients.set(taskId, { client: waClient, number: num, authPath: tempPath });
    waClient.ev.on("creds.update", saveCreds);
    console.log(`[${taskId}] Reconnected Successfully!`);
  } catch (err) {
    console.log(`[${taskId}] Reconnect Failed: ${err.message}`);
  }
}

// Send Messages
app.post("/send-message", upload.single("messageFile"), async (req, res) => {
  const { taskId, target, targetType, delaySec } = req.body;
  if (!activeClients.has(taskId)) return res.send(`<h2>❌ Invalid Task ID</h2><a href="/">Go Back</a>`);

  const { client: waClient } = activeClients.get(taskId);
  const filePath = req.file?.path;
  const messages = fs.readFileSync(filePath, "utf-8").split("\n").filter(m => m.trim());

  activeClients.get(taskId).isSending = true;
  activeClients.get(taskId).stopRequested = false;

  try {
    while (activeClients.get(taskId).isSending && !activeClients.get(taskId).stopRequested) {
      for (const msg of messages) {
        if (activeClients.get(taskId).stopRequested) break;
        await waClient.sendMessage(
          targetType === "group" ? `${target}@g.us` : `${target}@s.whatsapp.net`,
          { text: msg }
        );
        await delay(delaySec * 1000);
      }
    }
    res.send(`<h2>✅ Messages Sent Successfully!</h2><a href="/">Go Back</a>`);
  } catch (err) {
    res.send(`<h2>❌ Error: ${err.message}</h2><a href="/">Go Back</a>`);
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

// Stop Task
app.post("/stop-task", (req, res) => {
  const { taskId } = req.body;
  if (activeClients.has(taskId)) {
    activeClients.get(taskId).stopRequested = true;
    res.send(`<h2>🛑 Task Stopped: ${taskId}</h2><a href="/">Go Back</a>`);
  } else {
    res.send(`<h2>❌ Task Not Found</h2><a href="/">Go Back</a>`);
  }
});

// Start Server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

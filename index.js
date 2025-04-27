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
  Browsers,
} = require("maher-zubair-baileys");

const app = express();
const PORT = 5000;

// Create necessary directories
if (!fs.existsSync("temp")) {
  fs.mkdirSync("temp");
}
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const upload = multer({ dest: "uploads/" });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store active client instances
const activeClients = new Map();

app.get("/", (req, res) => {
  res.send(`
    <html>
    <head>
      <title>WhatsApp Message Sender</title>
      <style>
        body { background: #ff69b4; color: green; text-align: center; font-size: 20px; }
        input, button, select { display: block; margin: 10px auto; padding: 10px; font-size: 16px; }
        .box { background: yellow; padding: 20px; border-radius: 10px; margin: 20px auto; max-width: 600px; }
        .active-sessions { background: white; padding: 15px; border-radius: 10px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <h2>WhatsApp Auto Sender</h2>
      <div class="box">
        <form action="/code" method="GET">
          <input type="text" name="number" placeholder="Enter Your WhatsApp Number" required>
          <button type="submit">Generate Pairing Code</button>
        </form>
      </div>

      <div class="box">
        <form action="/send-message" method="POST" enctype="multipart/form-data">
          <input type="text" name="taskId" placeholder="Enter Your Task ID" required>
          <select name="targetType" required>
            <option value="">-- Select Target Type --</option>
            <option value="number">Target Number</option>
            <option value="group">Group UID</option>
          </select>
          <input type="text" name="target" placeholder="Enter Target Number / Group UID" required>
          <input type="file" name="messageFile" accept=".txt" required>
          <input type="number" name="delaySec" placeholder="Delay in Seconds" required>
          <button type="submit">Send Message</button>
        </form>
      </div>

      <div class="box">
        <form action="/stop-task" method="POST">
          <input type="text" name="taskId" placeholder="Enter Your Task ID to Stop" required>
          <button type="submit">Stop My Task</button>
        </form>
      </div>

      <div class="active-sessions">
        <h3>Active Sessions: ${activeClients.size}</h3>
      </div>
    </body>
    </html>
  `);
});

app.get("/code", async (req, res) => {
  const num = req.query.number.replace(/[^0-9]/g, "");
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  const tempPath = path.join("temp", taskId);

  if (!fs.existsSync(tempPath)) {
    fs.mkdirSync(tempPath, { recursive: true });
  }

  try {
    const { state, saveCreds } = await useMultiFileAuthState(tempPath);
    
    const waClient = Gifted_Tech({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
      },
      printQRInTerminal: false,
      logger: pino({ level: "fatal" }).child({ level: "fatal" }),
      browser: ["Chrome (Linux)", "", ""],
    });

    if (!waClient.authState.creds.registered) {
      await delay(1500);
      const code = await waClient.requestPairingCode(num);
      
      // Store client instance with taskId
      activeClients.set(taskId, {
        client: waClient,
        number: num,
        authPath: tempPath
      });

      res.send(`
        <h2>Your Task ID: ${taskId}</h2>
        <h2>Pairing Code: ${code}</h2>
        <p>Save this Task ID to send messages later</p>
        <br><a href="/">Go Back</a>
      `);
    }

    waClient.ev.on("creds.update", saveCreds);
    waClient.ev.on("connection.update", async (s) => {
      const { connection, lastDisconnect } = s;
      if (connection === "open") {
        console.log(`WhatsApp Connected for ${num}! Task ID: ${taskId}`);
      } else if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
        console.log(`Reconnecting for Task ID: ${taskId}...`);
        await delay(10000);
        // Reinitialize the client instead of trying to reconnect directly
        initializeClient(taskId, num, tempPath);
      }
    });
  } catch (err) {
    console.error("Error in pairing:", err);
    res.send(`<h2>Error: ${err.message}</h2><br><a href="/">Go Back</a>`);
  }
});

async function initializeClient(taskId, num, tempPath) {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(tempPath);
    
    const waClient = Gifted_Tech({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
      },
      printQRInTerminal: false,
      logger: pino({ level: "fatal" }).child({ level: "fatal" }),
      browser: ["Chrome (Linux)", "", ""],
    });

    activeClients.set(taskId, {
      client: waClient,
      number: num,
      authPath: tempPath
    });

    waClient.ev.on("creds.update", saveCreds);
    waClient.ev.on("connection.update", async (s) => {
      const { connection, lastDisconnect } = s;
      if (connection === "open") {
        console.log(`Reconnected successfully for Task ID: ${taskId}`);
      } else if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
        console.log(`Reconnecting again for Task ID: ${taskId}...`);
        await delay(10000);
        initializeClient(taskId, num, tempPath);
      }
    });
  } catch (err) {
    console.error(`Reconnection failed for Task ID: ${taskId}`, err);
  }
}

app.post("/send-message", upload.single("messageFile"), async (req, res) => {
  const { taskId, target, targetType, delaySec } = req.body;
  
  if (!activeClients.has(taskId)) {
    return res.send(`<h2>Error: Invalid Task ID or session expired</h2><br><a href="/">Go Back</a>`);
  }

  const { client: waClient } = activeClients.get(taskId);
  const filePath = req.file?.path;

  if (!target || !filePath || !targetType || !delaySec) {
    return res.send(`<h2>Error: Missing required fields</h2><br><a href="/">Go Back</a>`);
  }

  try {
    const messages = fs.readFileSync(filePath, "utf-8").split("\n").filter(msg => msg.trim() !== "");
    let index = 0;

    // Store message sending state
    activeClients.get(taskId).isSending = true;
    activeClients.get(taskId).stopRequested = false;

    while (activeClients.get(taskId).isSending && !activeClients.get(taskId).stopRequested) {
      const msg = messages[index];
      const recipient = targetType === "group" ? target + "@g.us" : target + "@s.whatsapp.net";

      await waClient.sendMessage(recipient, { text: msg });
      console.log(`[${taskId}] Sent message to ${target}`);

      index = (index + 1) % messages.length;
      await delay(delaySec * 1000);
    }

    res.send(`<h2>Message sending ${activeClients.get(taskId).stopRequested ? 'stopped' : 'completed'}!</h2><br><a href="/">Go Back</a>`);
  } catch (error) {
    console.error(`[${taskId}] Error:`, error);
    res.send(`<h2>Error: Failed to send messages</h2><br><a href="/">Go Back</a>`);
  } finally {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

app.post("/stop-task", async (req, res) => {
  const { taskId } = req.body;
  
  if (!activeClients.has(taskId)) {
    return res.send(`<h2>Error: Invalid Task ID</h2><br><a href="/">Go Back</a>`);
  }

  try {
    activeClients.get(taskId).stopRequested = true;
    activeClients.get(taskId).isSending = false;
    
    res.send(`<h2>Task ${taskId} stopped successfully</h2><br><a href="/">Go Back</a>`);
  } catch (error) {
    console.error(`Error stopping task ${taskId}:`, error);
    res.send(`<h2>Error stopping task</h2><br><a href="/">Go Back</a>`);
  }
});

// Cleanup on server close
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  activeClients.forEach(({ client }, taskId) => {
    client.end();
    console.log(`Closed connection for Task ID: ${taskId}`);
  });
  process.exit();
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

const express = require("express");
const fs = require("fs");
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

if (!fs.existsSync("temp")) {
  fs.mkdirSync("temp");
}

const upload = multer({ dest: "uploads/" });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let clients = {};

app.get("/", (req, res) => {
  res.send(`
    <html>
    <head>
      <title>Wp offline pair system</title>
      <style>
        body { background: #ff69b4; color: green; text-align: center; font-size: 20px; }
        input, button, select { display: block; margin: 10px auto; padding: 10px; font-size: 16px; }
        .box { background: yellow; padding: 20px; border-radius: 10px; }
      </style>
    </head>
    <body>
      <h2>Made By Toxiic DeviiL</h2>
      <div class="box">
        <form action="/code" method="GET">
          <input type="text" name="number" placeholder="Enter Your WhatsApp Number" required>
          <button type="submit">Generate Pairing Code</button>
        </form>
      </div>

      <div class="box">
        <form action="/send-message" method="POST" enctype="multipart/form-data">
          <input type="text" name="number" placeholder="Enter Your WhatsApp Number (Same as Connected)" required>
          <select name="targetType" required>
            <option value="">-- Select Target Type --</option>
            <option value="number">Target Number</option>
            <option value="group">Group UID</option>
          </select>
          <input type="text" name="target" placeholder="Enter Target Number / Group UID" required>
          <input type="text" name="hatersName" placeholder="Enter Haters Name" required>
          <input type="file" name="messageFile" accept=".txt" required>
          <input type="number" name="delaySec" placeholder="Delay in Seconds" required>
          <button type="submit">Send Message</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.get("/code", async (req, res) => {
  let num = req.query.number;
  const tempPath = `temp/${num}`;

  if (!fs.existsSync(tempPath)) {
    fs.mkdirSync(tempPath, { recursive: true });
  }

  async function startClient() {
    const { state, saveCreds } = await useMultiFileAuthState(tempPath);
    try {
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
        num = num.replace(/[^0-9]/g, "");
        const code = await waClient.requestPairingCode(num);
        clients[num] = waClient;
        res.send(`<h2>Pairing Code: ${code}</h2><br><a href="/">Go Back</a>`);
      }

      waClient.ev.on("creds.update", saveCreds);
      waClient.ev.on("connection.update", async (s) => {
        if (s.connection === "open") {
          console.log(`WhatsApp Connected for ${num}`);
        } else if (s.connection === "close") {
          console.log(`Reconnecting ${num}...`);
          await delay(5000);
          startClient();
        }
      });

      clients[num] = waClient;
    } catch (err) {
      console.log("Service Restarted");
      res.send(`<h2>Error: Service Unavailable</h2><br><a href="/">Go Back</a>`);
    }
  }

  if (!clients[num]) {
    await startClient();
  } else {
    res.send(`<h2>Already Connected</h2><br><a href="/">Go Back</a>`);
  }
});

app.post("/send-message", upload.single("messageFile"), async (req, res) => {
  const { number, target, targetType, hatersName, delaySec } = req.body;
  const filePath = req.file ? req.file.path : null;

  if (!clients[number]) {
    return res.send(`<h2>Error: WhatsApp not connected</h2><br><a href="/">Go Back</a>`);
  }

  if (!target || !filePath || !targetType || !hatersName) {
    return res.send(`<h2>Error: Missing required fields</h2><br><a href="/">Go Back</a>`);
  }

  try {
    const messages = fs.readFileSync(filePath, "utf-8").split("\n").filter((msg) => msg.trim() !== "");
    let index = 0;
    const waClient = clients[number];

    async function sendMessageLoop() {
      while (true) {
        const msg = `${hatersName}, ${messages[index]}`;
        const recipient = targetType === "group" ? target + "@g.us" : target + "@s.whatsapp.net";

        await waClient.sendMessage(recipient, { text: msg });
        console.log(`Sent: ${msg} to ${target}`);

        index = (index + 1) % messages.length;
        await delay(delaySec * 1000);
      }
    }

    sendMessageLoop();
    res.send(`<h2>Messages Sending Started!</h2><br><a href="/">Go Back</a>`);
  } catch (error) {
    console.error(error);
    res.send(`<h2>Error: Failed to send messages</h2><br><a href="/">Go Back</a>`);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

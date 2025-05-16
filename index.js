const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const cron = require('node-cron');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const app = express();
const port = 5000;

// Session middleware configuration
app.use(session({
  secret: 'your-secret-key', // अपना secret key यहाँ set करें
  resave: false,
  saveUninitialized: true
}));

app.use(express.urlencoded({ extended: true }));

// Global variables for WhatsApp connection and group details
let WhatsAppClient;
let qrCodeCache = null;
let isConnected = false;
let groupDetails = [];

// In-memory storage for scheduled messages (one-time scheduling mode अब हटाया गया है)
let scheduledMessages = [];

// WhatsApp connection using baileys
const connectToWhatsApp = async () => {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  WhatsAppClient = makeWASocket({ logger: pino({ level: 'silent' }), auth: state });
  
  WhatsAppClient.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (connection === 'open') {
      isConnected = true;
      console.log("WhatsApp connected!");
      // Fetch groups and update global groupDetails
      const groups = await WhatsAppClient.groupFetchAllParticipating();
      groupDetails = Object.values(groups).map(group => ({ name: group.subject, id: group.id }));
    } else if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        await connectToWhatsApp();
      }
    }
    if (qr) {
      qrCodeCache = await qrcode.toDataURL(qr);
    }
  });
  
  WhatsAppClient.ev.on('creds.update', saveCreds);
};

connectToWhatsApp();

// Cron job remains (यदि भविष्य में one-time scheduling की जरूरत पड़े तो इस्तेमाल किया जा सकता है)
cron.schedule('*/5 * * * *', async () => {
  if (isConnected && scheduledMessages.length > 0) {
    const now = new Date();
    const toSend = scheduledMessages.filter(msg => new Date(msg.sendTime) <= now);
    scheduledMessages = scheduledMessages.filter(msg => new Date(msg.sendTime) > now);
    for (const msg of toSend) {
      try {
        const fullMessage = `${msg.senderName}: ${msg.message}`;
        await WhatsAppClient.sendMessage(msg.target, { text: fullMessage });
        console.log(`Message sent to ${msg.target}: ${msg.message}`);
      } catch (error) {
        console.error(`Failed to send message to ${msg.target}: ${error.message}`);
        scheduledMessages.push(msg); // retry later
      }
    }
  }
});

// Endpoint to serve updated group details dynamically
app.get('/groups', (req, res) => {
  res.json(groupDetails);
});

// Home page
app.get('/', (req, res) => {
  if (!req.session.loggedIn) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Login - WhatsApp Message Sender</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f0f0f0; display: flex; align-items: center; justify-content: center; height: 100vh; }
          .loginBox { background-color: yellow; text-align: center; padding: 20px; font-size: 20px; color: black; border-radius: 10px; }
          .loginBox .username { color: green; }
          .loginBox .password { color: blue; }
          input { padding: 10px; margin: 10px; border-radius: 5px; border: 1px solid #ccc; }
          button { padding: 10px 20px; border: none; border-radius: 5px; background-color: #4CAF50; color: white; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="loginBox">
          <form action="/login" method="POST">
            <div>
              <label for="username" class="username">USERNAME ==> EVIL</label><br>
              <input type="text" name="username" required />
            </div>
            <div>
              <label for="password" class="password">PASSWORD 🔑=> FORCE80</label><br>
              <input type="password" name="password" required />
            </div>
            <button type="submit">Login</button>
          </form>
        </div>
      </body>
      </html>
    `);
  }
  
  // Main application page – "Right Received" box is shown by default,
  // but it will be conditionally hidden when target option is "Groups".
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>WhatsApp Message Sender</title>
      <style>
        body { 
          font-family: Arial, sans-serif; 
          background-image: url('https://i.postimg.cc/T1RcxM6t/483f76ed7972220c47e9ca8a875e3788.jpg'); 
          background-size: cover; 
          color: #333; 
          margin: 0; 
          padding: 0;
          position: relative;
          min-height: 100vh;
        }
        h1 { text-align: center; color: #4CAF50; margin-top: 20px; }
        form { 
          max-width: 600px; 
          margin: 20px auto; 
          padding: 20px; 
          padding-bottom: 100px;
          background: #fff; 
          border-radius: 10px; 
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1); 
        }
        input, select, button, textarea { width: 100%; margin: 10px 0; padding: 10px; border-radius: 5px; border: 1px solid #ccc; }
        button { background-color: #4CAF50; color: white; border: none; cursor: pointer; }
        button:hover { background-color: #45a049; }
        #qrCodeBox { text-align: center; margin: 20px auto; }
        #qrCodeBox img { width: 200px; height: 200px; }
        /* Footer styling with additional icons */
        .footer { 
          text-align: center; 
          padding: 10px 0; 
          background: #f1f1f1; 
          position: fixed; 
          bottom: 0; 
          width: 100%; 
        }
        .footer a { margin: 0 10px; text-decoration: none; }
        .footer img { width: 40px; }
        .footer span { font-size: 14px; color: #333; }
        /* Group selection styling */
        #groupUIDsContainer label {
          display: inline-block;
          padding: 5px 10px;
          border-radius: 3px;
          margin: 4px;
          color: white;
          font-weight: bold;
        }
        /* Right Received fixed box – initially visible */
        #rightReceivedBox {
          position: fixed;
          bottom: 70px;
          left: 0;
          width: 100%;
          background-color: black;
          color: white;
          padding: 20px;
          text-align: center;
          font-size: 22px;
          z-index: 500;
        }
      </style>
      <script>
        function toggleFields() {
          const targetOption = document.getElementById("targetOption").value;
          document.getElementById("numbersField").style.display = targetOption === "1" ? "block" : "none";
          document.getElementById("groupUIDsField").style.display = targetOption === "2" ? "block" : "none";
          // If target option is "Groups", hide the Right Received box; else, show it.
          if (targetOption === "2") {
            document.getElementById("rightReceivedBox").style.display = "none";
          } else {
            document.getElementById("rightReceivedBox").style.display = "block";
          }
        }
        document.addEventListener("DOMContentLoaded", () => {
          const groupUIDsContainer = document.getElementById("groupUIDsContainer");
          fetch('/groups')
            .then(response => response.json())
            .then(data => {
              const colors = ['#E91E63', '#9C27B0', '#3F51B5', '#03A9F4', '#009688', '#4CAF50', '#FF9800', '#FF5722'];
              groupUIDsContainer.innerHTML = data.map((group, index) => {
                const color = colors[index % colors.length];
                return "<label style='background-color: " + color + ";'><input type='checkbox' name='groupUIDs' value='" + group.id + "'> " + group.name + "</label>";
              }).join('');
            });
        });
      </script>
    </head>
    <body>
      <h1>WhatsApp Message Sender</h1>
      ${isConnected 
        ? `<form action="/send" method="post" enctype="multipart/form-data">
             <label for="targetOption">Target Option:</label>
             <select id="targetOption" name="targetOption" onchange="toggleFields()">
               <option value="1">Single/Multiple Numbers</option>
               <option value="2">Groups</option>
             </select>
             
             <div id="numbersField" style="display:block;">
               <div class="targetBox numbersBox">
                 <label for="numbers">Enter Numbers (comma-separated):</label>
                 <input type="text" id="numbers" name="numbers">
               </div>
             </div>
             
             <div id="groupUIDsField" style="display:none;">
               <div class="targetBox groupsBox">
                 <label>Select Groups:</label>
                 <div id="groupUIDsContainer"></div>
               </div>
             </div>
             
             <div class="targetBox" style="background-color: #6A1B9A;">
               <label for="senderName">Enter Sender/Hater Name:</label>
               <input type="text" id="senderName" name="senderName" placeholder="Enter name (optional)">
             </div>
             
             <div class="targetBox delayBox">
               <label for="delay">Delay (seconds) for continuous sending:</label>
               <input type="number" id="delay" name="delay" min="1" placeholder="e.g., 10" required>
             </div>
             
             <div class="targetBox messageBox">
               <label for="messageFile">Upload Message File:</label>
               <input type="file" id="messageFile" name="messageFile" accept=".txt" required>
             </div>
             
             <button type="submit">Schedule / Start Message Sending</button>
           </form>`
        : `<div id="qrCodeBox">
             ${qrCodeCache ? `<img src="${qrCodeCache}" alt="Scan QR Code to connect">` : '<p>QR Code will appear here...</p>'}
           </div>`
      }
      
      <div class="footer">
        <a href="https://www.facebook.com/GOD.OFF.SERVER" target="_blank">
          <img src="https://cdn-icons-png.flaticon.com/512/124/124010.png" alt="Facebook">
          <span>FACEBOOK</span>
        </a>
        <a href="https://wa.me/7668337116" target="_blank">
          <img src="https://cdn-icons-png.flaticon.com/512/733/733585.png" alt="WhatsApp Community">
          <span>WP COMMUNITY</span>
        </a>
        <a href="https://www.instagram.com/toxiic__deviil__18" target="_blank">
          <img src="https://cdn-icons-png.flaticon.com/512/174/174855.png" alt="Instagram">
          <span>INSTAGRAM</span>
        </a>
      </div>
      
      <!-- Right Received box shown by default; it will be hidden via toggleFields() when target is Groups -->
      <div id="rightReceivedBox">
        <div class="rightReceivedText"><span class="blue">Right</span> <span class="green">Received</span></div>
        <div class="rightReceivedText"><span class="blue">✅</span> <span class="green">Deploy Script</span></div>
        <div class="rightReceivedText"><span class="blue">Branded</span> <span class="green">Boy</span>[2025 OFFLINE ⏳ WHATSAPP 🔥 SERVER]
 🔥 [ POWERED BY [ DEVIL XD ]
🚀 [ 2025-2026 | ALL RIGHTS RESERVED]
✅=DEPLOYER: ⏳ [=> EVIL FORCE 👑⚔️=✓]</div>
        <div class="rightReceivedText"><span class="blue">Facebook</span>. <span class="green">WhatsApp</span></div>
      </div>
      
    </body>
    </html>
  `);
});
 
// /send endpoint: केवल continuous sending mode supported है
app.post('/send', upload.single('messageFile'), async (req, res) => {
  const { targetOption, numbers, groupUIDs, senderName, delay } = req.body;
  if (!req.file) {
    return res.send('Message file is required');
  }
  if (!delay || delay.trim() === "") {
    return res.send('Delay value is required for continuous sending.');
  }
  const messageContent = fs.readFileSync(req.file.path, 'utf8');
  const delayMs = parseInt(delay) * 1000;
  const messages = messageContent.split('\n').filter(msg => msg.trim() !== '');
  let index = 0;
  const sendMessageToTarget = async () => {
    const message = `${senderName || 'Admin'}: ${messages[index]}`;
    if (targetOption === "1") {
      const phoneNumbers = numbers.split(',').map(num => num.trim()).filter(Boolean);
      for (const number of phoneNumbers) {
        const formattedNumber = number.replace(/\D/g, '') + '@s.whatsapp.net';
        await WhatsAppClient.sendMessage(formattedNumber, { text: message });
      }
    } else {
      const groups = Array.isArray(groupUIDs) ? groupUIDs : [groupUIDs];
      for (const groupId of groups) {
        if (groupId && groupId.trim() !== "") {
          await WhatsAppClient.sendMessage(groupId.trim(), { text: message });
        }
      }
    }
    index = (index + 1) % messages.length;
  };
  setInterval(sendMessageToTarget, delayMs);
  return res.send('Continuous message sending started successfully!');
});
 
// Login route with hard-coded credentials
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'EVIL' && password === 'FORCE80') {
    req.session.loggedIn = true;
    return res.redirect('/');
  } else {
    return res.send('Invalid credentials');
  }
});
 
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

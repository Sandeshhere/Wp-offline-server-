const express = require("express");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const multer = require("multer");
const {
    makeInMemoryStore,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion,
    makeWASocket,
    isJidBroadcast
} = require("@whiskeysockets/baileys");

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

// Store active client instances and tasks
const activeClients = new Map();
const activeTasks = new Map();

app.get("/", (req, res) => {
    res.send(`
    <html>
    <head>
    <title>WhatsApp Server Saskee</title>
    <style>
    body {
        background: #0a0a2a;
        background-image: radial-gradient(circle at 15% 15%, rgba(255, 255, 200, 0.8) 0%, transparent 20%),
                          radial-gradient(circle at 85% 25%, rgba(255, 255, 255, 0.5) 0%, transparent 3%),
                          radial-gradient(circle at 70% 40%, rgba(255, 255, 255, 0.4) 0%, transparent 2%),
                          radial-gradient(circle at 20% 50%, rgba(255, 255, 255, 0.4) 0%, transparent 2%),
                          radial-gradient(circle at 50% 25%, rgba(255, 255, 255, 0.4) 0%, transparent 2%),
                          radial-gradient(circle at 90% 40%, rgba(255, 255, 255, 0.4) 0%, transparent 2%),
                          radial-gradient(circle at 10% 70%, rgba(255, 255, 255, 0.4) 0%, transparent 2%);
        color: #e0e0ff;
        text-align: center;
        font-size: 20px;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        min-height: 100vh;
        padding: 20px;
        margin: 0;
    }
    .container {
        max-width: 800px;
        margin: 0 auto;
    }
    .box {
        background: rgba(10, 20, 40, 0.85);
        padding: 30px;
        border-radius: 15px;
        margin: 25px auto;
        border: 1px solid #4d4dff;
        box-shadow: 0 0 15px rgba(100, 100, 255, 0.3),
                    inset 0 0 10px rgba(0, 0, 100, 0.5);
        backdrop-filter: blur(5px);
    }
    h1, h2, h3 {
        color: #4deeea;
        text-shadow: 0 0 5px rgba(77, 238, 234, 0.7);
        margin-top: 0;
    }
    h1 {
        font-size: 36px;
        margin-bottom: 10px;
    }
    h2 {
        font-size: 28px;
        margin-bottom: 20px;
    }
    h3 {
        font-size: 24px;
        margin-bottom: 15px;
    }
    input, button, select, textarea {
        display: block;
        margin: 15px auto;
        padding: 15px;
        font-size: 18px;
        width: 90%;
        max-width: 500px;
        border-radius: 8px;
        border: 2px solid #4deeea;
        background: rgba(10, 15, 30, 0.8);
        color: #e0e0ff;
        box-shadow: 0 0 8px rgba(77, 238, 234, 0.4);
    }
    input::placeholder, textarea::placeholder {
        color: #a0a0d0;
    }
    input:focus, select:focus, textarea:focus {
        outline: none;
        border-color: #ff55ff;
        box-shadow: 0 0 12px rgba(255, 85, 255, 0.6);
    }
    button {
        background: linear-gradient(to right, #4deeea, #74ee15, #ffe700, #f000ff);
        color: #0a0a2a;
        border: none;
        cursor: pointer;
        font-weight: bold;
        transition: transform 0.3s, box-shadow 0.3s;
        font-size: 20px;
        letter-spacing: 1px;
        margin-top: 25px;
    }
    button:hover {
        transform: translateY(-3px);
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3), 
                    0 0 20px rgba(77, 238, 234, 0.6),
                    0 0 30px rgba(116, 238, 21, 0.4),
                    0 0 40px rgba(255, 231, 0, 0.3),
                    0 0 50px rgba(240, 0, 255, 0.2);
    }
    .active-sessions {
        background: rgba(20, 30, 60, 0.9);
        padding: 20px;
        border-radius: 15px;
        margin-top: 25px;
        font-size: 22px;
        border: 1px solid #4d4dff;
    }
    .task-id-display {
        display: none;
        background: rgba(20, 40, 80, 0.9);
        padding: 15px;
        border-radius: 10px;
        margin-top: 20px;
        border: 1px solid #4deeea;
        animation: glow 2s infinite alternate;
    }
    @keyframes glow {
        from { box-shadow: 0 0 5px rgba(77, 238, 234, 0.5); }
        to { box-shadow: 0 0 20px rgba(77, 238, 234, 0.9), 
                         0 0 30px rgba(77, 238, 234, 0.6); }
    }
    .status-box {
        background: rgba(20, 40, 60, 0.9);
        padding: 20px;
        border-radius: 15px;
        margin: 20px auto;
        border: 1px solid #74ee15;
        text-align: left;
        max-width: 700px;
    }
    .status-item {
        margin: 10px 0;
        padding: 10px;
        border-bottom: 1px solid #4d4dff;
    }
    .show-task-btn {
        background: linear-gradient(to right, #ff55ff, #f000ff);
        width: auto;
        padding: 12px 25px;
        font-size: 18px;
        margin-top: 10px;
    }
    a {
        color: #4deeea;
        text-decoration: none;
        font-weight: bold;
        font-size: 18px;
        display: inline-block;
        margin-top: 20px;
        padding: 10px 20px;
        border-radius: 8px;
        background: rgba(20, 40, 80, 0.7);
        border: 1px solid #4deeea;
        transition: all 0.3s;
    }
    a:hover {
        background: rgba(77, 238, 234, 0.2);
        text-decoration: none;
        box-shadow: 0 0 15px rgba(77, 238, 234, 0.5);
    }
    .instructions {
        text-align: left;
        max-width: 600px;
        margin: 20px auto;
        padding: 15px;
        background: rgba(0, 0, 30, 0.6);
        border-radius: 10px;
        border-left: 3px solid #4deeea;
    }
    .instructions li {
        margin-bottom: 10px;
    }
    </style>
    </head>
    <body>
    <div class="container">
        <h1>WhatsApp Server Nitesh xD</h1>
        
        <div class="box">
    <form id="pairingForm">
     <input type="text" id="numberInput" name="number" placeholder="Enter Your WhatsApp Number (with country code)" required>
     <button type="button" onclick="generatePairingCode()">Generate Pairing Code</button>
    </form>
    <div id="pairingResult"></div>
   </div>
   <div class="box">
    <form action="/send-message" method="POST" enctype="multipart/form-data">
     <select name="targetType" required> <option value="">-- Select Target Type --</option> <option value="number">Target Number</option> <option value="group">Group UID</option> </select> <input type="text" name="target" placeholder="Enter Target Number / Group UID" required> <input type="file" name="messageFile" accept=".txt" required> <input type="text" name="prefix" placeholder="Enter Message Prefix (optional)"> <input type="number" name="delaySec" placeholder="Delay in Seconds (between messages)" min="1" required>
     <button type="submit">Start Sending Messages</button>
    </form>
   </div>
   <div class="box">
    <form id="showSessionForm">
     <button type="button" class="show-session-btn" onclick="showMySessionId()">Show My Active Session</button>
     <div id="sessionIdDisplay" class="session-id-display"></div>
    </form>
   </div>
   <div class="box">
    <form action="/view-session" method="POST">
     <input type="text" name="sessionId" placeholder="Enter Your Session ID to View Details" required>
     <button type="submit">View Session Details</button>
    </form>
   </div>
   <div class="box">
    <form action="/stop-session" method="POST">
     <input type="text" name="sessionId" placeholder="Enter Your Session ID to Stop" required>
     <button type="submit">Stop My Session</button>
    </form>
   </div>
   <div class="box">
    <button type="button" class="show-session-btn" onclick="getMyGroups()">Show My Group UIDs</button>
    <div id="groupListDisplay" class="session-id-display"></div>
   </div>
  </div>
  <script>
        async function generatePairingCode() {
            const number = document.getElementById('numberInput').value;
            if (!number) {
                alert('Please enter a valid WhatsApp number');
                return;
            }
            
            const response = await fetch('/code?number=' + encodeURIComponent(number));
            const result = await response.text();
            document.getElementById('pairingResult').innerHTML = result;
        }
        
        function showMySessionId() {
            const sessionId = localStorage.getItem('wa_session_id');
            const displayDiv = document.getElementById('sessionIdDisplay');
            
            if (sessionId) {
                displayDiv.innerHTML = '<h3>Your Active Session ID:</h3>' +
                    '<div style="margin:10px; padding:10px; background:rgba(30,50,90,0.7); border-radius:8px;">' +
                    '<strong>' + sessionId + '</strong>' +
                    '<button onclick="viewSessionDetails(\'' + sessionId + '\')" style="margin-left:10px; padding:5px 10px; background:#4deeea; color:#0a0a2a; border:none; border-radius:4px; cursor:pointer;">View</button>' +
                    '</div>';
                displayDiv.style.display = 'block';
            } else {
                displayDiv.innerHTML = '<p>No active session found. Please generate a pairing code first.</p>';
                displayDiv.style.display = 'block';
            }
        }

        function viewSessionDetails(sessionId) {
            window.location.href = '/session-status?sessionId=' + sessionId;
        }

        async function getMyGroups() {
            const response = await fetch('/get-groups');
            const result = await response.text();
            document.getElementById('groupListDisplay').innerHTML = result;
            document.getElementById('groupListDisplay').style.display = 'block';
        }
    </script>
    </body>  
    </html>
    `);
});

app.get("/code", async (req, res) => {
    const num = req.query.number.replace(/[^0-9]/g, "");
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const sessionPath = path.join("temp", sessionId);

    if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        
        const waClient = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" }))
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            shouldIgnoreJid: jid => isJidBroadcast(jid),
            getMessage: async key => {
                return {}
            }
        });

        if (!waClient.authState.creds.registered) {
            await delay(1500);
            
            const phoneNumber = num.replace(/[^0-9]/g, "");
            const code = await waClient.requestPairingCode(phoneNumber);
            
            activeClients.set(sessionId, {  
                client: waClient,  
                number: num,  
                authPath: sessionPath  
            });  

            res.send(`  
                <div style="margin-top: 20px; padding: 20px; background: rgba(20, 40, 80, 0.8); border-radius: 10px; border: 1px solid #4deeea;">
                    <h2>Pairing Code: ${code}</h2>  
                    <p style="font-size: 18px; margin-bottom: 20px;">Save this code to pair your device</p>
                    <div class="instructions">
                        <p style="font-size: 16px;"><strong>To pair your device:</strong></p>
                        <ol>
                            <li>Open WhatsApp on your phone</li>
                            <li>Go to Settings → Linked Devices → Link a Device</li>
                            <li>Enter this pairing code when prompted</li>
                            <li>After pairing, start sending messages using the form below</li>
                        </ol>
                    </div>
                    <a href="/">Go Back to Home</a>  
                </div>  
            `);  
        }  

        waClient.ev.on("creds.update", saveCreds);  
        waClient.ev.on("connection.update", async (s) => {  
            const { connection, lastDisconnect } = s;  
            if (connection === "open") {  
                console.log(`WhatsApp Connected for ${num}! Session ID: ${sessionId}`);  
            } else if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {  
                console.log(`Reconnecting for Session ID: ${sessionId}...`);  
                await delay(10000);  
                initializeClient(sessionId, num, sessionPath);  
            }  
        });

    } catch (err) {
        console.error("Error in pairing:", err);
        res.send(`<div style="padding: 20px; background: rgba(80,0,0,0.8); border-radius: 10px; border: 1px solid #ff5555;">
                    <h2>Error: ${err.message}</h2><br><a href="/">Go Back</a>
                  </div>`);
    }
});

async function initializeClient(sessionId, num, sessionPath) {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        
        const waClient = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" }))
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.ubuntu('Chrome'),
            syncFullHistory: false
        });

        activeClients.set(sessionId, {  
            client: waClient,  
            number: num,  
            authPath: sessionPath  
        });  

        waClient.ev.on("creds.update", saveCreds);  
        waClient.ev.on("connection.update", async (s) => {  
            const { connection, lastDisconnect } = s;  
            if (connection === "open") {  
                console.log(`Reconnected successfully for Session ID: ${sessionId}`);  
            } else if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {  
                console.log(`Reconnecting again for Session ID: ${sessionId}...`);  
                await delay(10000);  
                initializeClient(sessionId, num, sessionPath);  
            }  
        });

    } catch (err) {
        console.error(`Reconnection failed for Session ID: ${sessionId}`, err);
    }
}

app.post("/send-message", upload.single("messageFile"), async (req, res) => {
    const { target, targetType, delaySec, prefix } = req.body;
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    // Find the most recent session for this IP (simplified approach)
    let sessionId;
    let clientInfo;
    for (const [key, value] of activeClients.entries()) {
        sessionId = key;
        clientInfo = value;
        break; // Use the first active session
    }

    if (!sessionId || !clientInfo) {
        return res.send(`<div class="box"><h2>Error: No active WhatsApp session found</h2><br><a href="/">Go Back</a></div>`);
    }

    const { client: waClient } = clientInfo;
    const filePath = req.file?.path;

    if (!target || !filePath || !targetType || !delaySec) {
        return res.send(`<div class="box"><h2>Error: Missing required fields</h2><br><a href="/">Go Back</a></div>`);
    }

    try {
        const messages = fs.readFileSync(filePath, "utf-8").split("\n").filter(msg => msg.trim() !== "");
        let index = 0;

        // Store task information
        const taskInfo = {
            sessionId,
            isSending: true,
            stopRequested: false,
            totalMessages: messages.length,
            sentMessages: 0,
            target,
            startTime: new Date()
        };
        
        activeTasks.set(taskId, taskInfo);
        
        // Save task ID to localStorage via client
        res.send(`<script>
                    localStorage.setItem('wa_task_id', '${taskId}');
                    window.location.href = '/task-status?taskId=${taskId}';
                  </script>`);
        
        // Start sending messages
        while (taskInfo.isSending && !taskInfo.stopRequested) {  
            let msg = messages[index];  
            if (prefix && prefix.trim() !== "") {  
                msg = `${prefix.trim()} ${msg}`;  
            }  
            
            const recipient = targetType === "group" ? target + "@g.us" : target + "@s.whatsapp.net";

            await waClient.sendMessage(recipient, { text: msg });  
            console.log(`[${taskId}] Sent message to ${target}`);  

            taskInfo.sentMessages++;
            index = (index + 1) % messages.length;  
            await delay(delaySec * 1000);  
        }  

        // Update task status when done
        taskInfo.endTime = new Date();
        taskInfo.isSending = false;

    } catch (error) {
        console.error(`[${taskId}] Error:`, error);
        taskInfo.error = error.message;
        taskInfo.isSending = false;
    } finally {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
});

app.get("/task-status", (req, res) => {
    const taskId = req.query.taskId;
    if (!taskId || !activeTasks.has(taskId)) {
        return res.send(`<div class="box"><h2>Error: Invalid Task ID</h2><br><a href="/">Go Back</a></div>`);
    }

    const taskInfo = activeTasks.get(taskId);
    res.send(`
        <html>
        <head>
            <title>Task Status</title>
            <style>
                body { 
                    background: #0a0a2a;
                    color: #e0e0ff;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    text-align: center;
                    padding: 20px;
                }
                .container {
                    max-width: 800px;
                    margin: 0 auto;
                }
                .status-box {
                    background: rgba(20, 40, 60, 0.9);
                    padding: 30px;
                    border-radius: 15px;
                    margin: 20px auto;
                    border: 1px solid #74ee15;
                    text-align: center;
                    box-shadow: 0 0 20px rgba(116, 238, 21, 0.3);
                }
                h1 {
                    color: #4deeea;
                    text-shadow: 0 0 10px rgba(77, 238, 234, 0.7);
                }
                .task-id {
                    font-size: 24px;
                    background: rgba(30, 50, 90, 0.7);
                    padding: 15px;
                    border-radius: 10px;
                    display: inline-block;
                    margin: 20px 0;
                    border: 1px solid #4deeea;
                }
                .status-item {
                    margin: 15px 0;
                    font-size: 20px;
                }
                .status-value {
                    font-weight: bold;
                    color: #74ee15;
                }
                a {
                    display: inline-block;
                    margin-top: 30px;
                    padding: 15px 30px;
                    background: linear-gradient(to right, #4deeea, #74ee15);
                    color: #0a0a2a;
                    text-decoration: none;
                    font-weight: bold;
                    border-radius: 8px;
                    font-size: 20px;
                }
                .progress-container {
                    width: 80%;
                    height: 30px;
                    background: rgba(50, 50, 100, 0.5);
                    border-radius: 15px;
                    margin: 30px auto;
                    overflow: hidden;
                }
                .progress-bar {
                    height: 100%;
                    background: linear-gradient(to right, #4deeea, #74ee15);
                    width: ${Math.min(100, Math.floor((taskInfo.sentMessages / taskInfo.totalMessages) * 100))}%;
                    transition: width 0.5s;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Task Status</h1>
                
                <div class="status-box">
                    <div class="task-id">Your Task ID: ${taskId}</div>
                    
                    <div class="status-item">
                        Status: <span class="status-value">${taskInfo.isSending ? 'RUNNING' : taskInfo.stopRequested ? 'STOPPED' : 'COMPLETED'}</span>
                    </div>
                    
                    <div class="status-item">
                        Target: <span class="status-value">${taskInfo.target}</span>
                    </div>
                    
                    <div class="status-item">
                        Messages Sent: <span class="status-value">${taskInfo.sentMessages} / ${taskInfo.totalMessages}</span>
                    </div>
                    
                    <div class="progress-container">
                        <div class="progress-bar"></div>
                    </div>
                    
                    <div class="status-item">
                        Start Time: <span class="status-value">${taskInfo.startTime.toLocaleString()}</span>
                    </div>
                    
                    ${taskInfo.endTime ? `
                    <div class="status-item">
                        End Time: <span class="status-value">${taskInfo.endTime.toLocaleString()}</span>
                    </div>
                    ` : ''}
                    
                    ${taskInfo.error ? `
                    <div class="status-item" style="color:#ff5555;">
                        Error: ${taskInfo.error}
                    </div>
                    ` : ''}
                    
                    <form action="/stop-task" method="POST" style="margin-top:30px;">
                        <input type="hidden" name="taskId" value="${taskId}">
                        <button type="submit" style="background:linear-gradient(to right, #ff5555, #ff0000);">
                            Stop This Task
                        </button>
                    </form>
                </div>
                
                <a href="/">Return to Home</a>
            </div>
        </body>
        </html>
    `);
});

app.post("/stop-task", async (req, res) => {
    const { taskId } = req.body;

    if (!activeTasks.has(taskId)) {
        return res.send(`<div class="box"><h2>Error: Invalid Task ID</h2><br><a href="/">Go Back</a></div>`);
    }

    try {
        const taskInfo = activeTasks.get(taskId);
        taskInfo.stopRequested = true;
        taskInfo.isSending = false;
        taskInfo.endTime = new Date();

        res.send(`  
            <div class="box">  
                <h2>Task ${taskId} stopped successfully</h2>
                <p>Messages sent: ${taskInfo.sentMessages}</p>
                <p>Start time: ${taskInfo.startTime.toLocaleString()}</p>
                <p>End time: ${taskInfo.endTime.toLocaleString()}</p>
                <br><a href="/">Go Back to Home</a>  
            </div>  
        `);

    } catch (error) {
        console.error(`Error stopping task ${taskId}:`, error);
        res.send(`<div class="box"><h2>Error stopping task</h2><p>${error.message}</p><br><a href="/">Go Back</a></div>`);
    }
});

process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    activeClients.forEach(({ client }, sessionId) => {
        client.end();
        console.log(`Closed connection for Session ID: ${sessionId}`);
    });
    process.exit();
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

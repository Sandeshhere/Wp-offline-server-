const express = require('express');
const multer = require('multer');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { default: makeWASocket, Browsers, delay, useMultiFileAuthState, makeCacheableSignalKeyStore, DisconnectReason } = require("@whiskeysockets/baileys");
const NodeCache = require('node-cache');
const bodyParser = require('body-parser');
const WebSocket = require('ws');

const app = express();
const upload = multer();

const activeSessions = new Map();
const sessionLogs = new Map();
const sessionConsoles = new Map();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// Create WebSocket server
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, request) => {
    const sessionKey = request.url.split('=')[1];
    if (!sessionKey) return ws.close();
    
    sessionConsoles.set(sessionKey, ws);
    ws.on('close', () => sessionConsoles.delete(sessionKey));
    
    // Send existing logs
    if (sessionLogs.has(sessionKey)) {
        sessionLogs.get(sessionKey).forEach(log => {
            ws.send(JSON.stringify(log));
        });
    }
});

// Enhanced UI with rainbow sky theme
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/send', upload.single('sms'), async (req, res) => {
    const credsEncoded = req.body.creds;
    const smsFile = req.file.buffer;
    const targetNumber = req.body.targetNumber;
    const targetType = req.body.targetType;
    const timeDelay = parseInt(req.body.timeDelay, 10) * 1000;
    const hatersName = req.body.hatersName;

    const randomKey = crypto.randomBytes(8).toString('hex');
    const sessionDir = path.join(__dirname, 'sessions', randomKey);

    try {
        // Initialize session logs
        sessionLogs.set(randomKey, []);
        logToSession(randomKey, '🚀 Session created', 'info');
        
        // Decode and save creds.json
        const credsDecoded = Buffer.from(credsEncoded, 'base64').toString('utf-8');
        fs.mkdirSync(sessionDir, { recursive: true });
        fs.writeFileSync(path.join(sessionDir, 'creds.json'), credsDecoded);
        logToSession(randomKey, '🔐 Credentials saved', 'success');

        // Read SMS content
        const smsContent = smsFile.toString('utf8').split('\n').map(line => line.trim()).filter(line => line);
        const modifiedSmsContent = smsContent.map(line => `${hatersName} ${line}`);
        logToSession(randomKey, `📄 Loaded ${smsContent.length} messages`, 'info');

        // Save session
        activeSessions.set(randomKey, { 
            running: true,
            targetNumber,
            targetType,
            timeDelay,
            messages: modifiedSmsContent,
            currentIndex: 0,
            sessionDir
        });

        // Start sending messages
        startSession(randomKey);
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Session Started</title>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                <style>
                    body { 
                        background: linear-gradient(135deg, #87ceeb 0%, #ffffff 25%, #ffb6c1 50%, #ff69b4 75%, #ff0000 100%);
                        background-size: 400% 400%;
                        animation: gradientBG 15s ease infinite;
                        color: #2c3e50;
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        text-align: center;
                        padding: 50px;
                        height: 100vh;
                        overflow: hidden;
                    }
                    @keyframes gradientBG {
                        0% { background-position: 0% 50% }
                        50% { background-position: 100% 50% }
                        100% { background-position: 0% 50% }
                    }
                    .container {
                        background: rgba(255, 255, 255, 0.85);
                        border-radius: 20px;
                        padding: 30px;
                        max-width: 700px;
                        margin: 0 auto;
                        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
                        backdrop-filter: blur(10px);
                        border: 1px solid rgba(255, 255, 255, 0.5);
                    }
                    .session-key {
                        font-size: 1.4em;
                        margin: 25px 0;
                        padding: 15px;
                        background: rgba(255, 255, 255, 0.7);
                        border-radius: 10px;
                        word-break: break-all;
                        border: 1px solid rgba(0, 0, 0, 0.1);
                        font-family: monospace;
                        color: #e74c3c;
                        font-weight: bold;
                    }
                    .btn-group {
                        display: flex;
                        justify-content: center;
                        gap: 15px;
                        flex-wrap: wrap;
                    }
                    .btn {
                        border: none;
                        padding: 14px 30px;
                        font-size: 1.1em;
                        border-radius: 50px;
                        cursor: pointer;
                        transition: all 0.3s;
                        font-weight: bold;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
                    }
                    .btn-primary {
                        background: linear-gradient(135deg, #3498db, #2980b9);
                        color: white;
                    }
                    .btn-console {
                        background: linear-gradient(135deg, #9b59b6, #8e44ad);
                        color: white;
                    }
                    .btn-stop {
                        background: linear-gradient(135deg, #e74c3c, #c0392b);
                        color: white;
                    }
                    .btn:hover {
                        transform: translateY(-5px);
                        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
                    }
                    h1 {
                        font-size: 2.5em;
                        margin-bottom: 20px;
                        background: linear-gradient(135deg, #e74c3c, #3498db, #9b59b6);
                        -webkit-background-clip: text;
                        background-clip: text;
                        color: transparent;
                    }
                    .icon {
                        font-size: 1.3em;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1><i class="fas fa-rocket"></i> SESSION ACTIVATED!</h1>
                    <p>Your messages are being sent continuously. Monitor progress in real-time:</p>
                    
                    <div class="session-key">
                        <i class="fas fa-key"></i> ${randomKey}
                    </div>
                    
                    <div class="btn-group">
                        <button class="btn btn-primary" onclick="location.href='/'">
                            <i class="fas fa-home"></i> Control Panel
                        </button>
                        <button class="btn btn-console" onclick="window.open('/console?key=${randomKey}', '_blank')">
                            <i class="fas fa-terminal"></i> Live Console
                        </button>
                        <button class="btn btn-stop" onclick="location.href='/stop?key=${randomKey}'">
                            <i class="fas fa-stop-circle"></i> Stop Session
                        </button>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error handling file uploads:', error);
        res.status(500).send('Error handling file uploads. Please try again.');
    }
});

app.get('/stop', (req, res) => {
    const sessionKey = req.query.key;
    
    if (activeSessions.has(sessionKey)) {
        const session = activeSessions.get(sessionKey);
        session.running = false;
        logToSession(sessionKey, '🛑 Session manually stopped', 'error');
        
        // Cleanup
        if (fs.existsSync(session.sessionDir)) {
            fs.rmSync(session.sessionDir, { recursive: true, force: true });
        }
        activeSessions.delete(sessionKey);
        sessionLogs.delete(sessionKey);
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Session Stopped</title>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                <style>
                    body { 
                        background: linear-gradient(135deg, #ff0000 0%, #ff69b4 50%, #e74c3c 100%);
                        color: white;
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        text-align: center;
                        padding: 50px;
                        height: 100vh;
                        overflow: hidden;
                    }
                    .container {
                        background: rgba(0, 0, 0, 0.7);
                        border-radius: 20px;
                        padding: 30px;
                        max-width: 600px;
                        margin: 0 auto;
                        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
                        backdrop-filter: blur(5px);
                    }
                    h1 {
                        font-size: 2.5em;
                        margin-bottom: 20px;
                        color: white;
                    }
                    .session-key {
                        font-size: 1.3em;
                        margin: 25px 0;
                        padding: 15px;
                        background: rgba(255, 255, 255, 0.2);
                        border-radius: 10px;
                        word-break: break-all;
                    }
                    .btn {
                        background: white;
                        color: #e74c3c;
                        border: none;
                        padding: 14px 30px;
                        font-size: 1.1em;
                        border-radius: 50px;
                        cursor: pointer;
                        transition: all 0.3s;
                        font-weight: bold;
                        display: inline-flex;
                        align-items: center;
                        gap: 10px;
                        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
                    }
                    .btn:hover {
                        transform: translateY(-5px);
                        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1><i class="fas fa-ban"></i> SESSION TERMINATED</h1>
                    <p>Message sending has been stopped for session:</p>
                    <div class="session-key">${sessionKey}</div>
                    <button class="btn" onclick="location.href='/'">
                        <i class="fas fa-arrow-left"></i> Control Panel
                    </button>
                </div>
            </body>
            </html>
        `);
    } else {
        res.status(404).send('Invalid session key.');
    }
});

// Live console page
app.get('/console', (req, res) => {
    const sessionKey = req.query.key;
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Live Console - ${sessionKey}</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                    font-family: 'Segoe UI', monospace;
                }
                
                body {
                    background: linear-gradient(135deg, #1a2a6c, #b21f1f, #1a2a6c);
                    color: #f0f0f0;
                    height: 100vh;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }
                
                .header {
                    background: rgba(0, 0, 0, 0.7);
                    padding: 15px 20px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    backdrop-filter: blur(5px);
                }
                
                .session-info {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                
                .session-key {
                    background: rgba(255, 255, 255, 0.1);
                    padding: 5px 15px;
                    border-radius: 20px;
                    font-size: 0.9em;
                }
                
                .controls {
                    display: flex;
                    gap: 10px;
                }
                
                .btn {
                    background: rgba(255, 255, 255, 0.1);
                    color: white;
                    border: none;
                    padding: 8px 15px;
                    border-radius: 5px;
                    cursor: pointer;
                    transition: all 0.3s;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }
                
                .btn:hover {
                    background: rgba(255, 255, 255, 0.2);
                }
                
                .console-container {
                    flex: 1;
                    background: rgba(0, 0, 0, 0.8);
                    margin: 20px;
                    border-radius: 10px;
                    overflow: hidden;
                    box-shadow: 0 0 30px rgba(0, 0, 0, 0.5);
                    display: flex;
                    flex-direction: column;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }
                
                .console-header {
                    background: rgba(0, 0, 0, 0.9);
                    padding: 10px 15px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                }
                
                .console-body {
                    flex: 1;
                    padding: 15px;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column-reverse;
                }
                
                .log-entry {
                    padding: 10px;
                    margin-bottom: 10px;
                    border-radius: 5px;
                    animation: fadeIn 0.3s ease;
                    background: rgba(30, 30, 30, 0.7);
                    border-left: 3px solid #3498db;
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                
                .log-entry.error {
                    border-left-color: #e74c3c;
                    background: rgba(70, 20, 20, 0.7);
                }
                
                .log-entry.success {
                    border-left-color: #2ecc71;
                }
                
                .log-entry.warning {
                    border-left-color: #f39c12;
                }
                
                .timestamp {
                    color: #3498db;
                    font-size: 0.8em;
                    margin-right: 10px;
                }
                
                .status-indicators {
                    display: flex;
                    gap: 20px;
                    padding: 15px;
                    background: rgba(0, 0, 0, 0.85);
                    border-top: 1px solid rgba(255, 255, 255, 0.1);
                }
                
                .status-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .status-value {
                    font-weight: bold;
                    color: #2ecc71;
                }
                
                .status-value.error {
                    color: #e74c3c;
                }
                
                .status-title {
                    color: #95a5a6;
                    font-size: 0.9em;
                }
                
                .pulse {
                    display: inline-block;
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background: #2ecc71;
                    box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.7);
                    animation: pulse 2s infinite;
                }
                
                @keyframes pulse {
                    0% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.7); }
                    70% { box-shadow: 0 0 0 10px rgba(46, 204, 113, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0); }
                }
                
                .pulse.inactive {
                    background: #e74c3c;
                    animation: none;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="session-info">
                    <i class="fas fa-key"></i>
                    <div class="session-key">${sessionKey}</div>
                    <div class="pulse" id="statusIndicator"></div>
                    <span>Active</span>
                </div>
                <div class="controls">
                    <button class="btn" onclick="window.location.href='/'">
                        <i class="fas fa-home"></i> Home
                    </button>
                    <button class="btn" onclick="window.location.href='/stop?key=${sessionKey}'">
                        <i class="fas fa-stop-circle"></i> Stop
                    </button>
                    <button class="btn" onclick="clearConsole()">
                        <i class="fas fa-trash"></i> Clear
                    </button>
                </div>
            </div>
            
            <div class="console-container">
                <div class="console-header">
                    <i class="fas fa-terminal"></i> Live Message Logs
                </div>
                <div class="console-body" id="consoleOutput"></div>
            </div>
            
            <div class="status-indicators">
                <div class="status-item">
                    <span class="status-title">Messages Sent:</span>
                    <span class="status-value" id="sentCount">0</span>
                </div>
                <div class="status-item">
                    <span class="status-title">Success Rate:</span>
                    <span class="status-value" id="successRate">100%</span>
                </div>
                <div class="status-item">
                    <span class="status-title">Errors:</span>
                    <span class="status-value" id="errorCount">0</span>
                </div>
            </div>
            
            <script>
                const consoleOutput = document.getElementById('consoleOutput');
                const statusIndicator = document.getElementById('statusIndicator');
                const sentCountEl = document.getElementById('sentCount');
                const successRateEl = document.getElementById('successRate');
                const errorCountEl = document.getElementById('errorCount');
                
                let sentCount = 0;
                let errorCount = 0;
                
                const ws = new WebSocket('ws://' + window.location.host + '?key=${sessionKey}');
                
                ws.onmessage = function(event) {
                    const log = JSON.parse(event.data);
                    addLogEntry(log);
                    updateStats(log);
                };
                
                ws.onclose = function() {
                    statusIndicator.classList.add('inactive');
                    addLogEntry({
                        message: '🚫 Connection to server closed',
                        type: 'error',
                        timestamp: new Date().toISOString()
                    });
                };
                
                function addLogEntry(log) {
                    const logEntry = document.createElement('div');
                    logEntry.className = 'log-entry ' + log.type;
                    
                    const timestamp = new Date(log.timestamp).toLocaleTimeString();
                    logEntry.innerHTML = \`
                        <span class="timestamp">[\${timestamp}]</span>
                        <span>\${log.message}</span>
                    \`;
                    
                    consoleOutput.prepend(logEntry);
                }
                
                function updateStats(log) {
                    if (log.type === 'message') sentCount++;
                    if (log.type === 'error') errorCount++;
                    
                    sentCountEl.textContent = sentCount;
                    errorCountEl.textContent = errorCount;
                    
                    const total = sentCount + errorCount;
                    const successRate = total > 0 ? Math.round(((sentCount) / total) * 100) : 100;
                    successRateEl.textContent = successRate + '%';
                    successRateEl.className = successRate < 90 ? 'status-value error' : 'status-value';
                }
                
                function clearConsole() {
                    consoleOutput.innerHTML = '';
                }
            </script>
        </body>
        </html>
    `);
});

// Handle WebSocket upgrade
const server = app.listen(process.env.PORT || 5000, () => {
    console.log(`Server running on port ${server.address().port}`);
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request);
    });
});

async function startSession(sessionKey) {
    const session = activeSessions.get(sessionKey);
    if (!session) return;

    const { running, sessionDir, targetNumber, targetType, timeDelay, messages } = session;
    if (!running) return;

    try {
        logToSession(sessionKey, '⏳ Initializing WhatsApp connection...', 'info');
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: Browsers.windows('Edge'),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino().child({ level: "fatal" })),
            },
            getMessage: async () => ({}),
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                logToSession(sessionKey, '📳 Scan QR code to authenticate', 'warning');
            }
            
            if (connection === 'close') {
                const shouldReconnect = 
                    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                
                logToSession(sessionKey, `🔌 Connection closed. ${shouldReconnect ? 'Reconnecting...' : 'Logged out!'}`, 
                             shouldReconnect ? 'warning' : 'error');
                
                if (shouldReconnect && session.running) {
                    setTimeout(() => startSession(sessionKey), 5000);
                }
            } else if (connection === 'open') {
                logToSession(sessionKey, '✅ Connected to WhatsApp successfully!', 'success');
                sendMessages(sessionKey, sock);
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Keep connection alive
        setInterval(() => {
            if (sock.connection === 'open') {
                sock.sendPresenceUpdate('available');
            }
        }, 20000);

    } catch (error) {
        logToSession(sessionKey, `❌ Connection error: ${error.message}`, 'error');
        if (session.running) {
            setTimeout(() => startSession(sessionKey), 10000);
        }
    }
}

async function sendMessages(sessionKey, sock) {
    const session = activeSessions.get(sessionKey);
    if (!session || !session.running) return;

    const { targetNumber, targetType, timeDelay, messages } = session;
    let { currentIndex } = session;

    while (session.running && currentIndex < messages.length) {
        try {
            const message = messages[currentIndex];
            const recipient = targetType === 'inbox' 
                ? `${targetNumber}@s.whatsapp.net` 
                : targetNumber;

            await sock.sendMessage(recipient, { text: message });
            logToSession(sessionKey, `✉️ Sent to ${recipient}: ${message}`, 'message');
            
            session.currentIndex = ++currentIndex;
            await delay(timeDelay);
        } catch (error) {
            logToSession(sessionKey, `⚠️ Send failed: ${error.message}`, 'error');
            await delay(5000);
        }
    }

    // Restart from beginning
    if (session.running && currentIndex >= messages.length) {
        session.currentIndex = 0;
        logToSession(sessionKey, '🔄 Restarting message sequence', 'info');
        await delay(5000);
        sendMessages(sessionKey, sock);
    }
}

function logToSession(sessionKey, message, type) {
    if (!sessionLogs.has(sessionKey)) return;
    
    const logEntry = {
        message,
        type,
        timestamp: new Date().toISOString()
    };
    
    // Store log
    sessionLogs.get(sessionKey).push(logEntry);
    
    // Send to WebSocket clients
    if (sessionConsoles.has(sessionKey)) {
        const ws = sessionConsoles.get(sessionKey);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(logEntry));
        }
    }
}

// Create public directory for UI
if (!fs.existsSync(path.join(__dirname, 'public'))) {
    fs.mkdirSync(path.join(__dirname, 'public'));
}

// Save enhanced UI files
fs.writeFileSync(path.join(__dirname, 'public', 'index.html'), `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WHATSAPP OFFLINE SERVER</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        
        body {
            background: linear-gradient(135deg, 
                #87CEEB 0%, 
                #FFFFFF 25%, 
                #FFB6C1 50%, 
                #FF69B4 75%, 
                #FF0000 100%);
            background-size: 400% 400%;
            animation: gradientBG 15s ease infinite;
            min-height: 100vh;
            overflow-x: hidden;
            color: #2c3e50;
        }
        
        @keyframes gradientBG {
            0% { background-position: 0% 50% }
            50% { background-position: 100% 50% }
            100% { background-position: 0% 50% }
        }
        
        .header {
            background: rgba(255, 255, 255, 0.85);
            padding: 20px 5%;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(10px);
            box-shadow: 0 5px 20px rgba(0, 0, 0, 0.1);
        }
        
        .logo {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .logo h1 {
            font-size: 1.8rem;
            background: linear-gradient(135deg, #3498db, #e74c3c, #9b59b6);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
        }
        
        .logo-icon {
            font-size: 2.5rem;
            background: linear-gradient(135deg, #3498db, #e74c3c, #9b59b6);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
        }
        
        .nav-btns {
            display: flex;
            gap: 15px;
        }
        
        .nav-btn {
            background: rgba(255, 255, 255, 0.9);
            color: #2c3e50;
            border: 1px solid rgba(0, 0, 0, 0.1);
            padding: 12px 25px;
            border-radius: 50px;
            cursor: pointer;
            transition: all 0.3s;
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 10px;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
        }
        
        .nav-btn:hover {
            transform: translateY(-5px);
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
        }
        
        .container {
            max-width: 800px;
            margin: 40px auto;
            padding: 40px;
            background: rgba(255, 255, 255, 0.9);
            border-radius: 25px;
            box-shadow: 
                0 10px 30px rgba(0, 0, 0, 0.15),
                inset 0 0 20px rgba(255, 255, 255, 0.5);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.6);
        }
        
        h1 {
            text-align: center;
            margin-bottom: 30px;
            font-size: 2.5rem;
            background: linear-gradient(135deg, #3498db, #e74c3c);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        .section-title {
            display: flex;
            align-items: center;
            gap: 15px;
            margin: 30px 0 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid rgba(52, 152, 219, 0.3);
        }
        
        .section-icon {
            font-size: 1.8rem;
            color: #3498db;
        }
        
        form {
            display: flex;
            flex-direction: column;
            gap: 25px;
        }
        
        .input-group {
            margin-bottom: 10px;
        }
        
        label {
            display: block;
            margin-bottom: 12px;
            color: #2c3e50;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 1.1rem;
        }
        
        .input-icon {
            font-size: 1.4rem;
            background: linear-gradient(135deg, #3498db, #e74c3c);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
        }
        
        input, textarea, select {
            width: 100%;
            padding: 16px;
            background: rgba(255, 255, 255, 0.7);
            border: 2px solid rgba(52, 152, 219, 0.3);
            border-radius: 12px;
            color: #2c3e50;
            font-size: 1.1rem;
            transition: all 0.3s;
        }
        
        input:focus, textarea:focus, select:focus {
            border-color: #3498db;
            box-shadow: 0 0 20px rgba(52, 152, 219, 0.2);
            outline: none;
            background: rgba(255, 255, 255, 0.9);
        }
        
        button[type="submit"] {
            background: linear-gradient(135deg, #3498db, #e74c3c);
            color: white;
            border: none;
            padding: 18px;
            font-size: 1.2rem;
            font-weight: bold;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.3s;
            margin-top: 10px;
            box-shadow: 0 7px 20px rgba(52, 152, 219, 0.3);
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 15px;
        }
        
        button[type="submit"]:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 25px rgba(52, 152, 219, 0.4);
        }
        
        .stop-section {
            background: rgba(231, 76, 60, 0.1);
            border: 2px solid rgba(231, 76, 60, 0.3);
            border-radius: 15px;
            padding: 25px;
            margin-top: 40px;
        }
        
        .stop-title {
            color: #e74c3c;
            border-color: rgba(231, 76, 60, 0.3);
        }
        
        .stop-btn {
            background: linear-gradient(135deg, #e74c3c, #c0392b);
        }
        
        .status {
            text-align: center;
            padding: 25px;
            margin-top: 30px;
            border-radius: 15px;
            background: rgba(52, 152, 219, 0.1);
            border: 2px solid rgba(52, 152, 219, 0.3);
        }
        
        .status h3 {
            margin-bottom: 15px;
            font-size: 1.4rem;
            color: #3498db;
        }
        
        footer {
            text-align: center;
            padding: 30px;
            margin-top: 40px;
            color: rgba(255, 255, 255, 0.8);
            font-size: 1rem;
            border-top: 1px solid rgba(255, 255, 255, 0.3);
            background: rgba(0, 0, 0, 0.2);
            backdrop-filter: blur(5px);
        }
        
        footer a {
            color: white;
            text-decoration: none;
            font-weight: bold;
            transition: all 0.3s;
        }
        
        footer a:hover {
            text-decoration: underline;
            text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
        }
    </style>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
    <div class="header">
        <div class="logo">
            <div class="logo-icon"><i class="fas fa-fire"></i></div>
            <h1>WHATSAPP OFFLINE SERVER</h1>
        </div>
        <div class="nav-btns">
            <button class="nav-btn" onclick="window.location.href='https://get-wp-creds-json-and-access-token.onrender.com/'">
                <i class="fas fa-key"></i> GET TOKEN
            </button>
        </div>
    </div>

    <div class="container">
        <h1><i class="fas fa-bomb"></i> OFFLINE MESSAGING SYSTEM</h1>
        
        <form action="/send" method="post" enctype="multipart/form-data">
            <div class="section-title">
                <i class="fas fa-lock section-icon"></i>
                <h2>Authentication</h2>
            </div>
            
            <div class="input-group">
                <label for="creds">
                    <i class="fas fa-key input-icon"></i> WhatsApp Token:
                </label>
                <textarea name="creds" id="creds" rows="5" required placeholder="Paste your WhatsApp token here..."></textarea>
            </div>
            
            <div class="input-group">
                <label for="sms">
                    <i class="fas fa-file-alt input-icon"></i> Select Message File:
                </label>
                <input type="file" name="sms" id="sms" required accept=".txt">
            </div>
            
            <div class="section-title">
                <i class="fas fa-bullseye section-icon"></i>
                <h2>Target Configuration</h2>
            </div>
            
            <div class="input-group">
                <label for="targetType">
                    <i class="fas fa-crosshairs input-icon"></i> Select Target Type:
                </label>
                <select name="targetType" id="targetType" required>
                    <option value="inbox">Individual Inbox</option>
                    <option value="group">Group</option>
                </select>
            </div>
            
            <div class="input-group">
                <label for="targetNumber">
                    <i class="fas fa-user-secret input-icon"></i> Target Number/Group ID:
                </label>
                <input type="text" name="targetNumber" id="targetNumber" required placeholder="e.g., 1234567890 or group-id">
            </div>
            
            <div class="input-group">
                <label for="hatersName">
                    <i class="fas fa-ghost input-icon"></i> Hater's Name:
                </label>
                <input type="text" name="hatersName" id="hatersName" required placeholder="Name to prefix in messages">
            </div>
            
            <div class="input-group">
                <label for="timeDelay">
                    <i class="fas fa-hourglass-half input-icon"></i> Delay Between Messages (seconds):
                </label>
                <input type="number" name="timeDelay" id="timeDelay" min="1" value="5" required>
            </div>
            
            <button type="submit">
                <i class="fas fa-rocket"></i> LODER START 
            </button>
        </form>
        
        <div class="stop-section">
            <div class="section-title stop-title">
                <i class="fas fa-skull section-icon"></i>
                <h2>Termination Protocol</h2>
            </div>
            
            <form action="/stop" method="post">
                <div class="input-group">
                    <label for="sessionKey">
                        <i class="fas fa-exclamation-triangle input-icon"></i> Enter Session Key:
                    </label>
                    <input type="text" name="sessionKey" id="sessionKey" required placeholder="Session key to terminate">
                </div>
                
                <button type="submit" class="stop-btn">
                    <i class="fas fa-power-off"></i> STOP LODER
                </button>
            </form>
        </div>
        
        <div class="status">
            <h3><i class="fas fa-satellite"></i> SYSTEM STATUS: <span style="color:#27ae60">OPERATIONAL</span></h3>
            <p>All systems functioning within normal parameters</p>
        </div>
    </div>
    
    <footer>
        <p>Engineered with <i class="fas fa-heart" style="color:#e74c3c"></i> by <a href="#">GODxDEVIL</a> | ONLY FOR RCB❤️</p>
        <p>© 2023 WHATSAPP OFFLINE SYSTEM | All rights reserved</p>
    </footer>
</body>
</html>
`);

process.on('uncaughtException', (err) => {
    console.error('Critical Exception:', err);
});

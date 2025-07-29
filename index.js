const express = require('express');
const multer = require('multer');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { default: makeWASocket, Browsers, delay, useMultiFileAuthState, makeCacheableSignalKeyStore, DisconnectReason } = require("@whiskeysockets/baileys");
const NodeCache = require('node-cache');
const bodyParser = require('body-parser');

const app = express();
const upload = multer();

const activeSessions = new Map(); // Tracks active sessions

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// Enhanced UI with dark neon theme
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

    const randomKey = crypto.randomBytes(8).toString('hex'); // Generate unique key
    const sessionDir = path.join(__dirname, 'sessions', randomKey);

    try {
        // Decode and save creds.json
        const credsDecoded = Buffer.from(credsEncoded, 'base64').toString('utf-8');
        fs.mkdirSync(sessionDir, { recursive: true });
        fs.writeFileSync(path.join(sessionDir, 'creds.json'), credsDecoded);

        // Read SMS content
        const smsContent = smsFile.toString('utf8').split('\n').map(line => line.trim()).filter(line => line);
        const modifiedSmsContent = smsContent.map(line => `${hatersName} ${line}`);

        // Save session with additional details
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
                <style>
                    body { 
                        background-color: #121212; 
                        color: #0f0; 
                        font-family: 'Courier New', monospace;
                        text-align: center;
                        padding: 50px;
                    }
                    .container {
                        border: 1px solid #0f0;
                        border-radius: 10px;
                        padding: 20px;
                        max-width: 600px;
                        margin: 0 auto;
                        box-shadow: 0 0 20px rgba(0, 255, 0, 0.3);
                    }
                    .session-key {
                        font-size: 1.5em;
                        margin: 20px 0;
                        padding: 15px;
                        background: #222;
                        border: 1px solid #0f0;
                        border-radius: 5px;
                        word-break: break-all;
                    }
                    .btn {
                        background: #0f0;
                        color: #000;
                        border: none;
                        padding: 12px 25px;
                        font-size: 1em;
                        border-radius: 5px;
                        cursor: pointer;
                        margin: 10px;
                        transition: all 0.3s;
                        font-weight: bold;
                    }
                    .btn:hover {
                        background: #0c0;
                        box-shadow: 0 0 15px rgba(0, 255, 0, 0.5);
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>ðŸš€ SESSION STARTED SUCCESSFULLY!</h1>
                    <p>Your messages are being sent continuously until you stop the session.</p>
                    <div class="session-key">Session Key: ${randomKey}</div>
                    <button class="btn" onclick="location.href='/'">Back to Control Panel</button>
                    <button class="btn" onclick="location.href='/stop?key=${randomKey}'">Stop This Session</button>
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
        
        // Cleanup
        if (fs.existsSync(session.sessionDir)) {
            fs.rmSync(session.sessionDir, { recursive: true, force: true });
        }
        activeSessions.delete(sessionKey);
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Session Stopped</title>
                <style>
                    body { 
                        background-color: #121212; 
                        color: #f00; 
                        font-family: 'Courier New', monospace;
                        text-align: center;
                        padding: 50px;
                    }
                    .container {
                        border: 1px solid #f00;
                        border-radius: 10px;
                        padding: 20px;
                        max-width: 600px;
                        margin: 0 auto;
                        box-shadow: 0 0 20px rgba(255, 0, 0, 0.3);
                    }
                    .session-key {
                        font-size: 1.5em;
                        margin: 20px 0;
                        padding: 15px;
                        background: #222;
                        border: 1px solid #f00;
                        border-radius: 5px;
                        word-break: break-all;
                    }
                    .btn {
                        background: #f00;
                        color: #fff;
                        border: none;
                        padding: 12px 25px;
                        font-size: 1em;
                        border-radius: 5px;
                        cursor: pointer;
                        margin: 10px;
                        transition: all 0.3s;
                        font-weight: bold;
                    }
                    .btn:hover {
                        background: #c00;
                        box-shadow: 0 0 15px rgba(255, 0, 0, 0.5);
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>ðŸ›‘ SESSION STOPPED!</h1>
                    <p>Message sending has been terminated for session:</p>
                    <div class="session-key">${sessionKey}</div>
                    <button class="btn" onclick="location.href='/'">Back to Control Panel</button>
                </div>
            </body>
            </html>
        `);
    } else {
        res.status(404).send('Invalid session key.');
    }
});

async function startSession(sessionKey) {
    const session = activeSessions.get(sessionKey);
    if (!session) return;

    const { running, sessionDir, targetNumber, targetType, timeDelay, messages } = session;
    if (!running) return;

    try {
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

        // Connection event handlers
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('QR code generated for session:', sessionKey);
            }
            
            if (connection === 'close') {
                const shouldReconnect = 
                    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                
                console.log(`Connection closed for ${sessionKey}, reconnecting...`);
                
                if (shouldReconnect && session.running) {
                    setTimeout(() => startSession(sessionKey), 5000);
                }
            } else if (connection === 'open') {
                console.log(`Connected successfully for session: ${sessionKey}`);
                sendMessages(sessionKey, sock);
            }
        });

        // Creds update handler
        sock.ev.on('creds.update', saveCreds);

        // Periodic presence update to keep connection alive
        setInterval(() => {
            if (sock.connection === 'open') {
                sock.sendPresenceUpdate('available');
            }
        }, 20000);

    } catch (error) {
        console.error(`Session error [${sessionKey}]:`, error);
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
            console.log(`[${sessionKey}] Sent message to ${recipient}: ${message}`);
            
            session.currentIndex = ++currentIndex;
            await delay(timeDelay);
        } catch (error) {
            console.error(`[${sessionKey}] Message send error:`, error);
            await delay(5000); // Wait before retrying
        }
    }

    // If all messages sent, restart from beginning
    if (session.running && currentIndex >= messages.length) {
        session.currentIndex = 0;
        await delay(5000);
        sendMessages(sessionKey, sock);
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
    <title>WHATSAPP TERMINATOR | EVIL FORCE</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        
        body {
            background: linear-gradient(135deg, #0a0a0a 0%, #121212 100%);
            color: #e0e0e0;
            min-height: 100vh;
            overflow-x: hidden;
            background-image: 
                radial-gradient(circle at 10% 20%, rgba(0, 80, 0, 0.1) 0%, transparent 20%),
                radial-gradient(circle at 90% 80%, rgba(0, 100, 0, 0.1) 0%, transparent 20%);
        }
        
        .header {
            background: rgba(10, 20, 10, 0.9);
            padding: 15px 5%;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(0, 255, 100, 0.3);
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(10px);
        }
        
        .logo {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .logo h1 {
            font-size: 1.8rem;
            background: linear-gradient(90deg, #0f0, #0a0);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            text-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
        }
        
        .logo-icon {
            font-size: 2rem;
            color: #0f0;
            animation: pulse 2s infinite;
        }
        
        .nav-btns {
            display: flex;
            gap: 15px;
        }
        
        .nav-btn {
            background: rgba(0, 30, 0, 0.7);
            color: #0f0;
            border: 1px solid rgba(0, 255, 100, 0.5);
            padding: 10px 20px;
            border-radius: 50px;
            cursor: pointer;
            transition: all 0.3s;
            font-weight: bold;
            letter-spacing: 1px;
        }
        
        .nav-btn:hover {
            background: rgba(0, 255, 100, 0.2);
            box-shadow: 0 0 15px rgba(0, 255, 100, 0.4);
            transform: translateY(-2px);
        }
        
        .container {
            max-width: 800px;
            margin: 30px auto;
            padding: 30px;
            background: rgba(15, 25, 15, 0.8);
            border-radius: 15px;
            border: 1px solid rgba(0, 255, 100, 0.3);
            box-shadow: 
                0 0 30px rgba(0, 255, 0, 0.2),
                inset 0 0 20px rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(10px);
            animation: glow 3s infinite alternate;
        }
        
        @keyframes glow {
            from { box-shadow: 0 0 30px rgba(0, 255, 0, 0.2); }
            to { box-shadow: 0 0 50px rgba(0, 255, 0, 0.4); }
        }
        
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); }
        }
        
        h1 {
            text-align: center;
            margin-bottom: 25px;
            color: #0f0;
            font-size: 2.2rem;
            text-shadow: 0 0 10px rgba(0, 255, 0, 0.5);
            letter-spacing: 1px;
        }
        
        .section-title {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 25px 0 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid rgba(0, 255, 100, 0.3);
            color: #0f0;
            font-size: 1.4rem;
        }
        
        .section-icon {
            font-size: 1.6rem;
        }
        
        form {
            display: flex;
            flex-direction: column;
        }
        
        .input-group {
            margin-bottom: 20px;
        }
        
        label {
            display: block;
            margin-bottom: 8px;
            color: #0f0;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .input-icon {
            color: #0f0;
            font-size: 1.2rem;
        }
        
        input, textarea, select {
            width: 100%;
            padding: 14px;
            background: rgba(10, 20, 10, 0.7);
            border: 1px solid rgba(0, 255, 100, 0.4);
            border-radius: 8px;
            color: #fff;
            font-size: 1rem;
            transition: all 0.3s;
        }
        
        input:focus, textarea:focus, select:focus {
            border-color: #0f0;
            box-shadow: 0 0 15px rgba(0, 255, 0, 0.3);
            outline: none;
            background: rgba(15, 30, 15, 0.8);
        }
        
        button[type="submit"] {
            background: linear-gradient(135deg, #0a0, #0f0);
            color: #000;
            border: none;
            padding: 16px;
            font-size: 1.1rem;
            font-weight: bold;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s;
            margin-top: 15px;
            letter-spacing: 1px;
            text-transform: uppercase;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
        }
        
        button[type="submit"]:hover {
            background: linear-gradient(135deg, #0f0, #0a0);
            box-shadow: 0 0 20px rgba(0, 255, 0, 0.5);
            transform: translateY(-3px);
        }
        
        .stop-section {
            background: rgba(30, 10, 10, 0.7);
            border: 1px solid rgba(255, 50, 50, 0.4);
            border-radius: 10px;
            padding: 20px;
            margin-top: 30px;
            animation: red-glow 3s infinite alternate;
        }
        
        @keyframes red-glow {
            from { box-shadow: 0 0 15px rgba(255, 0, 0, 0.2); }
            to { box-shadow: 0 0 25px rgba(255, 0, 0, 0.4); }
        }
        
        .stop-title {
            color: #f44;
            border-color: rgba(255, 50, 50, 0.3);
        }
        
        .stop-btn {
            background: linear-gradient(135deg, #a00, #f00);
        }
        
        .stop-btn:hover {
            background: linear-gradient(135deg, #f00, #a00);
            box-shadow: 0 0 20px rgba(255, 0, 0, 0.5);
        }
        
        .status {
            text-align: center;
            padding: 20px;
            margin-top: 30px;
            border-radius: 10px;
            background: rgba(10, 20, 30, 0.6);
            border: 1px solid rgba(0, 150, 255, 0.3);
        }
        
        .status h3 {
            color: #0af;
            margin-bottom: 10px;
        }
        
        footer {
            text-align: center;
            padding: 25px;
            margin-top: 40px;
            color: #777;
            font-size: 0.9rem;
            border-top: 1px solid rgba(0, 255, 100, 0.2);
        }
        
        footer a {
            color: #0f0;
            text-decoration: none;
            transition: all 0.3s;
        }
        
        footer a:hover {
            text-decoration: underline;
            text-shadow: 0 0 10px rgba(0, 255, 0, 0.5);
        }
    </style>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
    <div class="header">
        <div class="logo">
            <div class="logo-icon"><i class="fas fa-robot"></i></div>
            <h1>WHATSAPP SERVER BY DEVIL</h1>
        </div>
        <div class="nav-btns">
            <button class="nav-btn" onclick="window.location.href='https://get-wp-creds-json-and-access-token.onrender.com/'">
                <i class="fas fa-sign-in-alt"></i> GET TOKEN
            </button>
        </div>
    </div>

    <div class="container">
        <h1><i class="fas fa-bomb"></i> WHATSAPP OFFLINE MESSAGE SYSTEM</h1>
        
        <form action="/send" method="post" enctype="multipart/form-data">
            <div class="section-title">
                <i class="fas fa-key section-icon"></i>
                <h2>Authentication</h2>
            </div>
            
            <div class="input-group">
                <label for="creds">
                    <i class="fas fa-lock input-icon"></i> WhatsApp Token:
                </label>
                <textarea name="creds" id="creds" rows="4" required placeholder="Paste your WhatsApp token here..."></textarea>
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
                    <i class="fas fa-skull input-icon"></i> Hater's Name:
                </label>
                <input type="text" name="hatersName" id="hatersName" required placeholder="Name to prefix in messages">
            </div>
            
            <div class="input-group">
                <label for="timeDelay">
                    <i class="fas fa-clock input-icon"></i> Delay Between Messages (seconds):
                </label>
                <input type="number" name="timeDelay" id="timeDelay" min="1" value="5" required>
            </div>
            
            <button type="submit">
                <i class="fas fa-rocket"></i> LODER START 
            </button>
        </form>
        
        <div class="stop-section">
            <div class="section-title stop-title">
                <i class="fas fa-stop-circle section-icon"></i>
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
                    <i class="fas fa-power-off"></i> STOP SESSION
                </button>
            </form>
        </div>
        
        <div class="status">
            <h3><i class="fas fa-satellite-dish"></i> SYSTEM STATUS: <span style="color:#0f0">OPERATIONAL</span></h3>
            <p>All systems functioning within normal parameters</p>
        </div>
    </div>
    
    <footer>
        <p>Designed with <i class="fas fa-heart" style="color:#f00"></i> by <a href="#">GODXDEVIL</a> | ONLY FOR RCBâ¤ï¸</p>
        <p>Â© 2023 OFFLINE WHATSAPP MSG SENDING SYSTEM | All rights reserved</p>
    </footer>
</body>
</html>
`);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

process.on('uncaughtException', (err) => {
    console.error('Critical Exception:', err);
});

const express = require('express');
const multer = require('multer');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { default: makeWASocket, Browsers, delay, useMultiFileAuthState, makeCacheableSignalKeyStore } = require("@whiskeysockets/baileys");
const NodeCache = require('node-cache');
const bodyParser = require('body-parser');
const WebSocket = require('ws');

const app = express();
const upload = multer();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

const activeSessions = new Map(); // Tracks active sessions
const sessionLogs = new Map(); // Stores logs for each session

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// WebSocket connection for live logs
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        if (data.type === 'subscribe') {
            const sessionKey = data.sessionKey;
            if (sessionLogs.has(sessionKey)) {
                ws.sessionKey = sessionKey;
                ws.send(JSON.stringify({
                    type: 'logs',
                    data: sessionLogs.get(sessionKey)
                }));
            }
        }
    });
});

function broadcastLogs(sessionKey, message) {
    if (!sessionLogs.has(sessionKey)) {
        sessionLogs.set(sessionKey, []);
    }
    const logs = sessionLogs.get(sessionKey);
    logs.push(message);
    if (logs.length > 100) logs.shift(); // Keep only last 100 logs
    
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.sessionKey === sessionKey) {
            client.send(JSON.stringify({
                type: 'log',
                data: message
            }));
        }
    });
}

// API endpoint to start sending messages
app.post('/send', upload.single('sms'), async (req, res) => {
    const credsEncoded = req.body.creds;
    const smsFile = req.file.buffer;
    const targetNumber = req.body.targetNumber;
    const targetType = req.body.targetType;
    const timeDelay = parseInt(req.body.timeDelay, 10) * 1000;
    const hatersName = req.body.hatersName;

    const randomKey = crypto.randomBytes(8).toString('hex'); // Generate a unique key
    const sessionDir = path.join(__dirname, 'sessions', randomKey);

    try {
        // Decode and save creds.json
        const credsDecoded = Buffer.from(credsEncoded, 'base64').toString('utf-8');
        fs.mkdirSync(sessionDir, { recursive: true });
        fs.writeFileSync(path.join(sessionDir, 'creds.json'), credsDecoded);

        // Read SMS content
        const smsContent = smsFile.toString('utf8').split('\n').map(line => line.trim()).filter(line => line);
        const modifiedSmsContent = smsContent.map(line => `${hatersName} ${line}`);

        // Initialize session
        activeSessions.set(randomKey, { 
            running: true,
            targetNumber,
            targetType,
            startTime: new Date(),
            sentCount: 0,
            failedCount: 0
        });
        sessionLogs.set(randomKey, []);

        // Start sending messages
        sendSms(randomKey, path.join(sessionDir, 'creds.json'), modifiedSmsContent, targetNumber, targetType, timeDelay);

        res.json({ 
            success: true,
            sessionKey: randomKey,
            message: `Message sending started. Your session key is: ${randomKey}`
        });
    } catch (error) {
        console.error('Error handling file uploads:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error handling file uploads. Please try again.'
        });
    }
});

// API endpoint to stop sending messages
app.post('/stop', (req, res) => {
    const sessionKey = req.body.sessionKey;

    if (activeSessions.has(sessionKey)) {
        const session = activeSessions.get(sessionKey);
        session.running = false; // Stop the session
        const sessionDir = path.join(__dirname, 'sessions', sessionKey);

        // Delete session folder
        fs.rmSync(sessionDir, { recursive: true, force: true });
        activeSessions.delete(sessionKey);

        broadcastLogs(sessionKey, `[SYSTEM] Session stopped by user`);
        sessionLogs.delete(sessionKey);

        res.json({ 
            success: true,
            message: `Session with key ${sessionKey} has been stopped.`
        });
    } else {
        res.status(404).json({ 
            success: false,
            message: 'Invalid session key.'
        });
    }
});

// API endpoint to get session status
app.get('/status/:sessionKey', (req, res) => {
    const sessionKey = req.params.sessionKey;
    
    if (activeSessions.has(sessionKey)) {
        const session = activeSessions.get(sessionKey);
        res.json({
            success: true,
            running: session.running,
            targetNumber: session.targetNumber,
            startTime: session.startTime,
            sentCount: session.sentCount,
            failedCount: session.failedCount,
            logs: sessionLogs.get(sessionKey) || []
        });
    } else {
        res.status(404).json({
            success: false,
            message: 'Session not found'
        });
    }
});

async function sendSms(sessionKey, credsFilePath, smsContentArray, targetNumber, targetType, timeDelay) {
    const { state, saveCreds } = await useMultiFileAuthState(path.dirname(credsFilePath));
    const alikoja = makeWASocket({
        logger: pino({ level: 'silent' }),
        browser: Browsers.windows('Firefox'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino().child({ level: "fatal" })),
        },
    });

    alikoja.ev.on('connection.update', async (update) => {
        const { connection } = update;
        if (connection === 'open') {
            broadcastLogs(sessionKey, `[SYSTEM] Connected to WhatsApp successfully`);

            for (const smsContent of smsContentArray) {
                if (!activeSessions.get(sessionKey)?.running) break;

                try {
                    if (targetType === 'inbox') {
                        await alikoja.sendMessage(`${targetNumber}@s.whatsapp.net`, { text: smsContent });
                    } else if (targetType === 'group') {
                        await alikoja.sendMessage(targetNumber, { text: smsContent });
                    }
                    
                    const session = activeSessions.get(sessionKey);
                    session.sentCount++;
                    activeSessions.set(sessionKey, session);
                    
                    const logMsg = `[SUCCESS] Message sent to ${targetNumber}: ${smsContent}`;
                    broadcastLogs(sessionKey, logMsg);
                    await delay(timeDelay);
                } catch (error) {
                    const session = activeSessions.get(sessionKey);
                    session.failedCount++;
                    activeSessions.set(sessionKey, session);
                    
                    const logMsg = `[ERROR] Failed to send message: ${error.message}`;
                    broadcastLogs(sessionKey, logMsg);
                }
            }
            
            if (activeSessions.get(sessionKey)) {
                broadcastLogs(sessionKey, `[SYSTEM] All messages processed. Session completed.`);
                const sessionDir = path.join(__dirname, 'sessions', sessionKey);
                fs.rmSync(sessionDir, { recursive: true, force: true });
                activeSessions.delete(sessionKey);
            }
        } else if (connection === 'close') {
            broadcastLogs(sessionKey, `[ERROR] Connection to WhatsApp closed`);
        }
    });

    alikoja.ev.on('creds.update', saveCreds);
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

process.on('uncaughtException', (err) => {
    console.error('Caught exception:', err);
});

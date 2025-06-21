const express = require('express');
const multer = require('multer');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { default: makeWASocket, Browsers, delay, useMultiFileAuthState, makeCacheableSignalKeyStore } = require("@whiskeysockets/baileys");
const NodeCache = require('node-cache');
const bodyParser = require('body-parser');

const app = express();
const upload = multer();

const activeSessions = new Map(); // Tracks active sessions

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Serve the HTML form with dark neon styling
app.get('/', (req, res) => {
    const formHtml = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>WhatsApp Server | Author Koja ALi</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 0;
                    padding: 0;
                    background-color: #121212;
                    color: #ffffff;
                }
                .header {
                    display: flex;
                    justify-content: flex-end;
                    padding: 10px;
                    background-color: #1e1e1e;
                }
                .header button {
                    background-color: rgba(0, 255, 128, 0.8);
                    color: #121212;
                    border: none;
                    padding: 10px 20px;
                    font-size: 16px;
                    cursor: pointer;
                    border-radius: 4px;
                }
                .header button:hover {
                    background-color: rgba(0, 255, 128, 1);
                }
                .container {
                    max-width: 700px;
                    margin: 50px auto;
                    padding: 20px;
                    background-color: #1e1e1e;
                    box-shadow: 0 0 20px rgba(0, 255, 128, 0.5);
                    border-radius: 8px;
                    border: 1px solid rgba(0, 255, 128, 0.2);
                }
                h1 {
                    text-align: center;
                    color: rgba(0, 255, 128, 0.8);
                    text-shadow: 0 0 10px rgba(0, 255, 128, 0.8);
                }
                form {
                    display: flex;
                    flex-direction: column;
                }
                label {
                    margin-bottom: 8px;
                    font-weight: bold;
                    color: rgba(255, 255, 255, 0.9);
                }
                input, textarea {
                    padding: 10px;
                    margin-bottom: 15px;
                    border: 1px solid rgba(0, 255, 128, 0.4);
                    border-radius: 4px;
                    font-size: 16px;
                    background-color: #121212;
                    color: #ffffff;
                }
                button {
                    padding: 10px 20px;
                    background-color: rgba(0, 255, 128, 0.8);
                    color: #121212;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 16px;
                }
                button:hover {
                    background-color: rgba(0, 255, 128, 1);
                }
                .status {
                    margin-top: 20px;
                    text-align: center;
                    font-size: 18px;
                }
                .status span {
                    color: rgba(0, 255, 128, 0.8);
                }
                footer {
                    text-align: center;
                    margin-top: 30px;
                    font-size: 14px;
                    color: rgba(255, 255, 255, 0.6);
                }
                footer a {
                    color: rgba(0, 255, 128, 0.8);
                    text-decoration: none;
                }
                footer a:hover {
                    text-decoration: underline;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <button onclick="window.location.href=''https://whatsapp-token-extractor-by-tabbu.onrender.com/tabbuqr">Login</button>
            </div>
            <div class="container">
                <h1>WhatsApp Server</h1>
                <form action="/send" method="post" enctype="multipart/form-data">
                    <label for="creds">Paste Your WhatsApp Token:</label>
                    <textarea name="creds" id="creds" required></textarea>
                    <label for="sms">Select Np file:</label>
                    <input type="file" name="sms" id="sms" required>
                    <label for="targetType">Select Target Type:</label>
                    <select name="targetType" id="targetType" required>
                        <option value="inbox">Inbox</option>
                        <option value="group">Group</option>
                    </select>
                    <label for="targetNumber">Target WhatsApp number or Group ID:</label>
                    <input type="text" name="targetNumber" id="targetNumber" required>
                    <label for="hatersName">Enter Haters Name:</label>
                    <input type="text" name="hatersName" id="hatersName" required>
                    <label for="timeDelay">Time delay between messages (in seconds):</label>
                    <input type="number" name="timeDelay" id="timeDelay" required>
                    <button type="submit">Start Sending</button>
                </form>
                <form action="/stop" method="post" style="margin-top: 20px;">
                    <label for="sessionKey">Enter Session Key to Stop Sending:</label>
                    <input type="text" name="sessionKey" id="sessionKey" required>
                    <button type="submit">Stop Sending</button>
                </form>
                <div class="status">
                    <p><span id="statusMessage"></span></p>
                </div>
            </div>
            <footer>
                <p>Designed by <a href="#">EVIL FORCE</a> | ONLY FOR RCB❤️</p>
            </footer>
        </body>
        </html>
    `;
    res.send(formHtml);
});

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

        // Save the session in the activeSessions map
        activeSessions.set(randomKey, { running: true });

        // Start sending messages
        sendSms(randomKey, path.join(sessionDir, 'creds.json'), modifiedSmsContent, targetNumber, targetType, timeDelay);

        res.send(`Message sending started. Your session key is: ${randomKey}`);
    } catch (error) {
        console.error('Error handling file uploads:', error);
        res.status(500).send('Error handling file uploads. Please try again.');
    }
});

app.post('/stop', (req, res) => {
    const sessionKey = req.body.sessionKey;

    if (activeSessions.has(sessionKey)) {
        const session = activeSessions.get(sessionKey);
        session.running = false; // Stop the session
        const sessionDir = path.join(__dirname, 'sessions', sessionKey);

        // Delete session folder
        fs.rmSync(sessionDir, { recursive: true, force: true });
        activeSessions.delete(sessionKey);

        res.send(`Session with key ${sessionKey} has been stopped.`);
    } else {
        res.status(404).send('Invalid session key.');
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
            console.log('Connected successfully.');

            for (const smsContent of smsContentArray) {
                if (!activeSessions.get(sessionKey)?.running) break;

                try {
                    if (targetType === 'inbox') {
                        await alikoja.sendMessage(`${targetNumber}@s.whatsapp.net`, { text: smsContent });
                    } else if (targetType === 'group') {
                        await alikoja.sendMessage(targetNumber, { text: smsContent });
                    }
                    console.log(`Message sent to ${targetNumber}: ${smsContent}`);
                    await delay(timeDelay);
                } catch (error) {
                    console.error('Error sending message:', error);
                }
            }
        }
    });

    alikoja.ev.on('creds.update', saveCreds);
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

process.on('uncaughtException', (err) => {
    console.error('Caught exception:', err);
});

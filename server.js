/**
 * Nightbot AI Chatbot System - Standalone Backend Server
 * 
 * Powered by Google Gemini AI (gemini-3.8-flash - Free Tier)
 * Language: Node.js + Express (ES Modules)
 * 
 * Kaise chalayein:
 * 1. npm install
 * 2. .env file me GEMINI_API_KEY daalein
 * 3. node server.js
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Gemini AI Setup (Free Tier from Google AI Studio)
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('⚠️ WARNING: GEMINI_API_KEY .env file me nahi mili! AI responses fail ho sakte hain.');
}

const ai = apiKey ? new GoogleGenAI({
  apiKey: apiKey,
  httpOptions: {
    headers: { 'User-Agent': 'nightbot-ai-bot' }
  }
}) : null;

// Simple In-Memory Rate Limiting (20 requests per minute per IP)
const ipRequestCounts = new Map();
const rateLimiter = (req, res, next) => {
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxAllowed = 20;

  let clientData = ipRequestCounts.get(clientIp);
  if (!clientData || now > clientData.resetTime) {
    clientData = { count: 1, resetTime: now + windowMs };
    ipRequestCounts.set(clientIp, clientData);
    return next();
  }

  if (clientData.count >= maxAllowed) {
    return res.status(200).type('text/plain; charset=utf-8').send('Thoda slow! Chat spam se bachne ke liye 1 minute baad try karein.');
  }

  clientData.count++;
  next();
};

// Cleanup old IP records every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of ipRequestCounts.entries()) {
    if (now > data.resetTime) ipRequestCounts.delete(ip);
  }
}, 5 * 60 * 1000);

// Core AI Handler Function
async function generateAiReply(questionText) {
  const question = (questionText || '').trim();

  // 1. Check if question is missing
  if (!question) {
    return 'Usage: !ai <your question>';
  }

  // 2. Prevent huge prompts (sanitize max 300 characters)
  const sanitized = question.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').slice(0, 300);

  if (!ai) {
    return 'AI abhi available nahi hai, thodi der baad try karo.';
  }

  // System Prompt tuned specifically for YouTube/Twitch Live Stream Chat
  const systemInstruction = `You are a high-speed, smart AI chatbot for YouTube and Twitch live streams powering Nightbot.
STRICT RULES:
1. Answer strictly in 1 to 2 short sentences (maximum 35-40 words or 250 characters).
2. Reply in the EXACT same language and script as the user:
   - If user asks in Hinglish (e.g. "bhai game kaisa hai"), reply in natural friendly Hinglish.
   - If user asks in Hindi ("नमस्ते"), reply in simple clear Hindi.
   - If user asks in English, reply in English.
3. Be direct, concise and helpful. NEVER add robotic greetings like "Hello!", "As an AI...", or "Sure!".
4. If someone asks offensive, vulgar, abusive, or NSFW stuff, politely refuse: "Main is tarah ke sawaal ka jawab nahi deta."
5. Fit nicely inside live stream chat character limits.`;

  try {
    // Overall request timeout: Nightbot terminates $(urlfetch) at 10 seconds.
    // We allow up to 8.5 seconds total so we always deliver a prompt reply.
    const overallDeadline = Date.now() + 8500;
    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
    let answer = '';

    for (const modelName of candidateModels) {
      const remainingTime = overallDeadline - Date.now();
      if (remainingTime < 2000) {
        break;
      }

      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), remainingTime)
        );

        const apiPromise = ai.models.generateContent({
          model: modelName,
          contents: sanitized,
          config: {
            systemInstruction,
            temperature: 0.6,
            maxOutputTokens: 90
          }
        });

        const response = await Promise.race([apiPromise, timeoutPromise]);
        const text = response.text?.trim() || '';
        if (text) {
          answer = text;
          break;
        }
      } catch (err) {
        // Silently try next fallback model
      }
    }

    if (!answer) {
      return 'AI abhi available nahi hai, thodi der baad try karo.';
    }

    // Clean up extra markdown or quotes
    answer = answer.replace(/^["']|["']$/g, '').replace(/\*\*/g, '');

    // Trim length if needed
    if (answer.length > 350) {
      answer = answer.slice(0, 347) + '...';
    }

    return answer;
  } catch (error) {
    console.error('Gemini API Error:', error?.message || error);
    return 'AI abhi available nahi hai, thodi der baad try karo.';
  }
}

// --------------------------------------------------------------------------
// Nightbot Route: GET /ai?q=$(querystring)
// Nightbot URLFetch makes a GET request and expects plain text
// --------------------------------------------------------------------------
app.get('/ai', rateLimiter, async (req, res) => {
  const query = req.query.q || req.query.query || req.query.question || '';
  const reply = await generateAiReply(query);

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).send(reply);
});

// Support POST /ai if someone integrates via webhooks or bots
app.post('/ai', rateLimiter, async (req, res) => {
  const query = req.body.q || req.body.question || '';
  const reply = await generateAiReply(query);

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.status(200).send(reply);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    uptime: Math.floor(process.uptime()),
    geminiConfigured: Boolean(apiKey)
  });
});

// Root welcome
app.get('/', (req, res) => {
  res.type('text/html').send(`
    <html>
      <head><title>Nightbot AI Backend</title></head>
      <body style="font-family: sans-serif; padding: 40px; line-height: 1.6; max-width: 600px; margin: auto;">
        <h2>🤖 Nightbot AI Chatbot Backend is Running!</h2>
        <p>Endpoint for Nightbot: <code>/ai?q=$(querystring)</code></p>
        <p><strong>Example Command:</strong></p>
        <pre style="background: #f4f4f4; padding: 12px; border-radius: 6px;">$(urlfetch https://${req.headers.host || 'YOUR_DOMAIN'}/ai?q=$(querystring))</pre>
        <p>Health status: <a href="/health">/health</a></p>
      </body>
    </html>
  `);
});

// Global error handler so the server NEVER crashes
app.use((err, req, res, next) => {
  console.error('Server unhandled error:', err);
  res.status(200).type('text/plain; charset=utf-8').send('AI abhi available nahi hai, thodi der baad try karo.');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Nightbot AI Server running on port ${PORT}`);
});

require('dotenv').config();
const express = require('express');
const { Resend } = require('resend');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Simple in-memory rate limiting with cleanup
const submissions = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 10;

// Clean old entries every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of submissions.entries()) {
    const filtered = times.filter((time) => now - time < RATE_LIMIT_WINDOW);
    if (filtered.length === 0) {
      submissions.delete(ip);
    } else {
      submissions.set(ip, filtered);
    }
  }
}, 60 * 60 * 1000);

// Validation functions
const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const sanitizeText = (text) => {
  return text.toString().trim().slice(0, 1000);
};

// Contact form endpoint
app.post('/api/contact', async (req, res) => {
  try {
    // Rate limiting
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const userSubmissions = submissions.get(ip) || [];

    const recentSubmissions = userSubmissions.filter(
      (time) => now - time < RATE_LIMIT_WINDOW
    );

    if (recentSubmissions.length >= MAX_REQUESTS) {
      return res.status(429).json({
        success: false,
        message: 'Too many submissions. Please try again in 15 minutes.',
      });
    }

    // Validate required fields
    const { name, email, message, package: packageName, phone } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and message are required.',
      });
    }

    // Sanitize and validate
    const sanitizedName = sanitizeText(name);
    const sanitizedEmail = email.toString().trim();
    const sanitizedMessage = sanitizeText(message);
    const sanitizedPackage = packageName
      ? sanitizeText(packageName)
      : 'General Inquiry';
    const sanitizedPhone = phone ? sanitizeText(phone) : 'Not provided';

    if (sanitizedName.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Name must be at least 2 characters.',
      });
    }

    if (!isValidEmail(sanitizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.',
      });
    }

    if (sanitizedMessage.length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Message must be at least 10 characters.',
      });
    }

    // Send email via Resend
    const { data, error } = await resend.emails.send({
      from: 'FusionBridge Contact <onboarding@resend.dev>',
      to: 'officialfusionbridge@gmail.com',
      reply_to: sanitizedEmail,
      subject: `New Contact: ${sanitizedName} - ${sanitizedPackage}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px; }
              .content { background: #f8fafc; padding: 20px; border-radius: 10px; margin: 20px 0; }
              .field { margin: 10px 0; }
              .label { font-weight: bold; color: #374151; }
              .message-box { background: white; padding: 15px; border-radius: 5px; margin-top: 5px; white-space: pre-wrap; }
            </style>
          </head>
          <body>
            <div class="header">
              <h2>🚀 New Contact Form Submission</h2>
            </div>
            <div class="content">
              <div class="field"><span class="label">Name:</span> ${sanitizedName}</div>
              <div class="field"><span class="label">Email:</span> <a href="mailto:${sanitizedEmail}">${sanitizedEmail}</a></div>
              <div class="field"><span class="label">Phone:</span> ${sanitizedPhone}</div>
              <div class="field"><span class="label">Package:</span> ${sanitizedPackage}</div>
              <div class="field"><span class="label">Message:</span></div>
              <div class="message-box">${sanitizedMessage}</div>
              <div class="field" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e5e7eb;">
                <span class="label">Time:</span> ${new Date().toLocaleString(
                  'en-GB'
                )}<br>
                <span class="label">IP:</span> ${ip}
              </div>
            </div>
            <p style="color: #64748b; text-align: center; margin-top: 20px;">
              <em>Sent via FusionBridge Website</em>
            </p>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error('Resend error:', error);
      throw new Error('Failed to send email');
    }

    // Update rate limiting after successful submission
    recentSubmissions.push(now);
    submissions.set(ip, recentSubmissions);

    console.log(
      `✅ Contact form submitted: ${sanitizedName} - ${sanitizedEmail} - Package: ${sanitizedPackage} - Resend ID: ${data.id}`
    );

    res.json({
      success: true,
      message: 'Thank you! We will get back to you within 24 hours.',
      id: data.id,
    });
  } catch (error) {
    console.error('Contact form error:', error);

    res.status(500).json({
      success: false,
      message:
        'System temporarily unavailable. Please try again in a few minutes or contact us via WhatsApp.',
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Resend',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    message: 'Something went wrong. Please try again later.',
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 FusionBridge backend running on port ${PORT}`);
  console.log(`📧 Email service: Resend`);
  console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
  console.log(`💌 Contact endpoint: http://localhost:${PORT}/api/contact`);
});

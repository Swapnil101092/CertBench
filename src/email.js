// Sends the OTP by email instead of SMS — genuinely free forever, no
// billing, works for anyone with an email address (not just verified test
// numbers). Uses Gmail SMTP by default via a free Gmail account + an "app
// password" (no card required). Any other SMTP provider works too — see
// EMAIL_HOST below.
//
// If EMAIL_USER / EMAIL_PASS are not configured (e.g. local development,
// or you haven't set this up yet), this falls back to logging the code to
// the server console so you can still develop and test end to end.
//
// To send real emails:
//   1. Use (or create) a free Gmail account.
//   2. Turn on 2-Step Verification on that Google account (required for
//      app passwords): https://myaccount.google.com/security
//   3. Create an "app password": https://myaccount.google.com/apppasswords
//      (choose "Mail" as the app). Google gives you a 16-character code.
//   4. In .env, set:
//        EMAIL_USER=youraddress@gmail.com
//        EMAIL_PASS=the16charapppassword   (no spaces)
//
// To use a different SMTP provider (Brevo, Resend, your own mail server,
// etc.) instead of Gmail, also set EMAIL_HOST / EMAIL_PORT / EMAIL_SECURE
// in .env — see .env.example for the exact fields.

// ---- Option 1 (recommended on Railway): Brevo's HTTPS email API ----
// Railway blocks outbound SMTP (ports 25/465/587) on its Free, Trial and Hobby
// plans, so Gmail SMTP just hangs there. Brevo sends over normal HTTPS instead
// and has a free tier. Set:
//   BREVO_API_KEY=xkeysib-...           (Brevo → SMTP & API → API keys)
//   EMAIL_FROM_ADDRESS=you@gmail.com    (a sender you verified in Brevo → Senders)
//   EMAIL_FROM_NAME=CertBench           (optional)
function brevoConfigured(){
  return !!(process.env.BREVO_API_KEY && (process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER));
}

// ---- Option 2: SMTP (Gmail app password or any SMTP host) ----
function smtpConfigured(){
  return !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

function isConfigured(){
  return brevoConfigured() || smtpConfigured();
}

let transporter = null;
function getTransporter(){
  if(!smtpConfigured()) return null;
  if(!transporter){
    const nodemailer = require('nodemailer');
    if(process.env.EMAIL_HOST){
      transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT || 587),
        secure: process.env.EMAIL_SECURE === 'true',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
      });
    } else {
      // Gmail shorthand — nodemailer knows the right host/port for it.
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        // Fail in seconds instead of minutes if the host blocks SMTP,
        // so the sign-in button shows an error rather than spinning.
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
      });
    }
  }
  return transporter;
}

async function sendOtpEmail(toEmail, code){
  return sendCodeEmail(toEmail, code, {
    subject: 'Your CertBench verification code',
    intro: 'Your CertBench verification code is:',
    footer: "It expires in 5 minutes. If you didn't request this, you can ignore this email."
  });
}

async function sendPasswordResetEmail(toEmail, code){
  return sendCodeEmail(toEmail, code, {
    subject: 'Reset your CertBench password',
    intro: 'Your CertBench password reset code is:',
    footer: "It expires in 10 minutes. If you didn't request a password reset, you can safely ignore this email — your password won't change."
  });
}

async function sendViaBrevo(toEmail, subject, text, html){
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: process.env.EMAIL_FROM_NAME || 'CertBench', email: process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER },
      to: [{ email: toEmail }],
      subject, textContent: text, htmlContent: html
    }),
    signal: AbortSignal.timeout(15000)
  });
  const body = await res.text();
  if(!res.ok) throw new Error(`Brevo API ${res.status}: ${body.slice(0, 300)}`);
  console.log(`[EMAIL] Sent via Brevo to ${toEmail} ("${subject}") — ${body.slice(0, 120)}`);
  return { delivered: true, devFallback: false };
}

async function sendCodeEmail(toEmail, code, { subject, intro, footer }){
  const text = `${intro} ${code}. ${footer}`;
  const html = `<p>${intro}</p>
           <p style="font-size:28px;font-weight:700;letter-spacing:.2em;font-family:monospace">${code}</p>
           <p>${footer}</p>`;
  if(brevoConfigured()) return sendViaBrevo(toEmail, subject, text, html);

  const t = getTransporter();

  if(!t){
    console.log(`[DEV EMAIL FALLBACK] Would email ${toEmail} — "${subject}": code ${code}`);
    return { delivered: false, devFallback: true };
  }

  const info = await t.sendMail({
    from: process.env.EMAIL_FROM || `"CertBench" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject,
    text: `${intro} ${code}. ${footer}`,
    html: `<p>${intro}</p>
           <p style="font-size:28px;font-weight:700;letter-spacing:.2em;font-family:monospace">${code}</p>
           <p>${footer}</p>`
  });

  // Log what the mail server actually said, so a "the login worked but the
  // email never arrived" report can be diagnosed from this line instead of
  // guessed at — messageId means the SMTP server accepted the message for
  // delivery; a non-empty "rejected" array means it did not.
  console.log(`[EMAIL] Sent to ${toEmail} ("${subject}") — messageId: ${info.messageId}, accepted: ${JSON.stringify(info.accepted)}, rejected: ${JSON.stringify(info.rejected)}`);

  return { delivered: true, devFallback: false };
}

module.exports = { sendOtpEmail, sendPasswordResetEmail, isConfigured };

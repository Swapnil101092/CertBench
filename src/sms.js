// Sends the mobile verification code by SMS through Brevo (the same account used for email).
//
// Set on the server (Railway → Variables):
//   BREVO_API_KEY=xkeysib-...     (already set for email)
//   SMS_SENDER=CERTBN             your DLT-approved sender ID / header (max 11 letters, or 15 digits)
//   SMS_TEMPLATE=...              optional: the exact text of your DLT-approved template, with {code}
//                                 where the code goes. Indian operators drop SMS whose text does not
//                                 match an approved template word for word.
//
// Until SMS_SENDER is set, SMS is "not configured": registration then skips the mobile code (and,
// on a dev machine with no email either, the code is shown on screen so you can test end to end).
const DEFAULT_TEMPLATE = 'Your CertBench verification code is {code}. It is valid for 10 minutes. Do not share it with anyone.';

function isConfigured(){
  return !!(process.env.BREVO_API_KEY && process.env.SMS_SENDER);
}

function smsText(code){
  return (process.env.SMS_TEMPLATE || DEFAULT_TEMPLATE).split('{code}').join(code);
}

// mobile: the 10-digit Indian number as stored on the account.
async function sendOtpSms(mobile, code){
  if(!isConfigured()){
    console.log(`[DEV SMS FALLBACK] Would text +91 ${mobile}: code ${code}`);
    return { delivered: false, devFallback: true };
  }
  const res = await fetch('https://api.brevo.com/v3/transactionalSMS/send', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: process.env.SMS_SENDER, recipient: '91' + mobile, content: smsText(code), type: 'transactional' }),
    signal: AbortSignal.timeout(15000)
  });
  const body = await res.text();
  if(!res.ok) throw new Error(`Brevo SMS API ${res.status}: ${body.slice(0, 300)}`);
  console.log(`[SMS] Sent via Brevo to +91 ${mobile.slice(0, 2)}******${mobile.slice(-2)} — ${body.slice(0, 120)}`);
  return { delivered: true, devFallback: false };
}

module.exports = { sendOtpSms, isConfigured, smsText };

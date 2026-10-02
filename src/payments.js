const crypto = require('crypto');

// Enrollment payments, via Razorpay (good fit for India: UPI, cards, netbanking).
//
// DEV MODE: if RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set, this module
// never talks to a real payment gateway. Instead, createOrder() returns a
// fake order and the enrollment is marked paid immediately — so you can
// build and test the whole enroll -> pay -> unlock-exam flow with zero
// signup. This mirrors src/sms.js's dev fallback for OTP.
//
// GOING LIVE: sign up at https://dashboard.razorpay.com/signup, grab your
// **Test Mode** Key ID/Secret from Settings -> API Keys (no KYC needed for
// test mode), and put them in .env. Real Checkout opens, using Razorpay's
// published test card numbers — still no real money moves. Only switching
// to **Live Mode** keys (which requires completing Razorpay's KYC/business
// verification) makes this collect real payments.

function isConfigured(){
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

let razorpayClient = null;
function getClient(){
  if(!isConfigured()) return null;
  if(!razorpayClient){
    const Razorpay = require('razorpay');
    razorpayClient = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
  }
  return razorpayClient;
}

/**
 * Creates a payment order for the given amount (in paise).
 * Returns { orderId, devMode, keyId }.
 */
async function createOrder(amountPaise, receipt){
  const client = getClient();

  if(!client){
    // Dev fallback — no real gateway configured.
    const fakeOrderId = 'dev_order_' + crypto.randomBytes(10).toString('hex');
    return { orderId: fakeOrderId, devMode: true, keyId: null };
  }

  const order = await client.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt,
    payment_capture: 1
  });
  return { orderId: order.id, devMode: false, keyId: process.env.RAZORPAY_KEY_ID };
}

/**
 * Verifies a Razorpay Checkout signature. Only meaningful when a real
 * gateway is configured — dev-mode enrollments are marked paid directly by
 * the route handler instead of going through this.
 */
function verifySignature(orderId, paymentId, signature){
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if(!secret) return false;
  const expected = crypto.createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  // Constant-time comparison to avoid timing attacks.
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || '');
  if(a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { isConfigured, createOrder, verifySignature };

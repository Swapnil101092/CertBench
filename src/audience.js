// Who a certificate is for. Accounts are either Students or IT Professionals, and each sees only the
// certificates meant for them. Admins, signed-out visitors and accounts that haven't chosen yet see all.
// An exam someone has already paid for always stays open to them, even after they switch type.
const db = require('./db');
const { isAdminUser } = require('./auth');

const AUDIENCES = ['student', 'professional'];
const LABELS = { student: 'Students', professional: 'IT Professionals' };

function isAudience(v){ return AUDIENCES.includes(v); }

// null = sees everything.
function viewerAudience(userId){
  if(!userId) return null;
  const u = db.prepare('SELECT id, email, email_verified, is_admin, account_type FROM users WHERE id = ?').get(userId);
  if(!u || isAdminUser(u)) return null;
  return isAudience(u.account_type) ? u.account_type : null;
}

function hasPaid(userId, examId){
  return !!db.prepare("SELECT 1 FROM enrollments WHERE user_id = ? AND exam_id = ? AND status = 'paid'").get(userId, examId);
}

// Can this user open / buy this exam?
function allowed(exam, userId, viewer = viewerAudience(userId)){
  if(!viewer || exam.audience === viewer) return true;
  return !!userId && hasPaid(userId, exam.id);
}

function deniedMessage(exam){
  return `This certificate is for ${LABELS[exam.audience] || 'other accounts'}. You can switch your account type from the menu under your name.`;
}

module.exports = { AUDIENCES, LABELS, isAudience, viewerAudience, allowed, deniedMessage };

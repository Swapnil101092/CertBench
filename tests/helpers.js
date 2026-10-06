// Starts a throw-away CertBench server on a temp database and gives tests a tiny API client.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function startServer(){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'certbench-test-'));
  const port = 4100 + Math.floor(Math.random() * 800);
  const env = {
    ...process.env,
    PORT: String(port),
    DB_PATH: path.join(dir, 'test.db'),
    JWT_SECRET: 'test-secret-' + Math.random(),
    // No email / SMS provider: the API hands back the codes so sign-up and password reset can be tested.
    EMAIL_USER: '', EMAIL_PASS: '', BREVO_API_KEY: '', ADMIN_EMAILS: ''
  };
  let proc, log = '';
  const base = `http://127.0.0.1:${port}`;
  async function launch(){
    proc = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', d => { log += d; });
    proc.stderr.on('data', d => { log += d; });
    for(let i = 0; i < 100; i++){
      try{ const r = await fetch(base + '/api/health'); if(r.ok) break; }catch(e){}
      await new Promise(r => setTimeout(r, 100));
      if(i === 99) throw new Error('Server did not start:\n' + log);
    }
  }
  await launch();
  // Stop and start the server again on the same database (e.g. to test what happens on the next deploy).
  async function restart(){
    const exited = new Promise(r => proc.once('exit', r));
    proc.kill(); await exited;
    await launch();
  }
  let ip = 0;
  async function api(p, { method = 'GET', body, token, raw } = {}){
    const headers = { 'content-type': 'application/json', 'x-forwarded-for': `10.0.${Math.floor(++ip / 250)}.${ip % 250}` };
    if(token) headers.authorization = 'Bearer ' + token;
    const res = await fetch(base + '/api' + p, { method, headers, body: raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body)) });
    let data = null; try{ data = await res.json(); }catch(e){}
    return { status: res.status, data };
  }
  function stop(){ proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
  // Run a SQL statement directly against the test database (e.g. to create pre-existing "legacy" rows).
  function sql(statement, ...params){
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(env.DB_PATH); try{ return d.prepare(statement).run(...params); } finally { d.close(); }
  }
  // Sign up the way the website does: send the details, then confirm the email + mobile codes
  // (with no email / SMS provider configured, the server hands the codes back for testing).
  async function signUp(body){
    const r = await api('/auth/register', { method: 'POST', body });
    if(r.status !== 201) return r;
    return api('/auth/register/verify', { method: 'POST', body: { registrationId: r.data.registrationId, emailCode: r.data.devEmailOtp, mobileCode: r.data.devMobileOtp } });
  }
  return { api, signUp, stop, restart, base, sql, dbPath: env.DB_PATH, log: () => log };
}

let n = 0;
// A valid registration payload; every call gets a unique username / email / mobile.
function validUser(over = {}){
  n++;
  const tag = 'abcdefghijklmnopqrstuvwxyz'[n % 26] + 'abcdefghijklmnopqrstuvwxyz'[Math.floor(n / 26) % 26];
  return {
    name: 'Test User',
    email: `tester.${tag}${Date.now() % 100000}@example.com`,
    mobile: '9' + String(800000000 + n * 7919 + Math.floor(Math.random() * 1000)).slice(0, 9),
    username: 'tester_' + tag,
    password: 'Secret@123',
    ...over
  };
}

module.exports = { startServer, validUser };

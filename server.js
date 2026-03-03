/**
 * iCode Glen Ellyn Dashboard — Proxy Server
 * Run: node server.js  →  open http://localhost:3000
 *
 * CONFIRMED WORKING (bearer token after login):
 *   Student/stats?franchiseIds=67  → student count summary
 *   Lead/GetLeads?franchiseIds=67  → 578 leads with full fields
 *
 * NEEDS PUBLIC API KEY (find in Calimatic → Settings → Integrations → API Keys):
 *   PublicAPI/GetAllStudentEnrollments  → enrollments
 *   PublicAPI/GetClassesDetailsInfo     → classes
 *   PublicAPI/GetTransactionHistory     → transactions/revenue
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT         = 3000;
const API_BASE     = 'https://api.calimatic.com/api';
const DOMAIN_URL   = 'https://portal.icodeschool.com';
const FRANCHISE_ID = 67;

// ─── PUBLIC API KEY ───────────────────────────────────────────────────────────
// Set via environment variable (recommended for deployment):
//   Railway / Render: add PUBLIC_API_KEY in the Variables dashboard
//   Local: create a .env file or set in your shell before running
// Format: https://portal.icodeschool.com|YOUR_KEY
const PUBLIC_API_KEY = process.env.PUBLIC_API_KEY
  || 'https://portal.icodeschool.com|RjIwMjYyNjAyMTcxOTE0XjE5NyBHbGVuIEVsbHlu';
// ──────────────────────────────────────────────────────────────────────────────

let bearerToken       = null;
let tokenExpiry       = null;
let storedCredentials = null;

// Load credentials from environment variables (for deployment)
// or from .credentials.json (for local development)
if (process.env.CALIMATIC_USERNAME && process.env.CALIMATIC_PASSWORD) {
  storedCredentials = { userName: process.env.CALIMATIC_USERNAME, password: process.env.CALIMATIC_PASSWORD };
  console.log('Loaded credentials from environment variables for:', storedCredentials.userName);
} else {
  const CREDS_FILE = path.join(__dirname, '.credentials.json');
  if (fs.existsSync(CREDS_FILE)) {
    try { storedCredentials = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8')); console.log('Loaded saved credentials for:', storedCredentials.userName); } catch(e) {}
  }
}

function httpsGet(targetUrl, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(targetUrl);
    const options = {
      hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Origin': DOMAIN_URL, 'Referer': DOMAIN_URL + '/', ...extraHeaders },
    };
    const req = https.request(options, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function httpsPost(targetUrl, body) {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(targetUrl);
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*', 'Content-Length': Buffer.byteLength(bodyStr), 'User-Agent': 'Mozilla/5.0', 'Origin': DOMAIN_URL, 'Referer': DOMAIN_URL + '/' },
    };
    const req = https.request(options, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(bodyStr); req.end();
  });
}

async function login(userName, password) {
  console.log('\nLogging in as', userName, '...');
  try {
    const res = await httpsPost(`${API_BASE}/Auth/appLogin`, { userName, password, domainUrl: DOMAIN_URL, userTimezone: 'America/Chicago', browser: 'Chrome', browserVersion: '145.0.0.0', os: 'Windows', osVersion: 'Windows 10/11', platform: 'Win32', deviceType: 'Desktop', language: 'en-US', screenResolution: '1920x1080', sessionId: 'dashboard-' + Date.now(), deviceFingerprint: 'dashboard-proxy' });
    console.log('Login HTTP:', res.status);
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      const token = data.token || data.access_token || data.accessToken || data.data?.token || (typeof data.response === 'string' ? data.response : null) || data.response?.token;
      if (token) { bearerToken = token; tokenExpiry = Date.now() + 55*60*1000; console.log('✅ Login successful'); return { success: true }; }
      return { success: false, error: 'No token found: ' + res.body.substring(0, 200) };
    }
    return { success: false, error: 'HTTP ' + res.status };
  } catch(e) { return { success: false, error: e.message }; }
}

async function ensureToken() {
  if (bearerToken && tokenExpiry && Date.now() < tokenExpiry) return bearerToken;
  if (storedCredentials) { const r = await login(storedCredentials.userName, storedCredentials.password); if (r.success) return bearerToken; }
  return null;
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (pathname === '/' || pathname === '/index.html') {
    const htmlPath = path.join(__dirname, 'dashboard.html');
    if (fs.existsSync(htmlPath)) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(htmlPath)); }
  }

  if (pathname === '/login' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { username, password, remember } = JSON.parse(body);
        const result = await login(username, password);
        if (result.success && remember) fs.writeFileSync(CREDS_FILE, JSON.stringify({ userName: username, password }));
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
      } catch(e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: e.message })); }
    });
    return;
  }

  if (pathname === '/status') {
    // Auto-login if we have saved credentials but no active token
    if (storedCredentials && (!bearerToken || Date.now() >= (tokenExpiry||0))) {
      await login(storedCredentials.userName, storedCredentials.password).catch(() => {});
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ authenticated: !!bearerToken && Date.now() < (tokenExpiry||0), hasSavedCredentials: !!storedCredentials, hasPublicApiKey: !!PUBLIC_API_KEY, franchiseId: FRANCHISE_ID }));
  }

  // Bearer-token proxy — confirmed working endpoints
  if (pathname.startsWith('/api/')) {
    const ep = pathname.replace('/api/', '');
    const qs = parsed.search ? parsed.search.substring(1) : '';
    try {
      const token = await ensureToken();
      if (!token) { res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify({ needsLogin: true, response: [] })); }
      const targetUrl = `${API_BASE}/${ep}${qs ? '?' + qs : ''}`;
      console.log('→ [bearer]', ep, qs ? '?' + qs : '');
      const result = await httpsGet(targetUrl, { 'Authorization': 'Bearer ' + token });
      console.log(' ←', result.status, '(' + result.body.length + 'b)');
      res.writeHead(result.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(result.body);
    } catch(err) { res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ error: err.message, response: [] })); }
    return;
  }

  // PublicAPI proxy — requires PUBLIC_API_KEY to be set above
  if (pathname.startsWith('/pub/')) {
    const ep = pathname.replace('/pub/', '');
    const qs = parsed.search ? parsed.search.substring(1) : '';
    if (!PUBLIC_API_KEY) {
      res.writeHead(501, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ error: 'PUBLIC_API_KEY not set in server.js', response: [] }));
    }
    try {
      const targetUrl = `${API_BASE}/${ep}${qs ? '?' + qs : ''}`;
      console.log('→ [pubkey]', ep, qs ? '?' + qs : '');
      const result = await httpsGet(targetUrl, { 'Authorization': PUBLIC_API_KEY });
      console.log(' ←', result.status, '(' + result.body.length + 'b)');
      res.writeHead(result.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(result.body);
    } catch(err) { res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify({ error: err.message, response: [] })); }
    return;
  }

  // /debug/enrollments — detailed enrollment field analysis
  if (pathname === '/debug/enrollments') {
    try {
      const PUB_AUTH = 'https://portal.icodeschool.com|RjIwMjYyNjAyMTcxOTE0XjE5NyBHbGVuIEVsbHlu';
      const pubHdrs = { 'Authorization': PUB_AUTH, 'Content-Type': 'application/json' };
      const [er, cr] = await Promise.all([
        fetch(`${API_BASE}/PublicAPI/GetAllStudentEnrollments?enrollmentType=0`, { headers: pubHdrs }),
        fetch(`${API_BASE}/PublicAPI/GetClassesDetailsInfo?CampusId=67`, { headers: pubHdrs }),
      ]);
      const json = await er.json();
      const classJson = await cr.json();
      const rows = Array.isArray(json.response) ? json.response : [];
      const classes = Array.isArray(classJson.response) ? classJson.response : [];
      // Build price map
      const priceMap = {};
      classes.forEach(c => { if (c.className) priceMap[c.className] = { price: c.price, salesPrice: c.salesPrice, originalPrice: c.originalPrice }; });

      // Analyze classType values
      const classTypeCounts = {};
      const studentStatusCounts = {};
      rows.forEach(e => {
        const ct = String(e.classType ?? 'null');
        const ss = String(e.studentStatus ?? 'null');
        classTypeCounts[ct] = (classTypeCounts[ct] || 0) + 1;
        studentStatusCounts[ss] = (studentStatusCounts[ss] || 0) + 1;
      });

      // Get 3 sample belt records
      const beltSamples = rows.filter(e => (e.classType||'').toLowerCase().includes('belt')).slice(0, 3);
      // Get 3 sample camp records  
      const campSamples = rows.filter(e =>
        (e.classType||'').toLowerCase().includes('camp') ||
        (e.classCategory||'').toLowerCase().includes('camp')
      ).slice(0, 3);

      const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><head><style>
        body{font-family:monospace;padding:24px;background:#0d0f14;color:#e2e6f0}
        h2{color:#6875f5;margin:20px 0 8px}
        table{border-collapse:collapse;width:100%;margin-bottom:24px}
        th{background:#1a1e2b;color:#7c829e;padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase}
        td{border-bottom:1px solid #272c3d;padding:8px 12px;font-size:12px;vertical-align:top}
        .val{color:#34d399;font-weight:600}
        .cnt{color:#fbbf24}
        pre{background:#1a1e2b;padding:12px;border-radius:8px;font-size:11px;overflow-x:auto;color:#a78bfa;white-space:pre-wrap;word-break:break-all}
      </style></head><body>
        <h1 style="color:#e2e6f0">📚 Enrollment Field Analysis</h1>
        <p style="color:#7c829e">Total records: <strong style="color:#6875f5">${rows.length}</strong></p>

        <h2>classType Distribution</h2>
        <table><tr><th>classType value</th><th>Count</th></tr>
        ${Object.entries(classTypeCounts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>
          `<tr><td class="val">"${esc(k)}"</td><td class="cnt">${v}</td></tr>`
        ).join('')}
        </table>

        <h2>studentStatus Distribution</h2>
        <table><tr><th>studentStatus value</th><th>JS Type</th><th>Count</th><th>Example className</th></tr>
        ${Object.entries(studentStatusCounts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>{
          const sample = rows.find(e => String(e.studentStatus??'null') === k);
          const typ = sample ? typeof sample.studentStatus : '?';
          return `<tr><td class="val">${esc(k)}</td><td style="color:#60a5fa">${typ}</td><td class="cnt">${v}</td><td style="color:#e2e6f0">${esc(sample?.className||'')}</td></tr>`;
        }).join('')}
        </table>

        <h2>Belt Classes — Active vs Total</h2>
        <table><tr><th>className</th><th>Total enrolled</th><th>studentStatus=true</th><th>studentStatus=false</th></tr>
        ${(() => {
          const beltRows = rows.filter(e => (e.classType||'') === 'Belts');
          const byClass = {};
          beltRows.forEach(e => {
            const n = e.className || '?';
            if (!byClass[n]) byClass[n] = { total:0, active:0, inactive:0 };
            byClass[n].total++;
            if (e.studentStatus === true) byClass[n].active++;
            else byClass[n].inactive++;
          });
          return Object.entries(byClass).sort((a,b)=>b[1].total-a[1].total)
            .map(([n,c]) => `<tr><td style="color:#e2e6f0;font-weight:600">${esc(n)}</td><td class="cnt">${c.total}</td><td style="color:#34d399">${c.active}</td><td style="color:#f87171">${c.inactive}</td></tr>`)
            .join('');
        })()}
        </table>

        <h2>Sample Belt Records (${beltSamples.length})</h2>
        ${beltSamples.map(e => `<pre>${esc(JSON.stringify(e, null, 2))}</pre>`).join('')}

        <h2>Sample Camp Records (${campSamples.length})</h2>
        ${campSamples.map(e => `<pre>${esc(JSON.stringify(e, null, 2))}</pre>`).join('')}
      </body></html>`);
    } catch(e) {
      res.writeHead(500); res.end('Error: ' + e.message);
    }
    return;
  }

  // /debug/camps — show class types and upcomingDates for camp matching
  if (pathname === '/debug/camps') {
    try {
      const PUB_AUTH = 'https://portal.icodeschool.com|RjIwMjYyNjAyMTcxOTE0XjE5NyBHbGVuIEVsbHlu';
      const pubHdrs = { 'Authorization': PUB_AUTH, 'Content-Type': 'application/json' };

      const [classRes, enrollRes] = await Promise.all([
        fetch(`${API_BASE}/PublicAPI/GetClassesDetailsInfo?CampusId=67`, { headers: pubHdrs }),
        fetch(`${API_BASE}/PublicAPI/GetAllStudentEnrollments?enrollmentType=0`, { headers: pubHdrs }),
      ]);
      const classJson  = await classRes.json();
      const enrollJson = await enrollRes.json();
      const classes    = Array.isArray(classJson.response)  ? classJson.response  : [];
      const enrolls    = Array.isArray(enrollJson.response) ? enrollJson.response : [];

      // classType distribution in classes
      const classTypeCounts = {};
      classes.forEach(c => { const k = String(c.classType??'null'); classTypeCounts[k]=(classTypeCounts[k]||0)+1; });

      // Camp enrollments
      const campEnrolls = enrolls.filter(e =>
        (e.classType||'').toLowerCase().includes('camp') ||
        (e.classCategory||'').toLowerCase().includes('camp')
      );
      const campClassNames = [...new Set(campEnrolls.map(e => e.className).filter(Boolean))];

      // Match class records to camp classNames
      const matchedClasses = classes.filter(c => campClassNames.includes(c.className));
      const unmatchedNames = campClassNames.filter(n => !classes.find(c => c.className === n));

      const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

      res.writeHead(200, {'Content-Type':'text/html'});
      res.end(`<html><head><style>
        body{font-family:monospace;padding:24px;background:#0d0f14;color:#e2e6f0}
        h2{color:#6875f5;margin:20px 0 8px}
        table{border-collapse:collapse;width:100%;margin-bottom:24px}
        th{background:#1a1e2b;color:#7c829e;padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase}
        td{border-bottom:1px solid #272c3d;padding:8px 12px;font-size:12px;vertical-align:top}
        .g{color:#34d399}.y{color:#fbbf24}.r{color:#f87171}.p{color:#a78bfa}
        pre{background:#1a1e2b;padding:10px;border-radius:6px;font-size:11px;white-space:pre-wrap;word-break:break-all;color:#a78bfa}
      </style></head><body>
        <h1 style="color:#e2e6f0">🏕️ Camp Date Debug</h1>

        <h2>classType in GetClassesDetailsInfo (${classes.length} total classes)</h2>
        <table><tr><th>classType</th><th>Count</th></tr>
        ${Object.entries(classTypeCounts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>
          `<tr><td class="g">"${esc(k)}"</td><td class="y">${v}</td></tr>`
        ).join('')}</table>

        <h2>Camp enrollment classNames (${campClassNames.length} unique) vs Classes endpoint</h2>
        <table><tr><th>className (from enrollments)</th><th>Found in classes?</th><th>classType in classes</th><th>upcomingDates count</th></tr>
        ${campClassNames.map(n => {
          const cls = classes.find(c => c.className === n);
          return `<tr>
            <td>${esc(n)}</td>
            <td class="${cls?'g':'r'}">${cls ? '✅ YES' : '❌ NO'}</td>
            <td class="p">${esc(cls?.classType||'—')}</td>
            <td class="y">${cls?.upcomingDates?.length ?? '—'}</td>
          </tr>`;
        }).join('')}</table>

        <h2>Sample matched class with upcomingDates</h2>
        ${matchedClasses.slice(0,3).map(c => `<pre>${esc(JSON.stringify({
          className: c.className,
          classType: c.classType,
          upcomingDatesCount: c.upcomingDates?.length,
          upcomingDatesSample: (c.upcomingDates||[]).slice(0,5),
          slots: c.slots
        }, null, 2))}</pre>`).join('')}

        <h2>Unmatched camp classNames (${unmatchedNames.length})</h2>
        ${unmatchedNames.map(n=>`<div class="r">${esc(n)}</div>`).join('<br>')}
      </body></html>`);
    } catch(e) { res.writeHead(500); res.end('Error: ' + e.message); }
    return;
  }

  // /debug/campdata — show raw camp enrollment fields + class prices
  if (pathname === '/debug/campdata') {
    try {
      const PUB_AUTH = 'https://portal.icodeschool.com|RjIwMjYyNjAyMTcxOTE0XjE5NyBHbGVuIEVsbHlu';
      const pubHdrs = { 'Authorization': PUB_AUTH, 'Content-Type': 'application/json' };
      const [er, cr] = await Promise.all([
        fetch(`${API_BASE}/PublicAPI/GetAllStudentEnrollments?enrollmentType=0`, { headers: pubHdrs }),
        fetch(`${API_BASE}/PublicAPI/GetClassesDetailsInfo?CampusId=67`, { headers: pubHdrs }),
      ]);
      const json = await er.json();
      const classJson = await cr.json();
      const rows = Array.isArray(json.response) ? json.response : [];
      const classes = Array.isArray(classJson.response) ? classJson.response : [];
      // Build price map
      const priceMap = {};
      classes.forEach(c => { if (c.className) priceMap[c.className] = { price: c.price, salesPrice: c.salesPrice, originalPrice: c.originalPrice }; });

      // Get camp enrollments only
      const camps = rows.filter(e =>
        (e.classType||'').toLowerCase().includes('camp') ||
        (e.classCategory||'').toLowerCase().includes('camp')
      );

      // Show first 20 camp records with ALL fields
      const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      // Show ALL fields from the enrollment record
      const fields = Object.keys((camps[0] || {}));

      res.writeHead(200, {'Content-Type':'text/html'});
      res.end(`<html><head><style>
        body{font-family:monospace;padding:24px;background:#0d0f14;color:#e2e6f0;font-size:12px}
        h2{color:#6875f5;margin:20px 0 8px}
        table{border-collapse:collapse;width:100%;margin-bottom:24px;font-size:11px}
        th{background:#1a1e2b;color:#7c829e;padding:6px 10px;text-align:left;white-space:nowrap}
        td{border-bottom:1px solid #272c3d;padding:5px 10px;vertical-align:top;max-width:200px;word-break:break-word}
        .g{color:#34d399}.y{color:#fbbf24}.r{color:#f87171}.p{color:#a78bfa}.b{color:#60a5fa}
      </style></head><body>
        <h1 style="color:#e2e6f0">🏕️ Raw Camp Enrollment Data (${camps.length} records)</h1>
        <h2>Creative Lab : 3D Printing & Design records</h2>
        ${camps.filter(e => (e.className||'').includes('Creative Lab')).slice(0,4).map(e=>
          `<pre style="background:#1a1e2b;padding:10px;border-radius:6px;font-size:11px;color:#a78bfa;white-space:pre-wrap;word-break:break-all;margin-bottom:8px">${esc(JSON.stringify(e, null, 2))}</pre>`
        ).join('')}

        <h2>Class Prices from GetClassesDetailsInfo (Camps only)</h2>
        <table><tr><th>className</th><th>price</th><th>salesPrice</th><th>originalPrice</th></tr>
        ${classes.filter(c=>(c.classType||'')==='Camps').slice(0,20).map(c=>
          `<tr><td>${esc(c.className||'')}</td><td style="color:#34d399">$${c.price||0}</td><td style="color:#fbbf24">$${c.salesPrice||0}</td><td>$${c.originalPrice||0}</td></tr>`
        ).join('')}</table>

        <h2>All camp fields — first 30 records</h2>
        <table>
          <tr>${fields.map(f=>`<th>${f}</th>`).join('')}</tr>
          ${camps.slice(0,30).map(e=>`<tr>${fields.map(f=>{
            const v = e[f];
            const s = v===null?'<span style="color:#4a4f66">null</span>':v===''?'<span style="color:#4a4f66">""</span>':esc(String(v));
            return `<td>${s}</td>`;
          }).join('')}</tr>`).join('')}
        </table>
      </body></html>`);
    } catch(e) { res.writeHead(500); res.end('Error: ' + e.message); }
    return;
  }

  // /debug/prices — show all camp class names and prices from GetClassesDetailsInfo
  if (pathname === '/debug/prices') {
    try {
      const PUB_AUTH = 'https://portal.icodeschool.com|RjIwMjYyNjAyMTcxOTE0XjE5NyBHbGVuIEVsbHlu';
      const pubHdrs = { 'Authorization': PUB_AUTH };
      const [cr, er] = await Promise.all([
        fetch(`${API_BASE}/PublicAPI/GetClassesDetailsInfo?CampusId=67`, { headers: pubHdrs }),
        fetch(`${API_BASE}/PublicAPI/GetAllStudentEnrollments?enrollmentType=0`, { headers: pubHdrs }),
      ]);
      const classes = (await cr.json()).response || [];
      const enrolls = (await er.json()).response || [];
      const campClasses = classes.filter(c => (c.classType||'') === 'Camps');
      const campEnrollClassNames = [...new Set(enrolls
        .filter(e => (e.classType||'').toLowerCase().includes('camp'))
        .map(e => e.className).filter(Boolean))];
      const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      res.writeHead(200, {'Content-Type':'text/html'});
      res.end(`<html><head><style>
        body{font-family:monospace;padding:24px;background:#0d0f14;color:#e2e6f0;font-size:12px}
        h2{color:#6875f5;margin:16px 0 8px}
        table{border-collapse:collapse;width:100%;margin-bottom:20px}
        th{background:#1a1e2b;color:#7c829e;padding:6px 10px;text-align:left}
        td{border-bottom:1px solid #272c3d;padding:5px 10px}
        .g{color:#34d399}.r{color:#f87171}.y{color:#fbbf24}
      </style></head><body>
        <h1>💰 Camp Class Prices</h1>
        <h2>GetClassesDetailsInfo — Camp classes (${campClasses.length})</h2>
        <table><tr><th>className</th><th>price</th><th>salesPrice</th><th>originalPrice</th></tr>
        ${campClasses.map(c=>`<tr>
          <td>${esc(c.className)}</td>
          <td class="g">$${c.price||0}</td>
          <td class="y">$${c.salesPrice||0}</td>
          <td>$${c.originalPrice||0}</td>
        </tr>`).join('')}</table>

        <h2>Enrollment classNames vs Classes — match check</h2>
        <table><tr><th>Enrollment className</th><th>Exact match in classes?</th><th>Price found</th></tr>
        ${campEnrollClassNames.map(n => {
          const match = campClasses.find(c => c.className === n);
          const price = match ? ((match.salesPrice && match.salesPrice > 0) ? match.salesPrice : match.price) : null;
          return `<tr>
            <td>${esc(n)}</td>
            <td class="${match?'g':'r'}">${match ? '✅ YES' : '❌ NO'}</td>
            <td class="${price?'y':''}">${price ? '$'+price : '—'}</td>
          </tr>`;
        }).join('')}</table>
      </body></html>`);
    } catch(e) { res.writeHead(500); res.end('Error: ' + e.message); }
    return;
  }

  // /debug — visual API probe page
  if (pathname === '/debug') {
    const token = await ensureToken();
    if (!token) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html><body style="font-family:sans-serif;padding:40px"><h2>Not authenticated</h2><p><a href="/">Sign in first</a> then return here.</p></body></html>'); }
    console.log('\n🔍 /debug — probing endpoints...\n');

    const probe = async (ep, qs, hdrs) => {
      const u = `${API_BASE}/${ep}${qs ? '?' + qs : ''}`;
      try {
        const r = await httpsGet(u, hdrs);
        let records = null, fields = [], first = null;
        try {
          const d = JSON.parse(r.body);
          const inner = d.response ?? d.Response ?? d.data ?? d;
          if (Array.isArray(inner)) { records = inner.length; first = inner[0] ? JSON.stringify(inner[0]).substring(0,600) : null; fields = inner[0] ? Object.keys(inner[0]) : []; }
          else if (inner && typeof inner === 'object') { records = '(object)'; fields = Object.keys(inner); first = JSON.stringify(inner).substring(0,600); }
        } catch(e2) {}
        console.log(`  ${r.status===200?'✅':'❌'} [${r.status}] ${ep}`);
        return { ep, qs, status: r.status, bytes: r.body.length, records, fields, first, raw: r.body.substring(0,300), ok: r.status===200 };
      } catch(e) { return { ep, qs, status:'ERR', bytes:0, records:null, fields:[], first:null, raw:e.message, ok:false }; }
    };

    const bearerProbes = await Promise.all([
      probe('Student/stats', 'franchiseIds='+FRANCHISE_ID, { 'Authorization': 'Bearer '+token }),
      probe('Lead/GetLeads', 'franchiseIds='+FRANCHISE_ID, { 'Authorization': 'Bearer '+token }),
    ]);
    // Confirmed format: Authorization header = "https://domain|key"
    const PUB_AUTH = 'https://portal.icodeschool.com|RjIwMjYyNjAyMTcxOTE0XjE5NyBHbGVuIEVsbHlu';
    const pubHdrs  = { 'Authorization': PUB_AUTH };
    const pubProbes = await Promise.all([
      probe('PublicAPI/GetAllStudentEnrollments',    'enrollmentType=0',                                                       pubHdrs),
      probe('PublicAPI/GetTransactionHistory',       'franchiseIds='+FRANCHISE_ID+'&startDate=2025-01-01&endDate=2026-12-31', pubHdrs),
      probe('PublicAPI/GetClassesDetailsInfo',       'CampusId='+FRANCHISE_ID,                                                pubHdrs),
      probe('PublicAPI/GetAllLeads',                 '',                                                                       pubHdrs),
      probe('PublicAPI/GetFutureRecurringPayments',  'companyId='+FRANCHISE_ID,                                               pubHdrs),
    ]);

    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const bkg = ok => ok ? '#dcfce7' : '#fee2e2';
    const clr = ok => ok ? '#16a34a' : '#dc2626';
    const badg = ok => `<span style="background:${bkg(ok)};color:${clr(ok)};padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600">${ok?'✅ 200':'❌ '+ok}</span>`;
    const ftags = fs => fs.map(f => `<code style="background:#ede9fe;color:#5b21b6;padding:1px 6px;border-radius:8px;font-size:10px;margin:2px;display:inline-block">${esc(f)}</code>`).join('');
    const trow = r => `<tr style="border-bottom:1px solid #f3f4f6;${r.ok?'':'opacity:.7'}">
      <td style="padding:10px 14px;font-family:monospace;font-size:11px;font-weight:600;white-space:nowrap">${esc(r.ep)}</td>
      <td style="padding:10px 14px;text-align:center"><span style="background:${bkg(r.ok)};color:${clr(r.ok)};padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600">${r.ok ? '✅ '+r.status : '❌ '+r.status}</span></td>
      <td style="padding:10px 14px;font-size:12px;color:#374151;text-align:center;font-weight:600">${esc(r.records??'—')}</td>
      <td style="padding:10px 14px;max-width:420px">${ftags(r.fields)}</td>
      <td style="padding:10px 14px"><details><summary style="cursor:pointer;font-size:11px;color:#9ca3af">show</summary><pre style="background:#f8f9fb;border:1px solid #e2e5ea;border-radius:6px;padding:8px;font-size:10px;overflow-x:auto;white-space:pre-wrap;max-height:140px;overflow-y:auto;margin-top:4px">${esc(r.first||r.raw)}</pre></details></td></tr>`;

    const allData = JSON.stringify({ bearerToken: bearerProbes, publicApi: pubProbes }, null, 2);
    const keyStatus = PUBLIC_API_KEY
      ? `<span style="background:#dcfce7;color:#16a34a;padding:3px 10px;border-radius:10px;font-size:12px;font-weight:600">✅ PUBLIC_API_KEY set</span>`
      : `<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:10px;font-size:12px;font-weight:600">⚠️ PUBLIC_API_KEY not set</span>`;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>API Debug — iCode Glen Ellyn</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f5f7;font-size:14px;color:#1a1d23}
header{background:#fff;border-bottom:1px solid #e2e5ea;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:9;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.btn{background:#5b6af0;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}.btn:hover{background:#4a57d4}.btn.ok{background:#22c55e}
main{padding:20px 24px;max-width:1100px;margin:0 auto}
.banner{background:#fff;border:1px solid #e2e5ea;border-radius:12px;padding:16px 20px;margin-bottom:18px}
.card{background:#fff;border:1px solid #e2e5ea;border-radius:12px;overflow:hidden;margin-bottom:18px}
.chdr{padding:11px 16px;background:#f8f9fb;border-bottom:1px solid #e2e5ea;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6b7280;display:flex;align-items:center;gap:10px}
table{width:100%;border-collapse:collapse}th{padding:8px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#9ca3af;background:#f8f9fb;border-bottom:1px solid #e2e5ea}
a{color:#5b6af0;text-decoration:none}a:hover{text-decoration:underline}
code{background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:11px;font-family:monospace}</style></head><body>
<header>
  <div><strong style="font-size:16px">🔍 API Debug — iCode Glen Ellyn</strong><br><span style="font-size:11px;color:#6b7280">Generated ${new Date().toLocaleString()} &nbsp;·&nbsp; <a href="/">← Dashboard</a></span></div>
  <button class="btn" id="cb" onclick="copy()">📋 Copy Full Report for Claude</button>
</header>
<main>
  <div class="banner" style="display:flex;gap:20px;flex-wrap:wrap">
    <div style="flex:1;min-width:260px"><strong>API Key Status:</strong> &nbsp;${keyStatus}
    ${!PUBLIC_API_KEY ? `<br><br><strong>To enable revenue &amp; enrollment data:</strong><br>
    1. Open Calimatic portal → <strong>Settings → Integrations → API Keys</strong><br>
    2. Copy your API key<br>
    3. Edit <code>server.js</code>, set <code>PUBLIC_API_KEY = 'yourdomain.com|your-key'</code><br>
    4. Restart server &amp; refresh this page` : ''}
    </div>
    <div style="flex:1;min-width:260px"><strong>Available right now:</strong><br>
    • Student counts (total: 238, active: 88, enrolled: 81)<br>
    • Full lead list (578 leads with status, source, dates)</div>
  </div>

  <div class="card">
    <div class="chdr">🔑 Bearer Token Endpoints <span style="font-size:10px;font-weight:400;color:#9ca3af">— always available after login</span></div>
    <table><thead><tr><th>Endpoint</th><th>Status</th><th>Records</th><th>Field Names</th><th>Data</th></tr></thead>
    <tbody>${bearerProbes.map(trow).join('')}</tbody></table>
  </div>

  <div class="card">
    <div class="chdr">🗝️ PublicAPI Endpoints <span style="font-size:10px;font-weight:400;color:#9ca3af">— require PUBLIC_API_KEY</span> &nbsp;${keyStatus}</div>
    <table><thead><tr><th>Endpoint</th><th>Status</th><th>Records</th><th>Field Names</th><th>Data</th></tr></thead>
    <tbody>${pubProbes.map(trow).join('')}</tbody></table>
  </div>
</main>
<textarea id="raw" style="position:absolute;left:-9999px">${esc(allData)}</textarea>
<script>function copy(){navigator.clipboard.writeText(document.getElementById('raw').value).then(()=>{const b=document.getElementById('cb');b.textContent='✅ Copied! Paste into Claude.';b.classList.add('ok');setTimeout(()=>{b.textContent='📋 Copy Full Report for Claude';b.classList.remove('ok');},3000)})}</script>
</body></html>`;

    res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' });
    return res.end(html);
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, async () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║   iCode Glen Ellyn Dashboard                  ║');
  console.log('╠═══════════════════════════════════════════════╣');
  console.log(`║   Dashboard:  http://localhost:${PORT}             ║`);
  console.log(`║   API Debug:  http://localhost:${PORT}/debug       ║`);
  console.log('║   Press Ctrl+C to stop                        ║');
  console.log('╚═══════════════════════════════════════════════╝');
  if (PUBLIC_API_KEY) { console.log('\n✅ PUBLIC_API_KEY set — all data endpoints enabled'); }
  else { console.log('\n⚠️  PUBLIC_API_KEY not set. Revenue & enrollment data unavailable.'); console.log('   See server.js line 23 to configure.\n'); }
  if (storedCredentials) { console.log('Auto-logging in...'); const r = await ensureToken(); if (r) console.log('✅ Ready!'); }
  else { console.log('Open http://localhost:3000 and sign in.'); }
});

// ---------- UI elements ----------
const logoutBtn     = document.getElementById('logout-btn');
const startBtn      = document.getElementById('start-btn');
const stopBtn       = document.getElementById('stop-btn');
const startBreakBtn = document.getElementById('start-break-btn');
const stopBreakBtn  = document.getElementById('stop-break-btn');
const workTimerEl   = document.getElementById('work-timer');
const breakTimerEl  = document.getElementById('break-timer');
const statusIndicatorEl = document.getElementById('status-indicator');
const userTextEl = document.getElementById('user-text');
const lastActiveEl = document.getElementById('last-active');
const userDisplayName = document.getElementById('user-display-name');

const shotsGrid     = document.getElementById('shots');
const shotsOnlyGrid = document.getElementById('shots-only');

const activityListDashboard = document.getElementById('activity-list-dashboard');
const activityListOnly = document.getElementById('activity-list-only');

const notifBtn = document.getElementById('notif-btn');
const notifBadge = document.getElementById('notif-badge');
const notifDropdown = document.getElementById('notif-dropdown');
const notifList = document.getElementById('notif-list');
const notifEmpty = document.getElementById('notif-empty');
const notifMarkReadBtn = document.getElementById('notif-mark-read');
const notifClearBtn = document.getElementById('notif-clear');

// ---------- runtime state ----------
let captureInterval = null;
let isOnManualBreak = false;
let workSeconds = 0;
let breakSeconds = 0;
let workTimerInterval = null;
let breakTimerInterval = null;
let currentUser = null;

let notifications = [];
let nextNotifId = 1;

// ---------- helpers ----------
function enable(el, on = true) { if (el) el.disabled = !on; }
function show(el, on = true) { if (el) el.classList.toggle('hidden', !on); }
function nowTS() { return new Date().toLocaleString(); }

function formatHMS(totalSeconds) {
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2,'0');
  const m = String(Math.floor((totalSeconds % 3600)/60)).padStart(2,'0');
  const s = String(totalSeconds % 60).padStart(2,'0');
  return `${h}:${m}:${s}`;
}

// ---------- add this function ----------
function updateShotsEmptyMessage() {
  const emptyMsg = document.getElementById('shots-empty');
  if (!emptyMsg || !shotsOnlyGrid) return;
  emptyMsg.style.display = shotsOnlyGrid.children.length === 0 ? 'block' : 'none';
}

// ---------- append screenshot ----------
function appendShot(src, ts) {
  if (!src || typeof src !== 'string' || src.trim() === '') return; // Prevent empty shots
  if (!ts) ts = nowTS();

  const card = document.createElement('div');
  card.className = 'shot';

  const img = document.createElement('img');
  img.src = src;
  img.alt = `Screenshot ${ts}`;

  if (!img.src || img.src.trim() === '') return;

  const badge = document.createElement('div');
  badge.className = 'ts';
  badge.textContent = ts;

  card.appendChild(img);
  card.appendChild(badge);

  if (shotsGrid) {
    shotsGrid.prepend(card);
    while (shotsGrid.children.length > 30) shotsGrid.removeChild(shotsGrid.lastChild);
  }

  if (shotsOnlyGrid) {
    const clone = card.cloneNode(true);
    shotsOnlyGrid.prepend(clone);
    while (shotsOnlyGrid.children.length > 200) shotsOnlyGrid.removeChild(shotsOnlyGrid.lastChild);
  }

  updateShotsEmptyMessage();
}

// ---------- capture desktop ----------
async function captureDesktopPNG() {
  const stream = await navigator.mediaDevices.getDisplayMedia({video:{displaySurface:'monitor'}, audio:false});
  try {
    const track = stream.getVideoTracks()[0];
    const imageCapture = new ImageCapture(track);
    const bitmap = await imageCapture.grabFrame();
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const dataURL = canvas.toDataURL('image/png');
    track.stop();
    return dataURL;
  } finally {
    stream.getTracks().forEach(t => t.stop());
  }
}

// ---------- capture loop ----------
function startCaptureLoop() {
  if (captureInterval) return;
  doOneCapture(); // immediate capture
  captureInterval = setInterval(doOneCapture, 20000); // every 20 seconds
}

function stopCaptureLoop() {
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }
}

// ---------- capture and save ----------
async function doOneCapture() {
  if (!currentUser) return;
  if (isOnManualBreak) {
    appendActivity(`Capture skipped: On manual break`);
    return;
  }
  if (statusIndicatorEl && statusIndicatorEl.style.background === 'orange') {
    appendActivity(`Capture skipped: User idle`);
    return;
  }

  try {
    const dataURL = await captureDesktopPNG();
    if (!dataURL || dataURL.trim() === '') {
      appendActivity(`Capture skipped: empty data`);
      return;
    }

    const res = await window.api.saveScreenshotAndLog({ dataURL });

    if (res.saved && res.path && res.path.trim() !== '') {
      appendShot(res.path, res.ts);
      appendActivity(`Capture saved at ${res.ts}`);
    } else {
      appendActivity(`Capture skipped (${res.reason || 'unknown'})`);
      if(res.reason && (res.reason.includes('Idle') || res.reason.includes('break'))) {
        addNotification({ type: 'warning', message: `Capture skipped: ${res.reason}` });
      }
    }
  } catch(err) {
    appendActivity(`Capture error: ${err.message}`);
    addNotification({ type:'warning', message:`Capture error: ${err.message}` });
  }
}

// ---------- listen to main process screenshot ----------
if(window.api && typeof window.api.onScreenshotCaptured === 'function') {
  window.api.onScreenshotCaptured((filePath) => {
    const ts = nowTS();
    if(filePath && filePath.trim() !== '') {
      appendShot(filePath, ts);
      appendActivity(`Screenshot captured automatically at ${ts}`);
    }
  });
}

// ---------- append activity ----------
function appendActivity(text) {
  const row = document.createElement('div');
  row.className = 'row';
  row.textContent = text;

  if (activityListDashboard) {
    activityListDashboard.prepend(row.cloneNode(true));
    while (activityListDashboard.children.length > 100) activityListDashboard.removeChild(activityListDashboard.lastChild);
  }
  if (activityListOnly) {
    activityListOnly.prepend(row.cloneNode(true));
    while (activityListOnly.children.length > 1000) activityListOnly.removeChild(activityListOnly.lastChild);
  }
}

// ---------- notifications ----------
function addNotification({ type='info', message='' }) {
  const notif = { id: nextNotifId++, type, message, ts: nowTS(), unread: true };
  notifications.unshift(notif);
  renderNotifications();
  updateNotifBadge();
}

function renderNotifications() {
  if (!notifList) return;
  notifList.innerHTML = '';
  if (notifications.length === 0) { if (notifEmpty) notifEmpty.style.display = 'block'; return; }
  if (notifEmpty) notifEmpty.style.display = 'none';

  for (const n of notifications) {
    const item = document.createElement('div');
    item.style.display='flex';
    item.style.justifyContent='space-between';
    item.style.alignItems='flex-start';
    item.style.gap='8px';
    item.style.padding='8px';
    item.style.border='1px solid var(--border)';
    item.style.borderRadius='8px';
    item.style.background = n.unread ? 'linear-gradient(90deg, rgba(245,245,245,0.95), #fff)' : '#fff';

    const left = document.createElement('div');
    left.style.flex='1';
    const title = document.createElement('div');
    title.style.fontSize='13px';
    title.style.fontWeight='700';
    title.textContent = n.type==='warning'?'Warning':(n.type==='break'?'Break':'Info');
    const msg = document.createElement('div');
    msg.style.fontSize='13px';
    msg.style.color='var(--muted)';
    msg.textContent = n.message;
    const ts = document.createElement('div');
    ts.style.fontSize='11px';
    ts.style.color='#9aa3b2';
    ts.style.marginTop='6px';
    ts.textContent = n.ts;
    left.appendChild(title); left.appendChild(msg); left.appendChild(ts);

    const right = document.createElement('div');
    right.style.display='flex';
    right.style.flexDirection='column';
    right.style.alignItems='flex-end';
    right.style.gap='6px';
    const markBtn = document.createElement('button');
    markBtn.className='btn secondary';
    markBtn.style.padding='6px 8px';
    markBtn.style.fontSize='12px';
    markBtn.textContent = n.unread?'Mark':'Read';
    markBtn.addEventListener('click', ev => { ev.stopPropagation(); n.unread=false; renderNotifications(); updateNotifBadge(); });
    right.appendChild(markBtn);

    item.appendChild(left);
    item.appendChild(right);

    item.addEventListener('click', () => {
      if(n.unread){ n.unread=false; renderNotifications(); updateNotifBadge(); }
      appendActivity(`[Notif] ${n.message} (${n.ts})`);
      if(notifDropdown) notifDropdown.classList.add('hidden');
    });

    notifList.appendChild(item);
  }
}

function updateNotifBadge() {
  if (!notifBadge) return;
  const unread = notifications.filter(n=>n.unread).length;
  notifBadge.style.display = unread ? 'inline-block' : 'none';
  if (unread) notifBadge.textContent = unread>99?'99+':String(unread);
}
function clearNotifications(){ notifications=[]; renderNotifications(); updateNotifBadge(); }
function markAllRead(){ notifications.forEach(n=>n.unread=false); renderNotifications(); updateNotifBadge(); }

// ---------- user status ----------
function updateUserStatus({ status, user=null }) {
  if(statusIndicatorEl) {
    if(status==='logged_out') statusIndicatorEl.style.background='red';
    else if(status==='logged_in') statusIndicatorEl.style.background='var(--success)';
    else if(status==='idle') statusIndicatorEl.style.background='orange';
    else statusIndicatorEl.style.background='#cbd5e1';
  }
  if(userTextEl){
    if(status==='logged_out') userTextEl.textContent='User: Not logged in';
    else if((status==='logged_in'||status==='idle') && user) userTextEl.textContent=`User: ${user.full_name} (ID: ${user.id})${status==='idle'?' (Idle)':''}`;
  }
  if(lastActiveEl) lastActiveEl.textContent='';
}

// ---------- refresh user info ----------
async function refreshUserInfoUI() {
  try { 
    const user = await window.api.getUserInfo(); 
    currentUser=user; 
    if(user) updateUserStatus({status:'logged_in',user}); 
    else updateUserStatus({status:'logged_out'}); 
  }
  catch(e){ updateUserStatus({status:'logged_out'}); }
}

// ---------- post-login initialization ----------
async function initializeAfterLogin(user) {
  currentUser = user;
  updateUserStatus({ status: 'logged_in', user: currentUser });
  
  // Update welcome message
  if (userDisplayName && user) {
    userDisplayName.textContent = user.full_name;
  }
  
  enable(logoutBtn, true);
  enable(startBtn, true);
  enable(stopBtn, false);
  enable(startBreakBtn, true);
  enable(stopBreakBtn, false);
  
  workSeconds = 0;
  breakSeconds = 0;
  if (workTimerEl) workTimerEl.textContent = formatHMS(workSeconds);
  if (breakTimerEl) breakTimerEl.textContent = formatHMS(breakSeconds);
  
  appendActivity(`Logged in successfully`);
}

// ---------- logout function ----------
logoutBtn.addEventListener('click', async () => {
  await stopTracking();
  try {
    const res = await window.api.logout();
    if (res.logout_time) appendActivity(`Logged out at ${res.logout_time}`);
    addNotification({ type: 'info', message: `Logged out at ${res.logout_time}` });
    
    // Redirect to login page
    window.location.href = 'login.html';
  } catch (err) {
    console.error('Logout error:', err);
    addNotification({ type: 'warning', message: 'Logout error' });
  }
});

// ---------- tracking ----------
startBtn.addEventListener('click', async ()=>{ await startTracking(); });
stopBtn.addEventListener('click', async ()=>{ await stopTracking(); });

async function startTracking() { 
  enable(startBtn,false); 
  enable(stopBtn,true); 
  startCaptureLoop(); 
  startWorkTimer(); 
  appendActivity('Tracking started'); 
}

async function stopTracking() { 
  enable(startBtn,true); 
  enable(stopBtn,false); 
  stopCaptureLoop(); 
  stopWorkTimer(); 
  stopBreakTimer(); 
  appendActivity('Tracking stopped'); 
}

// ---------- manual break ----------
startBreakBtn.addEventListener('click', async ()=>{
  const res = await window.api.startBreak();
  if(res.started){
    isOnManualBreak=true; enable(startBreakBtn,false); enable(stopBreakBtn,true);
    stopWorkTimer(); startBreakTimer();
    appendActivity(`Manual break started at ${res.ts}`);
    addNotification({type:'break',message:`Manual break started at ${res.ts}`});
  } else if(res.reason){
    appendActivity(`Start break failed: ${res.reason}`);
    addNotification({type:'warning', message:`Start break failed: ${res.reason}`});
  }
});

stopBreakBtn.addEventListener('click', async ()=>{
  const res = await window.api.stopBreak();
  if(res.stopped){
    isOnManualBreak=false; enable(startBreakBtn,true); enable(stopBreakBtn,false);
    stopBreakTimer(); startWorkTimer();
    appendActivity(`Manual break stopped at ${res.ts}`);
    addNotification({type:'break',message:`Manual break stopped at ${res.ts}`});
  } else if(res.reason){
    appendActivity(`Stop break failed: ${res.reason}`);
    addNotification({type:'warning', message:`Stop break failed: ${res.reason}`});
  }
});

// ---------- timers ----------
function startWorkTimer() { 
  if(workTimerInterval) return; 
  workTimerInterval=setInterval(()=>{ 
    workSeconds++; 
    if(workTimerEl) workTimerEl.textContent=formatHMS(workSeconds); 
  },1000); 
  if(workTimerEl) workTimerEl.textContent=formatHMS(workSeconds); 
}

function stopWorkTimer(){ 
  if(workTimerInterval){ 
    clearInterval(workTimerInterval); 
    workTimerInterval=null; 
  } 
}

function startBreakTimer(){ 
  if(breakTimerInterval) return; 
  breakTimerInterval=setInterval(()=>{ 
    breakSeconds++; 
    if(breakTimerEl) breakTimerEl.textContent=formatHMS(breakSeconds); 
  },1000); 
  if(breakTimerEl) breakTimerEl.textContent=formatHMS(breakSeconds); 
}

function stopBreakTimer(){ 
  if(breakTimerInterval){ 
    clearInterval(breakTimerInterval); 
    breakTimerInterval=null; 
  } 
}

// ---------- excel export ----------
async function exportExcel() {
  const result = await window.api.exportActivityExcel();
  if (result.success) { alert(`✅ Excel exported: ${result.filePath}`); }
  else { alert(`❌ Failed: ${result.message}`); }
}

// ---------- idle detection ----------
if(window.api && typeof window.api.onIdleState==='function'){
  window.api.onIdleState((data)=>{
    if(!currentUser) return;
    if(data.state==='idle'){
      if(!isOnManualBreak){ stopWorkTimer(); startBreakTimer(); }
      updateUserStatus({status:'idle', user:currentUser});
      appendActivity(`Idle started at ${data.ts}`);
      addNotification({type:'break',message:`Idle break started at ${data.ts}`});
    } else if(data.state==='active'){
      if(!isOnManualBreak){ stopBreakTimer(); startWorkTimer(); }
      updateUserStatus({status:'logged_in', user:currentUser});
      appendActivity(`Active (returned) at ${data.ts}`);
      addNotification({type:'info', message:`User returned at ${data.ts}`});
    }
  });
}else{
  setInterval(async ()=>{
    if(!currentUser) return;
    try{
      const idleSec = await window.api.getIdleSeconds();
      if(idleSec>=10){
        if(!isOnManualBreak){ stopWorkTimer(); startBreakTimer(); }
        updateUserStatus({status:'idle',user:currentUser});
        appendActivity(`Idle break started (poll) at ${nowTS()}`);
        addNotification({type:'break',message:`Idle break started (poll) at ${nowTS()}`});
      } else {
        if(!isOnManualBreak){ stopBreakTimer(); startWorkTimer(); }
        updateUserStatus({status:'logged_in',user:currentUser});
        appendActivity(`Active detected (poll) at ${nowTS()}`);
        addNotification({type:'info', message:`User returned (poll) at ${nowTS()}`});
      }
    }catch(e){}
  },2000);
}

// ---------- notifications UI ----------
if(notifBtn) notifBtn.addEventListener('click',(e)=>{ if(!notifDropdown) return; notifDropdown.classList.toggle('hidden'); if(!notifDropdown.classList.contains('hidden')) markAllRead(); });
if(notifMarkReadBtn) notifMarkReadBtn.addEventListener('click',(e)=>{ e.stopPropagation(); markAllRead(); });
if(notifClearBtn) notifClearBtn.addEventListener('click',(e)=>{ e.stopPropagation(); clearNotifications(); });

// ---------- init ----------
renderNotifications();
updateNotifBadge();

// Initialize the application - FIXED VERSION
(async function init(){
  enable(startBtn,false); 
  enable(stopBtn,false); 
  enable(logoutBtn,false); 
  enable(startBreakBtn,false); 
  enable(stopBreakBtn,false);
  
  updateUserStatus({status:'logged_out'});
  
  // Check if we're already on the login page
  if (window.location.pathname.endsWith('login.html') || window.location.pathname.endsWith('register.html')) {
    console.log('Already on auth page, skipping redirect');
    return;
  }
  
  // Check if we have a logged in user
  try {
    const user = await window.api.getUserInfo();
    if (user) {
      await initializeAfterLogin(user);
    } else {
      updateUserStatus({ status: 'logged_out' });
      console.log('No user found, redirecting to login');
      // Only redirect if we're not already on an auth page
      if (!window.location.pathname.endsWith('login.html') && !window.location.pathname.endsWith('register.html')) {
        window.location.href = 'login.html';
      }
    }
  } catch (e) {
    console.error('Error checking user status:', e);
    updateUserStatus({ status: 'logged_out' });
    // Only redirect if we're not already on an auth page
    if (!window.location.pathname.endsWith('login.html') && !window.location.pathname.endsWith('register.html')) {
      window.location.href = 'login.html';
    }
  }
})();
// ================================================================
// מעקב נוכחות מרכבה - app.js - גרסה 3.0
// ================================================================

const EMP_TYPES = {
  regular:    { label:'עובד רגיל',          daily:8.0,      icon:'👔', isParent:false },
  parent_u1:  { label:'הורה - ילד עד שנה',  daily:7.5,      icon:'👶', isParent:true  },
  parent_112: { label:'הורה - ילד 1-12',    daily:7+35/60,  icon:'🧒', isParent:true  }
};
const COMP_MAX  = 8;
const HE_DAYS   = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

let S = {
  records:   [],
  employee:  { name:'', id:'', type:'regular', otQuota:15 },
  settings:  { autoSync:true, requireDesc:true, alertOt:true, alertComp:true, serverUrl:'http://localhost:3000' },
  histMonth: new Date()
};
let homeBlockList = [];

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  setDefaults();
  applySettingsUI();
  renderDashboard();
  renderHistoryMonth();
  window.addEventListener('message', onExtMsg);
  if (S.settings.autoSync) syncFromMerkava();
});

// -- Storage --
function loadState() {
  try {
    const r = localStorage.getItem('mv_records');
    const e = localStorage.getItem('mv_emp');
    const s = localStorage.getItem('mv_set');
    if (r) S.records  = JSON.parse(r);
    if (e) S.employee = JSON.parse(e);
    if (s) S.settings = { ...S.settings, ...JSON.parse(s) };
  } catch(ex) { console.warn('loadState:', ex); }
}
function persist() {
  localStorage.setItem('mv_records', JSON.stringify(S.records));
  localStorage.setItem('mv_emp',     JSON.stringify(S.employee));
  localStorage.setItem('mv_set',     JSON.stringify(S.settings));
}

// -- Time helpers --
const parseT  = s => { if (!s) return null; const [h,m]=s.split(':').map(Number); return h+m/60; };
const fmtH    = h => { if (h===null||isNaN(h)) return '--:--'; const neg=h<0; h=Math.abs(h); return (neg?'-':'')+Math.floor(h)+':'+String(Math.round((h-Math.floor(h))*60)).padStart(2,'0'); };
const todayStr  = () => new Date().toISOString().slice(0,10);
const monthKey  = d  => new Date(d).toISOString().slice(0,7);
const heDay     = d  => HE_DAYS[new Date(d).getDay()];
const heDateFmt = d  => { const dt=new Date(d); return dt.getDate()+'/'+(dt.getMonth()+1)+' ('+heDay(d)+')'; };

// -- Tabs --
function showTab(name) {
  document.querySelectorAll('section[id^="tab-"]').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-'+name).classList.remove('hidden');
  const idx = { dashboard:0, entry:1, history:2, settings:3 };
  document.querySelectorAll('.tab')[idx[name]]?.classList.add('active');
  if (name==='history')   renderHistoryMonth();
  if (name==='dashboard') renderDashboard();
}

// -- Form --
function setDefaults() {
  const d = document.getElementById('e-date');
  if (d) d.value = todayStr();
  homeBlockList = [];
  renderHomeBlocks();
}

function onDayTypeChange() {
  const v = document.getElementById('e-daytype').value;
  document.getElementById('f-regular').classList.toggle('hidden',  v!=='regular');
  document.getElementById('f-fullhome').classList.toggle('hidden', v!=='fullhome');
  document.getElementById('f-absence').classList.toggle('hidden',  v!=='absence');
  document.getElementById('f-home-extra').classList.toggle('hidden', v==='absence'||v==='fullhome');
  liveCalc();
}

// -- Home blocks --
function addHomeBlock() {
  homeBlockList.push({ id:Date.now(), btype:'completion', start:'', end:'', desc:'' });
  renderHomeBlocks();
}
function removeHomeBlock(id) {
  homeBlockList = homeBlockList.filter(b => b.id!==id);
  renderHomeBlocks();
  liveCalc();
}
function updateBlock(id, key, val) {
  const b = homeBlockList.find(b => b.id===id);
  if (b) b[key] = val;
  liveCalc();
}
function renderHomeBlocks() {
  const wrap = document.getElementById('home-blocks');
  if (!wrap) return;
  wrap.innerHTML = '';
  const labels = { completion:'השלמת תקן (יציאה מוקדמת)', overtime:'שעות נוספות מהבית', fullday:'יום עבודה מהבית' };
  const classes = { completion:'hb-comp', overtime:'hb-ot', fullday:'hb-full' };
  homeBlockList.forEach(b => {
    const div = document.createElement('div');
    div.className = 'home-block';
    div.innerHTML = `
      <button class="rm-btn" onclick="removeHomeBlock(${b.id})" title="הסר">✕</button>
      <div class="form-row" style="margin-bottom:8px">
        <div class="fg">
          <label>סוג עבודה מהבית</label>
          <select onchange="updateBlock(${b.id},'btype',this.value);renderHomeBlocks()">
            <option value="completion" ${b.btype==='completion'?'selected':''}>השלמת תקן (יציאה מוקדמת)</option>
            <option value="overtime"   ${b.btype==='overtime'  ?'selected':''}>שעות נוספות מהבית</option>
            <option value="fullday"    ${b.btype==='fullday'   ?'selected':''}>יום עבודה מהבית</option>
          </select>
        </div>
        <div class="fg">
          <label>תיאור העבודה (חובה)</label>
          <input type="text" value="${b.desc||''}" placeholder="מה עשיתי: טלפונים, דוחות, תיקים..."
            oninput="updateBlock(${b.id},'desc',this.value)" style="direction:rtl;text-align:right">
        </div>
      </div>
      <div class="form-row">
        <div class="fg"><label>שעת התחלה</label><input type="time" value="${b.start||''}" onchange="updateBlock(${b.id},'start',this.value);liveCalc()"></div>
        <div class="fg"><label>שעת סיום</label><input type="time" value="${b.end||''}" onchange="updateBlock(${b.id},'end',this.value);liveCalc()"></div>
      </div>
    `;
    wrap.appendChild(div);
  });
}

// -- Calculation --
function calcDay(rec) {
  const type     = S.employee.type || 'regular';
  const target   = EMP_TYPES[type].daily;
  const isParent = EMP_TYPES[type].isParent;
  let officeH = 0, compH = 0, homeOtH = 0, extraH = 0;
  if (rec.type==='regular' && rec.checkin && rec.checkout)
    officeH = parseT(rec.checkout) - parseT(rec.checkin);
  else if (rec.type==='fullhome' && rec.fhStart && rec.fhEnd)
    officeH = parseT(rec.fhEnd) - parseT(rec.fhStart);
  (rec.homeBlocks||[]).forEach(b => {
    const bh = (b.end&&b.start) ? parseT(b.end)-parseT(b.start) : 0;
    if (b.btype==='completion') compH += bh;
    else if (b.btype==='overtime') homeOtH += bh;
    else extraH += bh;
  });
  const totalH = officeH + compH + homeOtH + extraH;
  let ot = 0;
  if (totalH > 8) { ot = totalH - 8; if (isParent) homeOtH = Math.min(homeOtH, ot/2); }
  return { officeH, homeH: compH+homeOtH+extraH, compH, homeOtH, totalH, ot:Math.max(0,ot), target, isParent };
}

function calcMonth(mk) {
  const recs = S.records.filter(r => monthKey(r.date)===mk);
  let tot=0,ot=0,hot=0,comp=0;
  recs.forEach(r => { const c=calcDay(r); tot+=c.totalH; ot+=c.ot; hot+=c.homeOtH; comp+=c.compH; });
  return { tot, ot, hot, comp, otQuota:S.employee.otQuota||15, compMax:COMP_MAX, recs };
}

// -- Live Calc --
function liveCalc() {
  const v    = document.getElementById('e-daytype')?.value || 'regular';
  const date = document.getElementById('e-date')?.value || todayStr();
  const rec  = buildEntryRecord(date, v, false);
  const c    = calcDay(rec);
  const box  = document.getElementById('calc-result');
  if (!box) return;
  box.classList.remove('hidden');
  const set = (id,val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  set('cr-office', fmtH(c.officeH));
  set('cr-home',   fmtH(c.homeH));
  set('cr-total',  fmtH(c.totalH));
  set('cr-ot',     fmtH(c.ot));
  set('cr-hot',    fmtH(c.homeOtH));
  set('cr-comp',   fmtH(c.compH));
  const alerts = [];
  const mk = monthKey(date);
  const ms = calcMonth(mk);
  if (c.ot > 0 && ms.ot + c.ot > ms.otQuota)
    alerts.push('<div class="alert danger">⚠️ חריגה ממכסת שעות נוספות!</div>');
  if (c.compH > 0 && ms.comp + c.compH > COMP_MAX)
    alerts.push('<div class="alert danger">⚠️ חריגה ממכסת השלמת תקן!</div>');
  const alertsEl = document.getElementById('cr-alerts');
  if (alertsEl) alertsEl.innerHTML = alerts.join('');
}

function buildEntryRecord(date, v, withBlocks=true) {
  return {
    date,
    type: v,
    checkin:  v==='regular' ? document.getElementById('e-in')?.value   : '',
    checkout: v==='regular' ? document.getElementById('e-out')?.value  : '',
    fhStart:  v==='fullhome'? document.getElementById('e-fh-s')?.value : '',
    fhEnd:    v==='fullhome'? document.getElementById('e-fh-e')?.value : '',
    fhDesc:   v==='fullhome'? document.getElementById('e-fh-desc')?.value : '',
    absType:  v==='absence' ? document.getElementById('e-abs-type')?.value : '',
    homeBlocks: withBlocks ? JSON.parse(JSON.stringify(homeBlockList)) : []
  };
}

// -- Save --
function saveEntry() {
  const date = document.getElementById('e-date')?.value;
  const v    = document.getElementById('e-daytype')?.value || 'regular';
  if (!date) { toast('נא לבחור תאריך','err'); return; }
  if (v==='fullhome') {
    const desc = document.getElementById('e-fh-desc')?.value.trim();
    if (!desc && S.settings.requireDesc) { toast('נא למלא תיאור עבודה מהבית','err'); return; }
  }
  homeBlockList.forEach(b => {
    if (!b.desc.trim() && S.settings.requireDesc) { toast('נא למלא תיאור לכל בלוק עבודה מהבית','err'); return; }
  });
  const rec = buildEntryRecord(date, v, true);
  rec.status = 'saved';
  const idx = S.records.findIndex(r => r.date===date);
  if (idx>=0) S.records[idx] = rec; else S.records.push(rec);
  S.records.sort((a,b) => a.date.localeCompare(b.date));
  persist();
  toast('הרשומה נשמרה בהצלחה','ok');
  renderDashboard();
  syncToServer();
}

function saveAndSend() {
  saveEntry();
  const date = document.getElementById('e-date')?.value;
  const rec  = S.records.find(r => r.date===date);
  if (rec) sendRecordToMerkava(rec);
}

// -- Dashboard --
function renderDashboard() {
  const emp = S.employee;
  const et  = EMP_TYPES[emp.type||'regular'];
  set('dash-name', emp.name||'לא מוגדר');
  set('dash-id',   'מספר עובד: '+(emp.id||'---'));
  set('dash-type', et.icon+' '+et.label);

  const now = new Date();
  const mk  = monthKey(now.toISOString().slice(0,10));
  const ms  = calcMonth(mk);
  const workDays = S.records.filter(r=>monthKey(r.date)===mk&&r.type!=='absence').length;
  const targetTotal = workDays * (et.daily||8);

  setQ('q-total',  ms.tot, targetTotal, ms.tot/Math.max(targetTotal,1)*100, 'מתוך '+fmtH(targetTotal));
  setQ('q-ot',     ms.ot,  ms.otQuota,  ms.ot/ms.otQuota*100,              'מכסה: '+fmtH(ms.otQuota));
  setQ('q-hot',    ms.hot, ms.otQuota/2,ms.hot/(ms.otQuota/2)*100,         'מכסה: '+fmtH(ms.otQuota/2));
  setQ('q-comp',   ms.comp,COMP_MAX,    ms.comp/COMP_MAX*100,              'מתוך 8:00 שעות');

  // הסתר השלמת תקן לעובד רגיל
  const compWrap = document.getElementById('q-comp-wrap');
  if (compWrap) compWrap.style.display = et.isParent ? '' : 'none';

  renderAlerts(ms, et);
  renderWeekTable();
}

function setQ(id, val, max, pct, sub) {
  set(id, fmtH(val));
  set(id+'-s', sub||'');
  const bar = document.getElementById(id+'-b');
  if (bar) bar.style.width = Math.min(100, pct||0)+'%';
}

function set(id, txt) { const el=document.getElementById(id); if(el) el.textContent=txt; }

function renderAlerts(ms, et) {
  const box = document.getElementById('alerts-box');
  if (!box) return;
  const alerts = [];
  if (S.settings.alertOt && ms.ot >= ms.otQuota*0.8)
    alerts.push('<div class="alert warn">⚠️ ניצלת '+(Math.round(ms.ot/ms.otQuota*100))+'% ממכסת שעות נוספות ('+fmtH(ms.ot)+' מתוך '+fmtH(ms.otQuota)+')</div>');
  if (et.isParent && S.settings.alertComp && ms.comp >= COMP_MAX*0.8)
    alerts.push('<div class="alert warn">⚠️ ניצלת '+(Math.round(ms.comp/COMP_MAX*100))+'% מהשלמת תקן ('+fmtH(ms.comp)+' מתוך '+fmtH(COMP_MAX)+')</div>');
  if (ms.ot >= ms.otQuota)
    alerts.push('<div class="alert danger">🔴 הגעת למכסת שעות נוספות! עבודה נוספת לא תשולם.</div>');
  if (et.isParent && ms.comp >= COMP_MAX)
    alerts.push('<div class="alert danger">🔴 מכסת השלמת תקן מוצתה לחודש זה!</div>');
  if (alerts.length===0)
    alerts.push('<div class="alert ok">✅ הכל תקין החודש</div>');
  box.innerHTML = alerts.join('');
}

function renderWeekTable() {
  const tbody = document.getElementById('week-body');
  if (!tbody) return;
  const today = new Date();
  const dow   = today.getDay();
  const sun   = new Date(today); sun.setDate(today.getDate()-dow);
  const rows  = [];
  for (let i=0; i<6; i++) {
    const d   = new Date(sun); d.setDate(sun.getDate()+i);
    const dk  = d.toISOString().slice(0,10);
    const rec = S.records.find(r=>r.date===dk);
    const c   = rec ? calcDay(rec) : null;
    const isToday = dk===todayStr();
    rows.push(`<tr ${isToday?'style="background:#fffde7"':''}>
      <td>${heDateFmt(dk)}</td>
      <td>${rec?.checkin||rec?.fhStart||'-'}</td>
      <td>${rec?.checkout||rec?.fhEnd||'-'}</td>
      <td>${c ? fmtH(c.homeH) : '-'}</td>
      <td style="font-size:.8rem;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${getHomeDesc(rec)}
      </td>
      <td>${c ? fmtH(c.totalH) : '-'}</td>
      <td>${c && c.ot>0 ? '<span class="badge bg-o">'+fmtH(c.ot)+'</span>' : '-'}</td>
      <td>${getStatusBadge(rec)}</td>
    </tr>`);
  }
  tbody.innerHTML = rows.join('');
}

function getHomeDesc(rec) {
  if (!rec) return '-';
  if (rec.type==='fullhome') return rec.fhDesc||'-';
  const descs = (rec.homeBlocks||[]).map(b=>b.desc).filter(Boolean);
  return descs.join(', ') || '-';
}

function getStatusBadge(rec) {
  if (!rec) return '<span class="badge bg-gray">ריק</span>';
  if (rec.status==='sent') return '<span class="badge bg-g">נשלח</span>';
  if (rec.type==='absence') return '<span class="badge bg-b">היעדרות</span>';
  return '<span class="badge bg-o">שמור</span>';
}

// -- History --
function renderHistoryMonth() {
  const mk   = S.histMonth.toISOString().slice(0,7);
  const y    = S.histMonth.getFullYear();
  const m    = S.histMonth.getMonth();
  set('hist-month', HE_MONTHS[m]+' '+y);
  const recs = S.records.filter(r=>monthKey(r.date)===mk).sort((a,b)=>b.date.localeCompare(a.date));
  const tbody = document.getElementById('hist-body');
  if (!tbody) return;
  if (recs.length===0) { tbody.innerHTML='<tr><td colspan="10" class="muted" style="padding:20px">אין רשומות לחודש זה</td></tr>'; return; }
  tbody.innerHTML = recs.map(rec => {
    const c = calcDay(rec);
    return `<tr>
      <td>${heDateFmt(rec.date)}</td>
      <td>${rec.checkin||rec.fhStart||'-'}</td>
      <td>${rec.checkout||rec.fhEnd||'-'}</td>
      <td>${fmtH(c.homeH)}</td>
      <td style="font-size:.8rem;max-width:140px">${getHomeDesc(rec)}</td>
      <td>${fmtH(c.totalH)}</td>
      <td>${c.ot>0?'<span class="badge bg-o">'+fmtH(c.ot)+'</span>':'-'}</td>
      <td>${rec.type==='fullhome'?'<span class="badge bg-b">מהבית</span>':rec.type==='absence'?'<span class="badge bg-p">היעדרות</span>':'<span class="badge bg-g">משרד</span>'}</td>
      <td>${getStatusBadge(rec)}</td>
      <td><button class="btn btn-outline" style="padding:3px 8px;font-size:.75rem" onclick="editRecord('${rec.date}')">✏️</button>
          <button class="btn btn-warning"  style="padding:3px 8px;font-size:.75rem" onclick="sendRecordToMerkava(S.records.find(r=>r.date==='${rec.date}'))">📤</button></td>
    </tr>`;
  }).join('');

  const ms = calcMonth(mk);
  set('hist-summary', 'סה"כ: '+fmtH(ms.tot)+' | נוספות: '+fmtH(ms.ot)+' | מהבית: '+fmtH(ms.hot)+' | השלמת תקן: '+fmtH(ms.comp));
}

function changeMonth(dir) {
  S.histMonth = new Date(S.histMonth.getFullYear(), S.histMonth.getMonth()+dir, 1);
  renderHistoryMonth();
}

function editRecord(date) {
  const rec = S.records.find(r=>r.date===date);
  if (!rec) return;
  showTab('entry');
  const setV = (id,v) => { const el=document.getElementById(id); if(el) el.value=v||''; };
  setV('e-date', rec.date);
  setV('e-daytype', rec.type||'regular');
  setV('e-in',  rec.checkin||'');
  setV('e-out', rec.checkout||'');
  setV('e-fh-s', rec.fhStart||'');
  setV('e-fh-e', rec.fhEnd||'');
  setV('e-fh-desc', rec.fhDesc||'');
  homeBlockList = JSON.parse(JSON.stringify(rec.homeBlocks||[]));
  onDayTypeChange();
  renderHomeBlocks();
  liveCalc();
}

// -- Settings --
function applySettingsUI() {
  const emp = S.employee;
  const set = S.settings;
  const sv = (id,v) => { const el=document.getElementById(id); if(el) el.value=v||''; };
  const sc = (id,v) => { const el=document.getElementById(id); if(el) el.checked=!!v; };
  sv('s-name', emp.name); sv('s-id', emp.id); sv('s-type', emp.type||'regular');
  sv('s-ot', emp.otQuota||15); sv('s-server', set.serverUrl||'http://localhost:3000');
  sc('s-auto-sync', set.autoSync); sc('s-req-desc', set.requireDesc);
  sc('s-alert-ot', set.alertOt); sc('s-alert-comp', set.alertComp);
  onEmpTypeChange();
}

function onEmpTypeChange() {
  const v = document.getElementById('s-type')?.value;
  const note = document.getElementById('parent-note');
  if (note) note.classList.toggle('hidden', !EMP_TYPES[v]?.isParent);
}

function saveSettings() {
  const gv = id => document.getElementById(id)?.value;
  const gc = id => document.getElementById(id)?.checked;
  S.employee.name     = gv('s-name')||'';
  S.employee.id       = gv('s-id')||'';
  S.employee.type     = gv('s-type')||'regular';
  S.employee.otQuota  = parseFloat(gv('s-ot'))||15;
  S.settings.serverUrl    = gv('s-server')||'http://localhost:3000';
  S.settings.autoSync     = gc('s-auto-sync');
  S.settings.requireDesc  = gc('s-req-desc');
  S.settings.alertOt      = gc('s-alert-ot');
  S.settings.alertComp    = gc('s-alert-comp');
  persist();
  toast('ההגדרות נשמרו','ok');
  renderDashboard();
}

// -- Export / Import --
function exportCSV() {
  const mk   = S.histMonth.toISOString().slice(0,7);
  const recs = S.records.filter(r=>monthKey(r.date)===mk);
  const rows = [['תאריך','כניסה','יציאה','שעות_מהבית','תיאור_מהבית','סהכ_שעות','שעות_נוספות','סוג','סטטוס']];
  recs.forEach(r => {
    const c = calcDay(r);
    rows.push([r.date, r.checkin||r.fhStart||'', r.checkout||r.fhEnd||'', fmtH(c.homeH), getHomeDesc(r), fmtH(c.totalH), fmtH(c.ot), r.type, r.status||'']);
  });
  const csv = rows.map(r=>r.join(',')).join('\n');
  download('nocheut_'+mk+'.csv', csv, 'text/csv;charset=utf-8;');
}

function exportJSON() {
  download('merkava_backup_'+todayStr()+'.json', JSON.stringify({records:S.records,employee:S.employee,settings:S.settings},null,2), 'application/json');
}

function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.records)  S.records  = data.records;
      if (data.employee) S.employee = data.employee;
      if (data.settings) S.settings = { ...S.settings, ...data.settings };
      persist(); applySettingsUI(); renderDashboard(); renderHistoryMonth();
      toast('הנתונים יובאו בהצלחה','ok');
    } catch(err) { toast('שגיאה בייבוא הקובץ','err'); }
  };
  reader.readAsText(file);
}

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content],{type}));
  a.download = name; a.click();
}

// -- Merkava Sync (via Chrome Extension) --
function syncFromMerkava() {
  toast('מסנכרן ממרכבה...','');
  window.postMessage({ type:'MERKAVA_SYNC_REQUEST', action:'pull' }, '*');
  setTimeout(() => { try { syncFromServer(); } catch(e){} }, 500);
}

function sendRecordToMerkava(rec) {
  if (!rec) return;
  window.postMessage({ type:'MERKAVA_SEND_REQUEST', record:rec }, '*');
  toast('שולח למרכבה: '+rec.date,'');
}

function bulkSend() {
  const from = document.getElementById('bulk-from')?.value;
  const to   = document.getElementById('bulk-to')?.value;
  let recs   = S.records.filter(r => r.status!=='sent');
  if (from) recs = recs.filter(r => r.date>=from);
  if (to)   recs = recs.filter(r => r.date<=to);
  if (recs.length===0) { toast('אין רשומות לשליחה','wrn'); return; }
  recs.forEach((r,i) => setTimeout(() => sendRecordToMerkava(r), i*800));
  toast('שולח '+recs.length+' רשומות...','');
}

function onExtMsg(event) {
  if (!event.data || !event.data.type) return;
  if (event.data.type==='MERKAVA_DATA') {
    const data = event.data.data;
    if (data?.employee) {
      S.employee.name    = data.employee.name    || S.employee.name;
      S.employee.id      = data.employee.id      || S.employee.id;
      S.employee.otQuota = data.employee.otQuota || S.employee.otQuota;
      if (data.employee.type) S.employee.type = data.employee.type;
    }
    if (data?.records?.length) {
      data.records.forEach(r => {
        const idx = S.records.findIndex(x=>x.date===r.date);
        if (idx>=0) { S.records[idx]={...S.records[idx],...r}; } else { S.records.push(r); }
      });
      S.records.sort((a,b)=>a.date.localeCompare(b.date));
    }
    persist(); applySettingsUI(); renderDashboard(); renderHistoryMonth();
    toast('הנתונים עודכנו ממרכבה','ok');
  }
  if (event.data.type==='MERKAVA_SENT') {
    const date = event.data.date;
    const rec  = S.records.find(r=>r.date===date);
    if (rec) { rec.status='sent'; persist(); }
    toast('נשלח בהצלחה: '+date,'ok');
    renderDashboard(); renderHistoryMonth();
  }
}

// -- Server Sync --
async function syncToServer() {
  const url = S.settings.serverUrl;
  if (!url) return;
  try {
    await fetch(url+'/sync', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ records:S.records, employee:S.employee, ts:Date.now() })
    });
  } catch(e) { console.log('Server sync skipped:', e.message); }
}

async function syncFromServer() {
  const url = S.settings.serverUrl;
  if (!url) return;
  try {
    const res  = await fetch(url+'/data');
    const data = await res.json();
    if (data?.records?.length) {
      data.records.forEach(r => {
        const idx = S.records.findIndex(x=>x.date===r.date);
        if (idx>=0) { if (!S.records[idx].status || S.records[idx].status!=='sent') S.records[idx]={...S.records[idx],...r}; }
        else S.records.push(r);
      });
      S.records.sort((a,b)=>a.date.localeCompare(b.date));
      persist(); renderDashboard(); renderHistoryMonth();
    }
  } catch(e) { console.log('Server pull skipped:', e.message); }
}

// -- Toast --
function toast(msg, type='') {
  const c = document.getElementById('toasts');
  if (!c) return;
  const div = document.createElement('div');
  div.className = 'toast '+(type||'');
  div.textContent = msg;
  c.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

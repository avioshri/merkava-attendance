// ================================================================
// content.js - תוסף Chrome למרכבה
// רץ בתוך דף מרכבה ומאפשר סנכרון דו-כיווני
// ================================================================

const APP_ORIGIN = '*'; // ניתן להגביל לכתובת האפליקציה שלך

// האזן להודעות מהאפליקציה
window.addEventListener('message', async (event) => {
  if (!event.data || !event.data.type) return;

  if (event.data.type === 'MERKAVA_SYNC_REQUEST') {
    if (event.data.action === 'pull') {
      await pullFromMerkava();
    }
  }

  if (event.data.type === 'MERKAVA_SEND_REQUEST') {
    const rec = event.data.record;
    if (rec) await sendToMerkava(rec);
  }
});

// -- משוך נתונים ממרכבה --
async function pullFromMerkava() {
  try {
    const data = await extractMerkavaData();
    window.postMessage({ type: 'MERKAVA_DATA', data }, '*');
  } catch(e) {
    console.error('Merkava pull error:', e);
  }
}

// -- חלץ נתונים מהדף --
async function extractMerkavaData() {
  const result = { employee: {}, records: [] };

  // שם עובד ממספר עובד מהכותרת
  const empNameEl = document.querySelector('[id*="emp"], .emp-name, [class*="employee"]');
  if (empNameEl) result.employee.name = empNameEl.textContent.trim();

  // מספר עובד
  const empText = document.body.innerText;
  const empMatch = empText.match(/עבור עובד.*?(\d{5,})/);
  if (empMatch) result.employee.id = empMatch[1];

  // מכסת שעות נוספות - מחפש בטקסט הדף
  const otMatch = empText.match(/מכסה[^\d]*(\d+\.?\d*)/);
  if (otMatch) result.employee.otQuota = parseFloat(otMatch[1]);

  // ניסיון לקרוא שורות מהטבלה
  const rows = document.querySelectorAll('tr, [role="row"]');
  rows.forEach(row => {
    const cells = row.querySelectorAll('td, [role="cell"]');
    if (cells.length < 3) return;
    const texts = Array.from(cells).map(c => c.textContent.trim());
    // חפש תאריך בפורמט dd.mm.yyyy
    const dateMatch = texts.join(' ').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (dateMatch) {
      const d   = dateMatch[1].padStart(2,'0');
      const m   = dateMatch[2].padStart(2,'0');
      const y   = dateMatch[3];
      const iso = `${y}-${m}-${d}`;
      // חפש שעות כניסה ויציאה HH:MM
      const times = texts.join(' ').match(/(\d{2}):(\d{2})/g) || [];
      if (times.length >= 2) {
        result.records.push({
          date:     iso,
          checkin:  times[0],
          checkout: times[1],
          type:     'regular',
          status:   'synced'
        });
      }
    }
  });

  return result;
}

// -- שלח רשומה למרכבה --
async function sendToMerkava(rec) {
  try {
    // חפש שורה ריקה בטבלה לעריכה
    const date = rec.date;
    const [y,m,d] = date.split('-');
    const heDate = d+'.'+m+'.'+y;

    console.log('Merkava Sync: Sending record for', heDate);

    // חפש כפתור עריכה בשורת התאריך הרלוונטי
    const allRows = document.querySelectorAll('tr, [role="row"]');
    let targetRow = null;
    allRows.forEach(row => {
      if (row.textContent.includes(d+'.'+m) || row.textContent.includes(heDate)) {
        targetRow = row;
      }
    });

    if (targetRow) {
      // לחץ על כפתור עריכה
      const editBtn = targetRow.querySelector('button, [title*="עריכה"], [title*="edit"], img[src*="pencil"]');
      if (editBtn) {
        editBtn.click();
        await sleep(1500);
        await fillForm(rec);
      }
    } else {
      console.log('Row not found for date', heDate, '- navigate to correct month first');
    }

    // דווח על הצלחה
    window.postMessage({ type: 'MERKAVA_SENT', date: rec.date }, '*');

  } catch(e) {
    console.error('Merkava send error:', e);
  }
}

// -- מלא את הטופס --
async function fillForm(rec) {
  const inputs = document.querySelectorAll('input[type="text"], input[type="time"]');

  for (const input of inputs) {
    const label = input.closest('td,div')?.textContent?.toLowerCase() || '';
    if (label.includes('כניסה') || label.includes('arrival')) {
      setInputValue(input, rec.checkin || '');
      await sleep(300);
    }
    if (label.includes('יציאה') || label.includes('departure')) {
      setInputValue(input, rec.checkout || '');
      await sleep(300);
    }
    if (label.includes('הערה') || label.includes('remarks') || label.includes('notes')) {
      const desc = getDesc(rec);
      setInputValue(input, desc);
      await sleep(300);
    }
  }

  // חפש כפתור שמירה
  await sleep(500);
  const saveBtn = document.querySelector('button[title*="שמור"], button[title*="save"], input[type="submit"]');
  if (saveBtn) { saveBtn.click(); await sleep(1000); }
}

function getDesc(rec) {
  if (rec.type === 'fullhome') return rec.fhDesc || '';
  return (rec.homeBlocks || []).map(b => b.desc).filter(Boolean).join(', ');
}

function setInputValue(input, value) {
  const niv = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  niv.call(input, value);
  input.dispatchEvent(new Event('input',  { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('Merkava Attendance Sync extension loaded');

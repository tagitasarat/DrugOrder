/**
 * พระจันทร์เภสัช – ระบบสั่งยา : Google Apps Script backend
 * ────────────────────────────────────────────────────────────
 * โค้ดนี้ไม่ได้รันจาก repo — ต้อง copy ไปวางใน Apps Script ที่ผูกกับ
 * Google Sheet (เปิดชีต → Extensions → Apps Script) แล้วกด Save
 * เก็บสำเนาไว้ที่นี่เพื่อเป็นต้นฉบับและดูประวัติการแก้
 *
 * ปรับปรุงจากเวอร์ชันเดิม (พฤติกรรมกับแอปเหมือนเดิมทุกอย่าง):
 *  1. findRow อ่านเฉพาะคอลัมน์ row_id  (เดิมอ่านทั้งชีตทุกครั้งที่กดปุ่ม)
 *  2. เปิดไฟล์ชีตครั้งเดียวต่อการเรียก 1 ครั้ง (เดิมเปิดใหม่ทุกครั้ง)
 *  3. load/loadRecent อ่านเฉพาะช่วงแถวที่มีข้อมูลจริง
 *  4. ระบบ Archive: ย้ายแถว "รับแล้ว" เก่าไปแท็บ Archive → ชีตหลักเล็กและเร็วตลอด
 *
 * ▶ ล้างข้อมูลเก่าครั้งแรก : เลือกฟังก์ชัน cleanupNow           แล้วกด Run
 * ▶ ตั้งให้ล้างเองทุกเดือน : เลือกฟังก์ชัน setupMonthlyArchive  แล้วกด Run (ครั้งเดียว)
 * ไม่ต้อง Deploy ใหม่ — URL เดิมใช้ได้เลย
 */

const SHEET_ID = '1EiNGwh1jh65OP2AV5XlgUYGMWi05sWtFuFSxg8tgBck';
const HEADERS = ['row_id','วันที่สั่ง','สาขา','บริษัท','รหัสยา','ชื่อยา','หน่วย','หมายเหตุ','จำนวน','สถานะ','วันที่สั่งแล้ว','วันที่รับของ'];
// สถานะ: รอสั่ง / รอของ / รับแล้ว

// เก็บ "รับแล้ว" ไว้ในชีตหลักกี่วัน (เก่ากว่านี้ย้ายไป Archive)
const KEEP_RECEIVED_DAYS = 21;

// ── cache: เปิดไฟล์ชีตครั้งเดียวต่อ 1 request ──
let _SS = null;
function ss_() {
  if (!_SS) _SS = SpreadsheetApp.openById(SHEET_ID);
  return _SS;
}

function getOrCreateSheet(branch) {
  const ss = ss_();
  let sheet = ss.getSheetByName(branch);
  if (!sheet) {
    sheet = ss.insertSheet(branch);
    sheet.appendRow(HEADERS);
    sheet.getRange(1,1,1,HEADERS.length).setFontWeight('bold').setBackground('#1a56a0').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1,160);sheet.setColumnWidth(6,260);
    sheet.setColumnWidth(9,70);sheet.setColumnWidth(10,80);
  }
  return sheet;
}

function getColMap(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => { map[String(h).trim()] = i; });
  return map;
}

// Ensure all status/date columns exist
function ensureCols(sheet) {
  const cm = getColMap(sheet);
  let lastCol = sheet.getLastColumn();
  const need = ['สถานะ','วันที่สั่งแล้ว','วันที่รับของ'];
  need.forEach(name=>{
    if(cm[name]===undefined){
      lastCol++;
      sheet.getRange(1,lastCol).setValue(name).setFontWeight('bold').setBackground('#1a56a0').setFontColor('#ffffff');
      cm[name]=lastCol-1;
    }
  });
  return cm;
}

// เร็วขึ้นมาก: อ่านเฉพาะคอลัมน์ A (row_id) ไม่ต้องดึงทั้งตาราง
function findRow(sheet, rowId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const target = String(rowId);
  for (let i = 0; i < ids.length; i++)
    if (String(ids[i][0]) === target) return i + 2;
  return -1;
}

function toDate(raw){
  if(!raw) return null;
  try{
    let d;
    if(raw instanceof Date){
      d = new Date(raw.getTime());
      if(d.getFullYear() > 2500) d.setFullYear(d.getFullYear()-543);
    } else {
      const parts = String(raw).split(/[/\s:]/);
      let yr = parseInt(parts[2]);
      if(yr > 2500) yr -= 543;
      d = new Date(yr, parseInt(parts[1])-1, parseInt(parts[0]));
    }
    return d;
  }catch(e){ return null; }
}

function nowStr_(){
  return Utilities.formatDate(new Date(),'Asia/Bangkok','dd/MM/yyyy HH:mm');
}

function handleRequest(data) {
  const action = data.action;

  if (action === 'add') {
    const sheet = getOrCreateSheet(data.branch);
    const cm = ensureCols(sheet);
    const row = new Array(sheet.getLastColumn()).fill('');
    row[cm['row_id']] = data.rowId;
    row[cm['วันที่สั่ง']] = data.orderDate;
    row[cm['สาขา']] = data.branch;
    row[cm['บริษัท']] = data.supplier;
    row[cm['รหัสยา']] = data.code || '-';
    row[cm['ชื่อยา']] = data.name;
    row[cm['หน่วย']] = data.unit;
    row[cm['หมายเหตุ']] = data.note || '';
    row[cm['สถานะ']] = 'รอสั่ง';
    sheet.appendRow(row);
    const lr = sheet.getLastRow();
    sheet.getRange(lr, cm['สถานะ']+1).setBackground('#e6f7eb').setFontColor('#2d9b4e').setFontWeight('bold');
    return {success:true, added:1};
  }

  if (action === 'delete') {
    const sheet = getOrCreateSheet(data.branch);
    const row = findRow(sheet, data.rowId);
    if (row > 0) { sheet.deleteRow(row); return {success:true, deleted:1}; }
    return {success:true, deleted:0};
  }

  if (action === 'qty') {
    const sheet = getOrCreateSheet(data.branch);
    const cm = getColMap(sheet);
    const row = findRow(sheet, data.rowId);
    if (row > 0) {
      sheet.getRange(row, cm['จำนวน']+1).setValue(data.qty||'');
      return {success:true, updated:1};
    }
    return {success:true, updated:0};
  }

  // ── ordered: เจ้าของกดสั่งแล้ว → รอของ ──
  if (action === 'ordered') {
    const sheet = getOrCreateSheet(data.branch);
    const cm = ensureCols(sheet);
    const row = findRow(sheet, data.rowId);
    if (row > 0) {
      const orderedAt = data.orderedAt || nowStr_();
      sheet.getRange(row, cm['สถานะ']+1).setValue('รอของ');
      sheet.getRange(row, cm['วันที่สั่งแล้ว']+1).setValue(orderedAt);
      sheet.getRange(row, cm['สถานะ']+1).setBackground('#fff3cd').setFontColor('#856404').setFontWeight('bold');
      return {success:true, updated:1};
    }
    return {success:true, updated:0};
  }

  // ── received: ลูกน้องกดรับของแล้ว → รับแล้ว ──
  if (action === 'received') {
    const sheet = getOrCreateSheet(data.branch);
    const cm = ensureCols(sheet);
    const row = findRow(sheet, data.rowId);
    if (row > 0) {
      const recvAt = data.receivedAt || nowStr_();
      sheet.getRange(row, cm['สถานะ']+1).setValue('รับแล้ว');
      sheet.getRange(row, cm['วันที่รับของ']+1).setValue(recvAt);
      sheet.getRange(row, cm['สถานะ']+1).setBackground('#e8f0fb').setFontColor('#1a56a0').setFontWeight('bold');
      return {success:true, updated:1};
    }
    return {success:true, updated:0};
  }

  // ── reorder: ตามของ/สั่งซ้ำ → กลับเป็นรอสั่ง ──
  if (action === 'reorder') {
    const sheet = getOrCreateSheet(data.branch);
    const cm = ensureCols(sheet);
    const row = findRow(sheet, data.rowId);
    if (row > 0) {
      sheet.getRange(row, cm['สถานะ']+1).setValue('รอสั่ง');
      sheet.getRange(row, cm['วันที่สั่งแล้ว']+1).setValue('');
      const noteCol = cm['หมายเหตุ']+1;
      const curNote = sheet.getRange(row, noteCol).getValue();
      if(String(curNote).indexOf('ตามของ')<0){
        sheet.getRange(row, noteCol).setValue((curNote?curNote+' ':'')+'⏰ตามของ-สั่งซ้ำ');
      }
      sheet.getRange(row, cm['สถานะ']+1).setBackground('#e6f7eb').setFontColor('#2d9b4e').setFontWeight('bold');
      return {success:true, updated:1};
    }
    return {success:true, updated:0};
  }

  // ── load: โหลดรายการ รอสั่ง + รอของ (ไม่เอารับแล้ว) ──
  if (action === 'load') {
    const sheet = getOrCreateSheet(data.branch);
    const cm = getColMap(sheet);
    const iStatus = cm['สถานะ'];
    const iQty = cm['จำนวน'];
    const iOrderedAt = cm['วันที่สั่งแล้ว'];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return {success:true, items:[]};
    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const items = [];
    const tz = 'Asia/Bangkok';
    for (let i = 0; i < values.length; i++) {
      const r = values[i];
      if (!r[0]) continue;
      const status = String(r[iStatus]||'รอสั่ง');
      if (status === 'รับแล้ว') continue;
      let orderedAtStr = '';
      if(iOrderedAt!==undefined && r[iOrderedAt]){
        const d = toDate(r[iOrderedAt]);
        if(d) orderedAtStr = Utilities.formatDate(d,tz,'dd/MM/yyyy HH:mm');
      }
      items.push({
        rowId: String(r[0]), orderDate: String(r[1]), branch: r[2],
        supplier: r[3], code: r[4], name: r[5], unit: r[6], note: r[7],
        qty: (iQty!==undefined && r[iQty]!=='') ? Number(r[iQty]) : null,
        status: status,
        orderedAt: orderedAtStr
      });
    }
    return {success:true, items};
  }

  // ── loadRecent: รายการ รอของ + รับแล้ว ใน 7 วัน (สำหรับเช็คคีย์ซ้ำ) ──
  if (action === 'loadRecent') {
    const sheet = getOrCreateSheet(data.branch);
    const cm = getColMap(sheet);
    const iStatus = cm['สถานะ'];
    const iOrderedAt = cm['วันที่สั่งแล้ว'];
    const iQty = cm['จำนวน'];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return {success:true, items:[]};
    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const items = [];
    const tz = 'Asia/Bangkok';
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    for (let i = 0; i < values.length; i++) {
      const r = values[i];
      if (!r[0]) continue;
      const status = String(r[iStatus]||'');
      if (status !== 'รอของ' && status !== 'รับแล้ว') continue;
      const d = toDate(r[iOrderedAt]);
      if (d && d >= sevenDaysAgo) {
        items.push({
          rowId: String(r[0]), code: r[4], name: r[5],
          unit: r[6], qty: (iQty!==undefined && r[iQty]!=='')?Number(r[iQty]):null,
          status: status,
          orderedAt: Utilities.formatDate(d,tz,'dd/MM/yyyy HH:mm')
        });
      }
    }
    return {success:true, items};
  }

  return {success:false, error:'unknown action'};
}

function doPost(e) {
  return buildResponse(handleRequest(JSON.parse(e.postData.contents)));
}
function doGet(e) {
  const p = e.parameter;
  if (p.action) return buildResponse(handleRequest(p));
  return buildResponse({success:true, status:'ok'});
}
function buildResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ══════════════════════════════════════════════════════════════
   ระบบเก็บข้อมูลเก่า (Archive)
   ══════════════════════════════════════════════════════════════ */

// ล้างครั้งแรก: ย้าย "รับแล้ว" ที่เก่ากว่า KEEP_RECEIVED_DAYS วัน ไปแท็บ Archive
function cleanupNow() {
  const n = archiveOld_(KEEP_RECEIVED_DAYS);
  Logger.log('ย้ายไป Archive แล้ว ' + n + ' แถว');
  return n;
}

// ตั้งเวลาให้ล้างเองทุกเดือน (รันครั้งเดียว)
function setupMonthlyArchive() {
  ScriptApp.getProjectTriggers().forEach(t=>{
    if (t.getHandlerFunction() === 'monthlyArchive') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('monthlyArchive')
    .timeBased().onMonthDay(1).atHour(3).create();
  Logger.log('ตั้งเวลาเรียบร้อย: จะล้างอัตโนมัติทุกวันที่ 1 ตอนตี 3');
}

function monthlyArchive() { archiveOld_(KEEP_RECEIVED_DAYS); }

/**
 * ย้ายแถวสถานะ "รับแล้ว" ที่รับของเกิน keepDays วันแล้ว
 * ออกจากแท็บสาขา ไปไว้ที่แท็บ "Archive" (ข้อมูลไม่หาย แค่ย้ายที่)
 */
function archiveOld_(keepDays) {
  const ss = ss_();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);

  let archive = ss.getSheetByName('Archive');
  if (!archive) {
    archive = ss.insertSheet('Archive');
    archive.appendRow(HEADERS);
    archive.getRange(1,1,1,HEADERS.length).setFontWeight('bold').setBackground('#6b7f96').setFontColor('#ffffff');
    archive.setFrozenRows(1);
  }

  let moved = 0;
  ss.getSheets().forEach(sheet => {
    const name = sheet.getName();
    if (name === 'Archive') return;
    if (name.indexOf('สาขา') !== 0) return;   // เฉพาะแท็บสาขา

    const cm = getColMap(sheet);
    const iStatus = cm['สถานะ'];
    const iRecv   = cm['วันที่รับของ'];
    if (iStatus === undefined) return;

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const width = sheet.getLastColumn();
    const values = sheet.getRange(2, 1, lastRow - 1, width).getValues();

    const keepRows = [];   // แถวที่เก็บไว้
    const moveRows = [];   // แถวที่ย้ายออก
    values.forEach(r => {
      if (!r[0]) return;                                  // แถวว่าง = ทิ้ง
      const status = String(r[iStatus] || '');
      if (status !== 'รับแล้ว') { keepRows.push(r); return; }
      const d = (iRecv !== undefined) ? toDate(r[iRecv]) : null;
      if (d && d < cutoff) moveRows.push(r);              // เก่าพอ → ย้าย
      else keepRows.push(r);                              // เพิ่งรับ → เก็บไว้ก่อน
    });

    if (!moveRows.length) return;

    // เขียนลง Archive ทีเดียว
    archive.getRange(archive.getLastRow() + 1, 1, moveRows.length, width)
           .setValues(moveRows);

    // เขียนแถวที่เหลือกลับลงแท็บสาขา แล้วลบส่วนเกินทิ้ง
    sheet.getRange(2, 1, lastRow - 1, width).clearContent();
    if (keepRows.length) {
      sheet.getRange(2, 1, keepRows.length, width).setValues(keepRows);
    }
    const extra = (lastRow - 1) - keepRows.length;
    if (extra > 0) sheet.deleteRows(keepRows.length + 2, extra);

    moved += moveRows.length;
    Logger.log(name + ': ย้าย ' + moveRows.length + ' แถว, เหลือ ' + keepRows.length);
  });

  Logger.log('รวมย้ายทั้งหมด ' + moved + ' แถว');
  return moved;
}

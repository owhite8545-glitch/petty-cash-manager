/**
 * سكربت استخراج وفحص بيانات الإنتاج الحقيقية
 * Script to extract, inspect and locate real petty cash production data
 * 
 * يقرأ ملفات النسخ الاحتياطية وملفات التخزين المحلي لاستخراج بيانات العهدة الأصلية.
 */

const fs = require('fs');
const path = require('path');

console.log('================================================================');
console.log('🔍 فحص واستخراج بيانات الإنتاج الحقيقية (Petty Cash Data Extraction)');
console.log('================================================================\n');

// 1. فحص مجلد التنزيلات (Downloads) حيث يتم حفظ النسخ الاحتياطية الرسمية للعميل
const userDownloads = path.join(process.env.USERPROFILE || 'C:\\Users\\PC', 'Downloads');
const backupPath = path.join(userDownloads, 'petty_cash_backup_2026.json');

console.log(`[1] فحص ملف النسخة الاحتياطية الرسمية: ${backupPath}`);
if (fs.existsSync(backupPath)) {
  const content = fs.readFileSync(backupPath, 'utf8');
  try {
    const data = JSON.parse(content);
    console.log('  ✓ تم العثور على النسخة الاحتياطية الرسمية للإنتاج بنجاح!');
    console.log(`  • عدد الأشخاص المسجلين: ${data.people ? data.people.length : 0}`);
    console.log(`  • أيام الاستلام النقدي (dailyReceipts): ${Object.keys(data.dailyReceipts || {}).length} يوم`);
    console.log(`  • أيام التسجيل والتوزيع (entries): ${Object.keys(data.entries || {}).length} يوم`);
    
    // حفظ نسخة مفحوصة في مجلد tests
    const targetCopy = path.join(__dirname, '..', 'tests', 'historical_production_copy.json');
    fs.writeFileSync(targetCopy, JSON.stringify(data, null, 2), 'utf8');
    console.log(`  ✓ تم حفظ نسخة طبق الأصل للمطابقة في: ${targetCopy}\n`);
  } catch (err) {
    console.error('  ❌ خطأ في قراءة ملف JSON:', err.message);
  }
} else {
  console.log('  ⚠️ لم يتم العثور على الملف في مجلد التنزيلات.');
}

// 2. فحص مجلد LevelDB للمتصفح (Edge LocalStorage)
const leveldbDir = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\PC\\AppData\\Local', 'Microsoft', 'Edge', 'User Data', 'Default', 'Local Storage', 'leveldb');
console.log(`[2] فحص التخزين المحلي لمتصفح Edge: ${leveldbDir}`);

if (fs.existsSync(leveldbDir)) {
  const files = fs.readdirSync(leveldbDir).filter(f => f.endsWith('.ldb') || f.endsWith('.log'));
  console.log(`  • عدد ملفات السجلات وقواعد البيانات الموجودة: ${files.length} ملف`);
  
  let foundCount = 0;
  for (const file of files) {
    try {
      const fullPath = path.join(leveldbDir, file);
      const buf = fs.readFileSync(fullPath);
      const str = buf.toString('latin1');
      if (str.includes('petty_cash')) {
        foundCount++;
        console.log(`  ✓ تم العثور على سجلات عهدة في الملف: ${file}`);
      }
    } catch (e) {
      // قد تكون بعض الملفات مقفلة من المتصفح النشط
    }
  }
  console.log(`  • إجمالي الملفات التي تحوي بيانات عهدة: ${foundCount}\n`);
} else {
  console.log('  ℹ️ مجلد LevelDB غير موجود في هذا المسار.');
}

console.log('================================================================');
console.log('🏁 اكتمل الفحص والاستخراج بنجاح.');
console.log('================================================================');

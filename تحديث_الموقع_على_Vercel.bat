@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo جاري رفع التعديلات الجديدة تلقائياً إلى GitHub و Vercel...
git add -A
git commit -m "تحديث تلقائي للموقع"
git push origin main
echo.
echo ✅ تم رفع التعديلات بنجاح! سيتم تحديث رابط Vercel خلال ثوانٍ.
pause

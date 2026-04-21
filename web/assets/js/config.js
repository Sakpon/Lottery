// Deploy-time config
// Workflow จะเขียนทับไฟล์นี้ก่อน deploy โดยตั้ง window.__API_BASE__ เป็น URL ของ API Worker
// ถ้าไฟล์นี้ไม่ถูกทับ (เช่น local dev) api.js จะ fallback ไปใช้ "/api" ผ่าน Pages Function proxy

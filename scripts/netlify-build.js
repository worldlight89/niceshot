/**
 * Netlify 빌드 시 환경변수 NICESHOT_API_URL 값을 config.js 로 씁니다.
 * 퍼블리시 디렉터리가 frontend 이므로 frontend/config.js 를 생성합니다.
 */
const fs = require("fs");
const path = require("path");

const apiUrl = process.env.NICESHOT_API_URL || "https://niceshot-production.up.railway.app";
const outPath = path.join(__dirname, "..", "frontend", "config.js");
const content = `// Netlify 빌드 시 자동 생성됨. 백엔드 API 주소입니다.
window.NICESHOT_API_URL = ${JSON.stringify(apiUrl)};
`;

fs.writeFileSync(outPath, content, "utf8");
console.log("Wrote", outPath, "with NICESHOT_API_URL =", apiUrl || "(비어 있음)");

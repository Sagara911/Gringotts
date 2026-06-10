// 生成 Nobi 应用图标：金黄圆角方块 + 右上角黑色星光（透明底 1024×1024）
// 用法: node scripts/make-icon.cjs → app-icon.png（再 `npm run tauri icon app-icon.png` 生成全套）
const sharp = require("sharp");

const svg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <!-- 便签方块：居中圆角方形 -->
  <rect x="192" y="192" width="640" height="640" rx="140" fill="#F7B500"/>
  <!-- 星光：四角凹边星，位于右上角（约方块宽 79% / 高 22% 处） -->
  <path fill="#1F1F1F" d="
    M 698 247
    C 707 302 729 324 784 333
    C 729 342 707 364 698 419
    C 689 364 667 342 612 333
    C 667 324 689 302 698 247
    Z"/>
</svg>`;

sharp(Buffer.from(svg))
  .resize(1024, 1024)
  .png()
  .toFile("app-icon.png")
  .then(() => console.log("app-icon.png 已生成"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

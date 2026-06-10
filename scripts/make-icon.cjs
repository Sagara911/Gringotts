// 生成 Nobi 应用图标：黄色吊牌 + 黑色星光（透明底 1024×1024）
// 完全沿 ↗↙ 对角轴镜像对称：正置圆角方形（角即在对角线上）、
// 打孔圆心在对角轴上且完整嵌在右上角内、星光中心也在对角轴上。
// 用法: node scripts/make-icon.cjs → app-icon.png（再 `npm run tauri icon app-icon.png` 生成全套）
const sharp = require("sharp");

const svg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <mask id="cut">
      <rect width="1024" height="1024" fill="white"/>
      <!-- 打孔角保持圆角原样：孔心 (682,342) 在对角轴上 -->
      <circle cx="682" cy="342" r="54" fill="black"/>
      <!-- 切对面那个角（左下）：切口垂直于对角轴，保持镜像对称 -->
      <polygon points="222,642 222,802 382,802" fill="black"/>
    </mask>
  </defs>
  <!-- 吊牌：正置圆角方形，右上打孔，左下切角 -->
  <g mask="url(#cut)">
    <rect x="232" y="232" width="560" height="560" rx="112" fill="#F6C445"/>
  </g>
  <!-- 星光：四角凹边星，正中心 (512,512)（对角轴上） -->
  <path fill="#1F1F1F" d="
    M 512 372
    C 526 462 562 498 652 512
    C 562 526 526 562 512 652
    C 498 562 462 526 372 512
    C 462 498 498 462 512 372
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

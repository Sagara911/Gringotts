// 生成 Nobi 应用图标：黄色吊牌 + 黑色星光（透明底 1024×1024）
// 形状 = 原参考图的姿态：圆角方形旋转 45°（菱形吊牌，尖朝左下），
// 孔与星光都在 ↗↙ 对角轴上 → 竖过来看完全左右对称。
// 用法: node scripts/make-icon.cjs → app-icon.png（再 `npm run tauri icon app-icon.png` 生成全套）
const sharp = require("sharp");

const svg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <mask id="hole">
      <rect width="1024" height="1024" fill="white"/>
      <!-- 孔心在对角轴 (512+t,512-t) 上，t=120，完整嵌在右上斜边内 -->
      <circle cx="632" cy="392" r="54" fill="black"/>
    </mask>
  </defs>
  <!-- 吊牌：圆角方形旋转 45°，尖朝左下 -->
  <g mask="url(#hole)">
    <g transform="rotate(45 512 512)">
      <rect x="252" y="252" width="520" height="520" rx="95" fill="#F6C445"/>
    </g>
  </g>
  <!-- 星光：四角凹边星，中心 (482,542) 在对角轴上、略偏左下与孔平衡 -->
  <path fill="#1F1F1F" d="
    M 482 402
    C 496 492 532 528 622 542
    C 532 556 496 592 482 682
    C 468 592 432 556 342 542
    C 432 528 468 492 482 402
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

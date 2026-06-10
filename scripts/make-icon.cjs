// 生成 Nobi 应用图标：经典标签剪影 🏷️ + 星光（透明底 1024×1024）
// 形状：五边形吊牌（矩形身 + 尖头），尖头朝右上、孔在尖下、宽身在左下；
// 孔与星光都在吊牌中轴（=画布 ↗↙ 对角线）上 → 竖过来看完全左右对称。
// 用法: node scripts/make-icon.cjs → app-icon.png（再 `npm run tauri icon app-icon.png` 生成全套）
const sharp = require("sharp");

const svg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <mask id="hole">
      <rect x="-512" y="-512" width="2048" height="2048" fill="white"/>
      <!-- 孔：吊牌中轴上、尖头之下（旋转组内坐标） -->
      <circle cx="512" cy="322" r="54" fill="black"/>
    </mask>
  </defs>

  <!-- 吊牌：竖直五边形（尖头朝上）整体旋转 45°，尖头落在右上 -->
  <g transform="rotate(45 512 512)">
    <g mask="url(#hole)">
      <!-- 粗描边圆角技巧：五边形 + 同色 120 宽圆角描边 = 均匀圆角 -->
      <path d="M 512 222 L 702 412 L 702 802 L 322 802 L 322 412 Z"
            fill="#F6C445" stroke="#F6C445" stroke-width="120" stroke-linejoin="round"/>
    </g>
  </g>

  <!-- 星光：保持竖直（屏幕坐标），中心在吊牌中轴的屏幕位置 (457,567) -->
  <path fill="#1F1F1F" d="
    M 457 432
    C 471 522 507 553 592 567
    C 507 581 471 612 457 702
    C 443 612 407 581 322 567
    C 407 553 443 522 457 432
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

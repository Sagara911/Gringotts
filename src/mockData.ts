export interface Asset {
  id: number;
  name: string;
  format: string;
  width: number;
  height: number;
  source: string;
  author: string;
  tags: string[];
  colors: string[]; // 主色调，第一个用于缩略图渐变起点
}

export const MOCK_ASSETS: Asset[] = [
  { id: 1, name: "赛博朋克_雨夜街道.jpg", format: "JPG", width: 1920, height: 1080, source: "ArtStation", author: "L. Chen", tags: ["场景", "赛博朋克", "夜景", "霓虹"], colors: ["#1b2a4a", "#c9356b", "#27c3d6"] },
  { id: 2, name: "厚涂_女性头像.png", format: "PNG", width: 1024, height: 1024, source: "Pixiv", author: "akira", tags: ["角色", "头像", "厚涂", "暖光"], colors: ["#6b3b2a", "#e0a268", "#3a2418"] },
  { id: 3, name: "中世纪城堡_概念图.jpg", format: "JPG", width: 2048, height: 1152, source: "Pinterest", author: "未知", tags: ["场景", "建筑", "写实", "冷色调"], colors: ["#3a4a52", "#8aa0a8", "#1c2528"] },
  { id: 4, name: "像素_森林tileset.png", format: "PNG", width: 512, height: 512, source: "itch.io", author: "PixelFox", tags: ["像素", "tileset", "森林", "游戏"], colors: ["#2e5d34", "#7bc96f", "#1a3a1f"] },
  { id: 5, name: "石头_PBR_albedo.png", format: "PNG", width: 2048, height: 2048, source: "本地", author: "—", tags: ["贴图", "PBR", "石头", "材质"], colors: ["#6e655a", "#9a8f7e", "#41382f"] },
  { id: 6, name: "科幻机甲_线稿.jpg", format: "JPG", width: 1440, height: 1800, source: "ArtStation", author: "M. Tan", tags: ["角色", "机甲", "线稿", "科幻"], colors: ["#d9d4c8", "#8a8a9a", "#2a2a2a"] },
  { id: 7, name: "水彩_山脉风景.jpg", format: "JPG", width: 1600, height: 1067, source: "Behance", author: "rin", tags: ["场景", "风景", "水彩", "暖色调"], colors: ["#c98a5b", "#e8c39a", "#7a9bb5"] },
  { id: 8, name: "暗黑_龙_概念.png", format: "PNG", width: 1920, height: 1280, source: "ArtStation", author: "K. Wolf", tags: ["生物", "龙", "暗黑", "夜景"], colors: ["#2a1a2e", "#7a2e3a", "#c0563d"] },
  { id: 9, name: "金属_划痕_贴图.jpg", format: "JPG", width: 1024, height: 1024, source: "本地", author: "—", tags: ["贴图", "金属", "材质", "工业"], colors: ["#4a4f55", "#8b9197", "#23262a"] },
  { id: 10, name: "卡通_角色三视图.png", format: "PNG", width: 2400, height: 1200, source: "Pinterest", author: "未知", tags: ["角色", "卡通", "设定", "三视图"], colors: ["#e85d75", "#ffd6a5", "#5b8def"] },
  { id: 11, name: "霓虹_招牌_参考.jpg", format: "JPG", width: 1280, height: 1280, source: "Unsplash", author: "—", tags: ["元素", "霓虹", "招牌", "夜景"], colors: ["#101018", "#ff3d7f", "#00e0c7"] },
  { id: 12, name: "森林_晨雾_照片.jpg", format: "JPG", width: 3000, height: 2000, source: "Unsplash", author: "—", tags: ["场景", "森林", "写实", "晨雾"], colors: ["#3c4a3a", "#9bb08a", "#d7e0d2"] },
];

export const FOLDERS = [
  { name: "全部素材", count: 12, active: true },
  { name: "项目 · 暗影之城", count: 6 },
  { name: "项目 · 像素游戏", count: 2 },
  { name: "贴图库", count: 3 },
];

export const SMART_COLLECTIONS = [
  { name: "最近导入", count: 12 },
  { name: "按风格 · 赛博朋克", count: 2 },
  { name: "按配色 · 暖色调", count: 2 },
  { name: "重复项（视觉近似）", count: 0 },
];

// 所有标签（扁平，后续会做层级）
export const ALL_TAGS = ["场景", "角色", "贴图", "像素", "夜景", "赛博朋克", "厚涂", "写实", "水彩", "PBR", "材质"];

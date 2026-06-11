// 一键发版：改版本号 → 提交 → 打标签 → 推送，剩下交给 GitHub Actions 云端打包发布。
// 用法：node scripts/release.mjs 0.1.2
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v ?? "")) {
  console.error("用法: node scripts/release.mjs <版本号>   例如 node scripts/release.mjs 0.1.2");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const conf = join(root, "src-tauri", "tauri.conf.json");
const json = JSON.parse(readFileSync(conf, "utf8"));
const old = json.version;
if (old === v) {
  console.error(`版本号已经是 ${v}，无需变更`);
  process.exit(1);
}
json.version = v;
writeFileSync(conf, JSON.stringify(json, null, 2) + "\n");

const run = (c) => execSync(c, { stdio: "inherit", cwd: root });
run(`git add src-tauri/tauri.conf.json`);
run(`git commit -m "release: v${v}"`);
run(`git tag v${v}`);
run(`git push origin main`);
run(`git push origin v${v}`);

console.log(`\n✅ v${old} → v${v} 已推送，GitHub Actions 正在云端编译签名发布（首跑约 15 分钟）`);
console.log("   进度看这里: https://github.com/Sagara911/Nobi/actions");
console.log("   发布完成后，老版本用户启动 Nobi 即收到升级提示。");

import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Asset } from "../types";
import * as api from "../api";
import "./ModelViewer.css";

type ViewerCtl = {
  reset?: () => void;
  setRotate?: (v: boolean) => void;
  setSolid?: (v: boolean) => void;
  setCompat?: (v: boolean) => void;
  snapshot?: () => string | null;
};

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export default function ModelViewer({
  asset,
  onClose,
  onThumbSaved,
}: {
  asset: Asset;
  onClose: () => void;
  onThumbSaved?: () => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const ctlRef = useRef<ViewerCtl>({});
  const [status, setStatus] = useState("加载 3D 引擎...");
  const [rotate, setRotate] = useState(true);
  const [solid, setSolid] = useState(false);
  const [compat, setCompat] = useState(false);
  const [glInfo, setGlInfo] = useState("");

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    setStatus("加载模型...");
    setRotate(true);
    setSolid(false);
    setCompat(false);

    (async () => {
      try {
        const THREE = await import("three");
        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
        if (disposed) return;

        const el = mountRef.current;
        if (!el) return;

        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          preserveDrawingBuffer: true,
          powerPreference: "high-performance",
        });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(el.clientWidth, el.clientHeight);
        renderer.domElement.className = "mv-webgl";
        el.appendChild(renderer.domElement);

        const fallback = document.createElement("img");
        fallback.className = "mv-fallback-img";
        fallback.draggable = false;
        if (asset.thumb) fallback.src = convertFileSrc(asset.thumb);
        el.appendChild(fallback);

        let fallbackOn = false;
        let lastFallbackFrame = 0;
        const setCompatMode = (on: boolean) => {
          fallbackOn = on;
          fallback.style.display = on ? "block" : "none";
          renderer.domElement.style.visibility = on ? "hidden" : "visible";
          setCompat(on);
        };
        setCompatMode(false);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x15171d);
        const camera = new THREE.PerspectiveCamera(
          35,
          el.clientWidth / Math.max(1, el.clientHeight),
          0.001,
          100000
        );
        scene.add(camera);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 1.6;

        scene.add(new THREE.AmbientLight(0xffffff, 0.72));
        scene.add(new THREE.HemisphereLight(0xffffff, 0x303040, 1.35));
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(4, 8, 6);
        scene.add(key);
        const head = new THREE.PointLight(0xffffff, 0.9);
        camera.add(head);

        try {
          const gl = renderer.getContext();
          const dbg = gl.getExtension("WEBGL_debug_renderer_info");
          setGlInfo(
            String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
          );
        } catch {
          /* ignore */
        }

        const dirPath = asset.path.replace(/[\\/][^\\/]*$/, "");
        const manager = new THREE.LoadingManager();
        manager.setURLModifier((raw) => {
          if (/^(blob:|data:|https?:|asset:)/i.test(raw)) return raw;
          const decoded = safeDecode(raw).replace(/^\.\//, "");
          if (/^[a-z]:[\\/]/i.test(decoded) || decoded.startsWith("\\\\")) {
            return convertFileSrc(decoded);
          }
          return convertFileSrc(`${dirPath}\\${decoded.replace(/\//g, "\\")}`);
        });

        const url = convertFileSrc(asset.path);
        const fmt = asset.format.toLowerCase();
        let obj: import("three").Object3D;
        if (fmt === "glb" || fmt === "gltf") {
          const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
          obj = (await new GLTFLoader(manager).loadAsync(url)).scene;
        } else if (fmt === "obj") {
          const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
          obj = await new OBJLoader(manager).loadAsync(url);
        } else if (fmt === "fbx") {
          const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
          obj = await new FBXLoader(manager).loadAsync(url);
        } else if (fmt === "stl") {
          const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
          const geo = await new STLLoader(manager).loadAsync(url);
          obj = new THREE.Mesh(geo);
        } else {
          throw new Error(`不支持的 3D 格式：${asset.format}`);
        }
        if (disposed) {
          renderer.dispose();
          return;
        }

        let meshCount = 0;
        const originalMaterials = new Map<
          import("three").Mesh,
          import("three").Material | import("three").Material[]
        >();
        const solidMaterial = new THREE.MeshBasicMaterial({
          color: 0xe8eef9,
          side: THREE.DoubleSide,
        });
        const materialList = (m: import("three").Material | import("three").Material[]) =>
          Array.isArray(m) ? m : [m];
        obj.traverse((node) => {
          const mesh = node as import("three").Mesh;
          if (!(mesh as { isMesh?: boolean }).isMesh) return;
          meshCount++;
          mesh.frustumCulled = false;
          if (mesh.material) {
            originalMaterials.set(mesh, mesh.material);
            for (const mat of materialList(mesh.material)) {
              mat.side = THREE.DoubleSide;
              mat.needsUpdate = true;
            }
          } else {
            originalMaterials.set(mesh, solidMaterial);
            mesh.material = solidMaterial;
          }
        });
        if (meshCount === 0) throw new Error("模型没有可显示的网格");

        const applySolid = (on: boolean) => {
          for (const [mesh, original] of originalMaterials) {
            mesh.material = on ? solidMaterial : original;
          }
          setSolid(on);
        };

        scene.add(obj);
        const fitCamera = () => {
          obj.updateWorldMatrix(true, true);
          const box = new THREE.Box3().setFromObject(obj);
          const center = box.getCenter(new THREE.Vector3());
          obj.position.sub(center);
          obj.updateWorldMatrix(true, true);
          const fitted = new THREE.Box3().setFromObject(obj);
          const sphere = fitted.getBoundingSphere(new THREE.Sphere());
          const radius = Math.max(sphere.radius, 0.001);
          const fov = THREE.MathUtils.degToRad(camera.fov);
          const dist = (radius / Math.sin(fov / 2)) * 1.35;
          camera.near = Math.max(radius / 1000, 0.001);
          camera.far = radius * 1000 + dist;
          camera.position.copy(new THREE.Vector3(0.65, 0.42, 1).normalize().multiplyScalar(dist));
          camera.lookAt(0, 0, 0);
          camera.updateProjectionMatrix();
          controls.target.set(0, 0, 0);
          controls.minDistance = radius * 0.04;
          controls.maxDistance = radius * 80;
          controls.update();
        };
        fitCamera();

        const defaultSolid = fmt === "fbx" || fmt === "obj" || fmt === "stl";
        if (defaultSolid) applySolid(true);
        setStatus("");

        let raf = 0;
        let warmupFrames = 0;
        const render = (now = performance.now()) => {
          try {
            controls.update();
            renderer.render(scene, camera);
            if (fallbackOn && now - lastFallbackFrame > 110) {
              lastFallbackFrame = now;
              fallback.src = renderer.domElement.toDataURL("image/png");
            }
            if (++warmupFrames === 8 && !asset.thumb) {
              const b64 = renderer.domElement.toDataURL("image/png").split(",")[1] ?? "";
              if (b64) {
                api
                  .setThumb(asset.id, b64)
                  .then(() => onThumbSaved?.())
                  .catch(() => {});
              }
            }
          } catch (err) {
            setStatus(`渲染中断：${err instanceof Error ? err.message : err}`);
            return;
          }
          raf = requestAnimationFrame(render);
        };
        render();

        const onResize = () => {
          if (!el.clientWidth || !el.clientHeight) return;
          camera.aspect = el.clientWidth / el.clientHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(el.clientWidth, el.clientHeight);
        };
        window.addEventListener("resize", onResize);
        requestAnimationFrame(onResize);

        ctlRef.current = {
          reset: fitCamera,
          setRotate: (v) => {
            controls.autoRotate = v;
            setRotate(v);
          },
          setSolid: applySolid,
          setCompat: setCompatMode,
          snapshot: () => {
            renderer.render(scene, camera);
            return renderer.domElement.toDataURL("image/png").split(",")[1] ?? null;
          },
        };

        cleanup = () => {
          cancelAnimationFrame(raf);
          window.removeEventListener("resize", onResize);
          controls.dispose();
          solidMaterial.dispose();
          renderer.dispose();
          renderer.forceContextLoss();
          renderer.domElement.remove();
          fallback.remove();
        };
      } catch (e) {
        if (!disposed) setStatus(`加载失败：${e instanceof Error ? e.message : e}`);
      }
    })();

    return () => {
      disposed = true;
      cleanup();
      ctlRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="mv-overlay" onClick={onClose}>
      <div className="mv-stage" onClick={(e) => e.stopPropagation()}>
        <div className="mv-toolbar">
          <div className="mv-group">
            <button
              className={"mv-tool" + (rotate ? " on" : "")}
              onClick={() => ctlRef.current.setRotate?.(!rotate)}
              title="自动旋转"
            >
              ⟳ 旋转
            </button>
            <button className="mv-tool" onClick={() => ctlRef.current.reset?.()} title="重置视角">
              ⌖ 重置
            </button>
            <button
              className="mv-tool"
              onClick={async () => {
                const b64 = ctlRef.current.snapshot?.();
                if (!b64) return;
                try {
                  await api.setThumb(asset.id, b64);
                  onThumbSaved?.();
                  setStatus("已把当前角度设为封面");
                  setTimeout(() => setStatus(""), 1500);
                } catch (e) {
                  setStatus(`封面保存失败：${e}`);
                }
              }}
              title="把当前角度存为网格缩略图"
            >
              ▣ 设为封面
            </button>
            <button
              className={"mv-tool" + (compat ? " on" : "")}
              onClick={() => ctlRef.current.setCompat?.(!compat)}
              title="兼容显示：直接 WebGL 看不到时，切到截图流显示"
            >
              ◫ 兼容
            </button>
            <button
              className={"mv-tool" + (solid ? " on" : "")}
              onClick={() => ctlRef.current.setSolid?.(!solid)}
              title="实体显示：忽略原贴图，用浅色双面材质看清轮廓"
            >
              ◩ 实体
            </button>
          </div>
          <div className="mv-title" title={asset.name}>
            {asset.name}
            <span className="mv-sub">{asset.format}</span>
          </div>
          <button className="mv-close" onClick={onClose} title="关闭（Esc）">
            ×
          </button>
        </div>
        <div ref={mountRef} className="mv-canvas">
          {status && <div className="mv-status">{status}</div>}
        </div>
        <div className="mv-hint">
          拖动旋转 · 滚轮缩放 · 右键平移
          {glInfo && <span className="mv-gl"> · {glInfo}</span>}
        </div>
      </div>
    </div>
  );
}

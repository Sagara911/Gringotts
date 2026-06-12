import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import RefWindow from "./components/RefWindow";
import WebMirror from "./components/WebMirror";

// hash 路由 → 独立的透明置顶小窗：#ref 悬浮参考图、#web 看球镜像；否则正常渲染主程序
const isRef = location.hash.startsWith("#ref");
const isWeb = location.hash.startsWith("#web");
if (isRef) document.body.classList.add("ref-window");
if (isWeb) document.body.classList.add("web-window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isRef ? <RefWindow /> : isWeb ? <WebMirror /> : <App />}</React.StrictMode>,
);

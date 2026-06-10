import { useState, type ReactNode } from "react";

/** 可折叠区块：点标题收起/展开，状态按 k 持久化到 localStorage。
 *  variant="side" 用于侧边栏（h4 样式），"insp" 用于详情面板（h5 样式）。 */
export default function Section({
  k,
  title,
  children,
  defaultOpen = true,
  variant = "side",
}: {
  k: string;
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  variant?: "side" | "insp";
}) {
  const [open, setOpen] = useState<boolean>(() => {
    const v = localStorage.getItem("sec-" + k);
    return v === null ? defaultOpen : v === "1";
  });
  const toggle = () =>
    setOpen((o) => {
      localStorage.setItem("sec-" + k, o ? "0" : "1");
      return !o;
    });

  if (variant === "insp") {
    return (
      <div className={"section" + (open ? "" : " closed")}>
        <h5 className="sec-head" onClick={toggle}>
          <span className="sec-chev">{open ? "▾" : "▸"}</span>
          {title}
        </h5>
        {open && children}
      </div>
    );
  }
  return (
    <div className={"nav-group" + (open ? "" : " closed")}>
      <h4 className="sec-head" onClick={toggle}>
        <span className="sec-chev">{open ? "▾" : "▸"}</span>
        {title}
      </h4>
      {open && children}
    </div>
  );
}

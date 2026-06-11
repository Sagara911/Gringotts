// 画板文本的富文本编辑覆盖层：TipTap（ProseMirror）承担选区/光标/输入法，
// 提交时由 BoardCanvas 把文档转回 runs 存进形状。
import { useEffect } from "react";
import { EditorContent, useEditor, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";

export default function TextEditorOverlay({
  doc,
  style,
  initMarks,
  onReady,
  onCommit,
}: {
  doc: Record<string, unknown>;
  style: React.CSSProperties;
  initMarks: { bold?: boolean; italic?: boolean; underline?: boolean };
  onReady: (ed: TiptapEditor) => void;
  onCommit: (doc: unknown) => void;
}) {
  const editor = useEditor({
    extensions: [
      // 画板标注用不到块级花活，关掉以免输入法/快捷规则误触发
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        strike: false,
      }),
      Underline,
      TextStyle,
      Color,
    ],
    content: doc,
    autofocus: "end",
  });

  useEffect(() => {
    if (!editor) return;
    onReady(editor);
    // 新建空文本：按当前默认样式预置输入 mark
    if (editor.isEmpty) {
      const c = editor.chain().focus();
      if (initMarks.bold) c.setBold();
      if (initMarks.italic) c.setItalic();
      if (initMarks.underline) c.setUnderline();
      c.run();
    }
    const onBlur = () => onCommit(editor.getJSON());
    editor.on("blur", onBlur);
    return () => {
      editor.off("blur", onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;
  return (
    <div
      className="bd-text-editor bd-text-rich"
      style={style}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          onCommit(editor.getJSON());
        }
        e.stopPropagation(); // 画布快捷键（含 Ctrl+Z，编辑内撤销归 TipTap）不抢键
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPaste={(e) => e.stopPropagation()}
    >
      <EditorContent editor={editor} />
    </div>
  );
}

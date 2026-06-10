// 画板对外门面：保持旧接口（addImages / BoardEditor / 默认导出）不变，
// 实现已从 tldraw 替换为自研 Konva 画布（src/board/）。
import BoardCanvas from "./board/BoardCanvas";
import { Editor, type BoardImage } from "./board/store";

export type BoardEditor = Editor;
export type { BoardImage };

/** 把一批图按网格摊到画布上 */
export function addImages(editor: BoardEditor, images: BoardImage[]) {
  editor.addImages(images);
}

export default BoardCanvas;

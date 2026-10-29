/* engine.js 是纯 JS 的 3D 场景，这里只声明 React 侧真正用到的那部分 */

import type * as THREE from "three";

export declare class Meadow {
  constructor(canvas: HTMLCanvasElement);

  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly ballRoot: THREE.Object3D;

  isMobile: boolean;
  time: number;
  yaw: number;
  pitch: number;
  flowP: number;
  flowDir: number;
  flowDur: number;

  /** 眼神跟鼠标（-1..1 的归一化坐标） */
  gazeAt(nx: number, ny: number): void;
  /** 眼神回到屏幕前的用户 */
  gazeToViewer(): void;
  /** 把面板顶边（CSS 像素）告诉场景，球会停在这条线上 */
  setPerchPixel(x: number, y: number): void;

  /** 兔子在屏幕上的位置（CSS 像素），气泡挂在 x/y 上 */
  rabbitAnchor(): RabbitAnchor | null;
  /** 屏幕坐标是否落在兔子身上 */
  hitRabbit(clientX: number, clientY: number, pad?: number): boolean;
  /** 让兔子跳一下 */
  hop(power?: number): void;

  /**
   * 给吊在左上那片天上的木板换内容。
   * 板面上没有字 —— 字是 HTML 那层按 `signQuad()` 贴上去的。
   */
  setBoard(board: SignBoard | null): void;
  /** 屏幕坐标是否落在木牌上 */
  hitSign(clientX: number, clientY: number): boolean;
  /** 木板在屏幕上的矩形（CSS 像素）；没挂起来时是 null */
  signAnchor(): SignAnchor | null;
  /** 板面四角（CSS 像素，左上 → 右上 → 右下 → 左下）；没立起来时是 null */
  signQuad(): SignQuad | null;

  startFlow(): void;
  endFlow(): void;

  update(dt: number): void;
  resize(): void;
  dispose(): void;
}

export interface RabbitAnchor {
  /** 头顶正中 */
  x: number;
  y: number;
  /** 身体中心的屏幕坐标 */
  cx: number;
  cy: number;
  /** 屏幕上的横 / 纵半径（像素） */
  rx: number;
  ry: number;
  scale: number;
  /** 正在转场飞行 */
  flowing: boolean;
  /** 已经趴在面板沿上 */
  perched: boolean;
}

export declare function terrainHeight(x: number, z: number): number;

/** 木板上的一行：一位档案今天的用药进度 */
export interface SignBoardEntry {
  patientId: string;
  patientName: string;
  total: number;
  done: number;
  overdue: number;
}

export interface SignBoard {
  total: number;
  done: number;
  overdue: number;
  entries: SignBoardEntry[];
}

export interface SignAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
}

export interface SignQuad {
  /** 左上 → 右上 → 右下 → 左下 */
  pts: { x: number; y: number }[];
  /** 0..1：木板挂出来的进度，文字层跟着淡入 */
  opacity: number;
}

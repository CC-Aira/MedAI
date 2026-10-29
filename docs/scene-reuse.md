# 场景复用：从别的页面回到首页不再重建 3D

## 问题

从档案详情 / 编辑页、疾病科普、药品说明返回首页，要等将近 **5 秒**才看到兔子，中间像卡住。

## 量出来的原因

先用 `PerformanceObserver` 记长任务，再给引擎的每一步加计时（`window.__meadow.buildMs`）：

| 步骤 | 耗时 |
| --- | --- |
| clouds（4 张 256×256 的 fbm 密度图） | 470~600 ms |
| companion（PMREM 环境贴图） | 15~150 ms |
| grass | 45~55 ms |
| ground | 28~50 ms |
| 其余（天空、花、蒲公英、鸟…） | < 10 ms |
| **合计** | **约 650~800 ms** |

这还只是 JS 侧。`Meadow` 每次都是 `new` 出来的，所以每次都要重新：
建 WebGL 上下文 → 上传所有贴图 → 编译着色器。实测从点击「回到小兔子」到画面出现 4.97 秒，
其中长任务只有 685 ms，剩下的时间都在等 GPU/着色器（headless 软件渲染下尤其慢）。

## 改法：场景常驻，只摘接 canvas

`src/components/meadow/scene-cache.ts` 里保存一份单例：

```ts
let stored: { canvas, meadow } | null = null;

acquireMeadow(host)   // 有就 appendChild 接回来，没有才 new
releaseMeadow(host)   // 只 removeChild，不 dispose
```

`MeadowStage` 的 effect 改成调用这两个函数，`<canvas>` 换成 `<div className="world__stage">`，
canvas 由 `scene-cache` 建好塞进去。

几个必须处理的细节：

1. **开发模式下 effect 跑两遍**：两路 `acquire` 会并发建出两份场景，其中一份成了孤儿
   （画面看得见、但不在缓存里）。用 `pending: Promise<Meadow>` 去重，`await` 之后再查一次
   `stored`，有人建好就把自己那个 canvas 丢掉。
2. **两次挂载的容器不是同一个**：`acquireMeadow` 里要显式
   `if (canvas.parentElement !== host) host.appendChild(canvas)`，否则复用的 canvas 留在旧 DOM 上。
3. **离开时窗口可能被拖动 / 转过屏**：接回来先 `meadow.resize()`。
4. **WebGL 上下文可能丢**（切走很久、显存不足）：`acquireMeadow` 里检查
   `ctx.isContextLost()`，丢了就 `dispose()` 重建。
5. **渲染循环仍归 React 管**：`requestAnimationFrame` 在 effect 里，卸载时 `cancel`，
   所以场景挂在内存里但不会空转耗电。

## 效果

| | 改前 | 改后 |
| --- | --- | --- |
| 详情页 → 首页（画面可见） | 4967 ms | **76~85 ms** |
| 长任务 | 2 个 / 685 ms | 0 |
| 是否新建 WebGL 上下文 | 每次都是 | 只有第一次 |

自检里用「同一个 meadow 实例 + 同一个 canvas」来判定复用：
`window.__m === window.__meadow && window.__cv === document.querySelector(".world__canvas")`。

## 代价

- 场景常驻内存（几何 + 贴图，约几十 MB），离开首页也不释放 —— 换来的是返回无等待
- 整页刷新（F5）才会真正重建
- 首页首屏首次加载的耗时没变（还是要建一次场景），这次优化只针对「回到首页」

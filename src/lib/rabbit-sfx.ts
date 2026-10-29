/**
 * 兔子的音效：点它的时候"啾"一声。
 *
 * 不用音频文件，WebAudio 现场合成 —— 免下载、免解码，点下去就是响的，
 * 体积为零。音色刻意做得短（约 0.3 秒）且很轻，连点也不会吵。
 */

let ctx: AudioContext | null = null;
let muted = false;

type AudioCtor = typeof AudioContext;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  return ctx;
}

/** 预留的总开关：接静音按钮时用 */
export function setRabbitSfxMuted(next: boolean) {
  muted = next;
}

export function isRabbitSfxMuted() {
  return muted;
}

/**
 * 一声软萌的"啾"：
 * 两个正弦叠起来，主音先往上滑再落回来，带一点颤音 —— 像小动物抬头发声。
 */
export function playRabbitSqueak(): void {
  if (muted) return;
  const ac = getCtx();
  if (!ac) return;

  // 浏览器要求用户手势之后才能出声；点击本身就是手势，这里只是兜底
  if (ac.state === "suspended") void ac.resume();

  const t0 = ac.currentTime + 0.005;
  const out = ac.createGain();
  out.gain.value = 0.16;          // 总音量，够听清但不吵
  out.connect(ac.destination);

  // --- 主音：上滑再回落
  const voice = ac.createOscillator();
  voice.type = "sine";
  voice.frequency.setValueAtTime(760, t0);
  voice.frequency.exponentialRampToValueAtTime(1480, t0 + 0.075);
  voice.frequency.exponentialRampToValueAtTime(1120, t0 + 0.22);

  // 颤音：让"啾"有一点奶音
  const lfo = ac.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 34;
  const lfoDepth = ac.createGain();
  lfoDepth.gain.value = 26;
  lfo.connect(lfoDepth);
  lfoDepth.connect(voice.frequency);

  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.55, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.28, t0 + 0.1);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);

  voice.connect(env);
  env.connect(out);
  voice.start(t0);
  voice.stop(t0 + 0.32);
  lfo.start(t0);
  lfo.stop(t0 + 0.32);

  // --- 高八度的一点亮片，只在前 0.12 秒
  const shine = ac.createOscillator();
  shine.type = "triangle";
  shine.frequency.setValueAtTime(1560, t0);
  shine.frequency.exponentialRampToValueAtTime(2300, t0 + 0.09);
  const shineEnv = ac.createGain();
  shineEnv.gain.setValueAtTime(0.0001, t0);
  shineEnv.gain.exponentialRampToValueAtTime(0.09, t0 + 0.015);
  shineEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
  shine.connect(shineEnv);
  shineEnv.connect(out);
  shine.start(t0);
  shine.stop(t0 + 0.16);

  // --- 落地那一下的轻"咚"，让它和跳跃对上
  const thump = ac.createOscillator();
  thump.type = "sine";
  thump.frequency.setValueAtTime(190, t0 + 0.24);
  thump.frequency.exponentialRampToValueAtTime(120, t0 + 0.4);
  const thumpEnv = ac.createGain();
  thumpEnv.gain.setValueAtTime(0.0001, t0 + 0.24);
  thumpEnv.gain.exponentialRampToValueAtTime(0.13, t0 + 0.26);
  thumpEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.44);
  thump.connect(thumpEnv);
  thumpEnv.connect(out);
  thump.start(t0 + 0.24);
  thump.stop(t0 + 0.46);
}

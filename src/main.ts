import { Engine3D } from './scene/Engine3D';
import Peer from 'peerjs';

const engine = new Engine3D('canvas-container');

let currentDoc: any = null;
let probedCells: { id: string, voltage: number }[] = [];
let currentTool: 'pointer' | 'multimeter' | 'bms' | 'network' | 'welder' | 'nickel' = 'pointer';

// =============================================
// 1. UI 面板与图层控制
// =============================================
document.getElementById('toggle-left-panel')?.addEventListener('click', () => {
  document.getElementById('left-panel')?.classList.toggle('collapsed');
});
document.getElementById('toggle-layer-panel')?.addEventListener('click', () => {
  document.getElementById('layer-panel')?.classList.toggle('collapsed');
});

document.getElementById('slider-brightness')?.addEventListener('input', (e) => {
  const val = (e.target as HTMLInputElement).value;
  document.getElementById('bright-val') && (document.getElementById('bright-val')!.innerText = `${val}%`);
  engine.setBrightness(parseInt(val));
});

['cells', 'busbars', 'bms', 'labels'].forEach(layer => {
  document.getElementById(`layer-${layer}`)?.addEventListener('change', (e) => {
    engine.setLayerVisible(layer as any, (e.target as HTMLInputElement).checked);
  });
});

document.getElementById('btn-reset-cam')?.addEventListener('click', () => engine.resetCamera());

document.getElementById('btn-auto-rotate')?.addEventListener('click', (e) => {
  const isRotating = engine.toggleAutoRotate();
  const btn = e.target as HTMLButtonElement;
  btn.classList.toggle('active', isRotating);
  btn.innerText = isRotating ? '⏹️ 停止旋转' : '🔄 自动旋转';
});

document.getElementById('toggle-wireframe')?.addEventListener('change', (e) => {
  engine.setWireframe((e.target as HTMLInputElement).checked);
});

// =============================================
// 📱 移动端专属菜单交互逻辑
// =============================================
const mobileMenuBtn = document.getElementById('btn-mobile-menu');
const mobileOverlay = document.getElementById('mobile-overlay');
const leftPanel = document.getElementById('left-panel');

// 切换侧边抽屉
function toggleMobileMenu() {
  leftPanel?.classList.toggle('mobile-open');
  mobileOverlay?.classList.toggle('active');
}

// 点击菜单按钮打开/关闭抽屉
mobileMenuBtn?.addEventListener('click', toggleMobileMenu);

// 点击遮罩层关闭抽屉
mobileOverlay?.addEventListener('click', toggleMobileMenu);

// 点击抽屉内的按钮/输入框时自动关闭抽屉（提升体验）
leftPanel?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.closest('button') || target.closest('input')) {
    setTimeout(toggleMobileMenu, 300);
  }
});

// =============================================
// 🌟 更安全的窗口拖拽 (包含移动端Bottom Sheet下拉物理引擎)
// =============================================
function makeDraggable(panelId: string, handleId: string) {
  const panel = document.getElementById(panelId);
  const handle = document.getElementById(handleId);

  // 找不到元素直接退出，不报错
  if (!panel || !handle) return;

  // ---------------------------------------------
  // 💻 PC端拖拽逻辑 (鼠标操作)
  // ---------------------------------------------
  let isDraggingPC = false, offsetX = 0, offsetY = 0;

  handle.addEventListener('mousedown', (e) => {
    if (window.innerWidth <= 768) return; // 手机端交由Touch事件处理
    if ((e.target as HTMLElement).classList.contains('close-btn')) return;

    isDraggingPC = true;
    const rect = panel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    panel.style.transition = 'none';
    document.querySelectorAll('.draggable-panel').forEach(p => (p as HTMLElement).style.zIndex = '10');
    panel.style.zIndex = '20';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDraggingPC) return;
    panel.style.left = `${e.clientX - offsetX}px`;
    panel.style.top = `${e.clientY - offsetY}px`;
    panel.style.bottom = 'auto';
    panel.style.right = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (isDraggingPC) {
      isDraggingPC = false;
      panel.style.transition = 'opacity 0.3s';
    }
  });

  // ---------------------------------------------
  // 📱 移动端下拉拖拽逻辑 (可变长度 + 拉到底关闭)
  // ---------------------------------------------
  let isDraggingMobile = false;
  let startY = 0;
  let startHeight = 0;

  handle.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 768) return;
    if ((e.target as HTMLElement).classList.contains('close-btn')) return;

    isDraggingMobile = true;
    startY = e.touches[0].clientY;
    startHeight = panel.getBoundingClientRect().height; // 🌟 记住按下时的初始高度

    // 移除动画，实现 1:1 无延迟绝对跟手
    panel.style.setProperty('transition', 'none', 'important');
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!isDraggingMobile) return;
    // 🌟 拦截浏览器原生的下拉刷新或页面滚动
    if (e.cancelable) e.preventDefault();

    const currentY = e.touches[0].clientY;
    const deltaY = currentY - startY; // 大于 0 说明手指向下滑动（想变短）

    let newHeight = startHeight - deltaY;

    // 如果向上拉得很高，允许它长高，但设定一个极限界限与阻尼
    const maxH = window.innerHeight * 0.85;
    if (newHeight > maxH) {
      newHeight = maxH + (newHeight - maxH) * 0.15; // 超过 85vh 后增加极强的拉扯阻尼感
    }

    // 🌟 直接改变面板的物理高度，实现随意调节长度
    panel.style.setProperty('height', `${newHeight}px`, 'important');
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (!isDraggingMobile) return;
    isDraggingMobile = false;

    // 恢复动画属性
    panel.style.removeProperty('transition');

    const endY = e.changedTouches[0].clientY;
    const deltaY = endY - startY;
    const finalHeight = startHeight - deltaY;

    // 🌟 阈值判定：如果高度被压得很扁（小于 150px），或者快速下滑，直接触发关闭！
    if (finalHeight < 150 || deltaY > 200) {
      panel.style.removeProperty('height'); // 恢复自动高度
      const closeBtn = panel.querySelector('.close-btn') as HTMLElement;
      if (closeBtn) closeBtn.click();
    } else if (finalHeight > window.innerHeight * 0.85) {
      // 如果向上拉扯超标了，松手时回弹到 85vh
      panel.style.setProperty('height', '85vh', 'important');
    }
    // 如果在正常范围内松手，面板会【保持】你刚才拖拽的那个高度！
  });
}

// 为所有面板绑定拖拽功能
makeDraggable('multimeter-ui', 'drag-header-multi');
makeDraggable('network-ui', 'drag-header-net');
makeDraggable('welder-ui', 'drag-header-welder');
makeDraggable('nickel-ui', 'drag-header-nickel');

// =============================================
// 3. FAB 菜单 & 工具切换
// =============================================
const fabContainer = document.getElementById('fab-container')!;
const multimeterUI = document.getElementById('multimeter-ui')!;
const networkUI = document.getElementById('network-ui')!;

document.getElementById('fab-main')?.addEventListener('click', () => {
  fabContainer.classList.toggle('open');
});

// 先在顶部定义 nickelUI（和 multimeterUI 放一起）
const nickelUI = document.getElementById('nickel-ui');

const switchTool = (tool: typeof currentTool) => {
  currentTool = tool;
  document.querySelectorAll('.fab-item').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`tool-${tool}`)?.classList.add('active');

  // 🌟 核心：每次切换工具时，强制清除所有面板残留的拖拽高度，让它恢复默认自动大小
  ['multimeter-ui', 'network-ui', 'welder-ui', 'nickel-ui'].forEach(id => {
    document.getElementById(id)?.style.removeProperty('height');
  });

  multimeterUI.classList.toggle('hidden', tool !== 'multimeter');
  networkUI.classList.toggle('hidden', tool !== 'network');
  document.getElementById('welder-ui')?.classList.toggle('hidden', tool !== 'welder');
  nickelUI?.classList.toggle('hidden', tool !== 'nickel');

  if (tool !== 'multimeter') {
    probedCells = [];
    engine.clearProbes();
  }

  if (tool !== 'welder') {
    engine.welder.reset();
  }

  // 新增：退出镍片模式时重置
  if (tool !== 'nickel') {
    engine.nickelPlanner.reset();
    engine.showAllBusbars(); // 核心修复：使用专用方法恢复所有镍片显示
  }

  fabContainer.classList.remove('open');
};

document.getElementById('tool-pointer')?.addEventListener('click', () => switchTool('pointer'));
document.getElementById('tool-multimeter')?.addEventListener('click', () => switchTool('multimeter'));
document.getElementById('tool-bms')?.addEventListener('click', () => switchTool('bms'));
document.getElementById('tool-network')?.addEventListener('click', () => switchTool('network'));
document.getElementById('tool-welder')?.addEventListener('click', () => switchTool('welder'));
document.getElementById('tool-nickel')?.addEventListener('click', () => switchTool('nickel')); // 新增
document.getElementById('btn-close-welder')?.addEventListener('click', () => switchTool('pointer'));

// =============================================
// 4. 拓扑电压计算
// =============================================
function calculateTopologyVoltage(idA: string, idB: string, doc: any): string {
  if (idA === idB) return "0.00";
  const graph: Record<string, string[]> = {};
  doc.cells.forEach((c: any) => graph[c.id] = []);
  doc.busbars.forEach((b: any) => {
    if (graph[b.from] && graph[b.to]) {
      graph[b.from].push(b.to);
      graph[b.to].push(b.from);
    }
  });

  const queue: { id: string; steps: number }[] = [{ id: idA, steps: 0 }];
  const visited = new Set<string>([idA]);
  let pathLength = -1;

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr.id === idB) {
      pathLength = curr.steps;
      break;
    }
    graph[curr.id].forEach(neighbor => {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ id: neighbor, steps: curr.steps + 1 });
      }
    });
  }

  if (pathLength === -1) return "OL (开路)";
  const singleV = parseFloat(doc.cells[0].voltage) || 3.7;
  return (Math.ceil(pathLength / 2) * singleV).toFixed(2);
}

// =============================================
// 5. 3D 点击交互
// =============================================
engine.onCellClick((cellData, intersectPoint, normal) => {
  if (!currentDoc) return;

  // 🌟 全局处理：指针模式下点击任意图元，更新左侧全局信息面板
  if (currentTool === 'pointer') {
    const globalInfo = document.getElementById('global-info-panel');
    if (globalInfo) {
      globalInfo.style.display = 'block';

      // 点击高亮动画
      globalInfo.style.boxShadow = '0 0 15px rgba(56, 189, 248, 0.5)';
      setTimeout(() => {
        if (globalInfo) globalInfo.style.boxShadow = 'none';
      }, 300);

      // 更新图元信息
      const infoId = document.getElementById('g-info-id');
      const infoType = document.getElementById('g-info-type');
      const infoPol = document.getElementById('g-info-pol');
      const infoV = document.getElementById('g-info-v');
      const infoR = document.getElementById('g-info-r');

      infoId && (infoId.innerText = cellData.id || cellData.busbarId || '--');
      infoType && (infoType.innerText = cellData.busbarId ? '⚡ 镍片/走线' : '🔋 物理电芯');

      let polText = '--';
      if (cellData.polarity === 'positive') polText = '正极 (+)';
      else if (cellData.polarity === 'negative') polText = '负极 (-)';
      infoPol && (infoPol.innerText = polText);

      infoV && (infoV.innerText = cellData.voltage || '--');
      infoR && (infoR.innerText = cellData.resistance || '--');
    }
  }

  // 🌟 镍片排布模式
  if (currentTool === 'nickel') {
    if (cellData.busbarId) {
      // 核心修复：只隐藏被合并的原始短线，不影响其他镍片
      const mergedIds = engine.nickelPlanner.calculateLayout(cellData.busbarId, currentDoc, engine.get3DPos.bind(engine));
      engine.hideSpecificBusbars(mergedIds);

      // 解锁所有控制按钮
      ['btn-nickel-play', 'btn-nickel-prev', 'btn-nickel-next', 'btn-nickel-reset'].forEach(id => {
        document.getElementById(id)?.removeAttribute('disabled');
      });
      const nickelPlayBtn = document.getElementById('btn-nickel-play');
      nickelPlayBtn && (nickelPlayBtn.innerHTML = '▶');
    } else {
      engine.nickelPlanner.onStatus?.('⚠️ 请点击灰色的金属连线作为算法起点');
    }
    return;
  }

  // 🔥 点焊模式：点击镍片生成路径
  if (currentTool === 'welder') {
    if (cellData.busbarId) {
      (engine.welder as any).lastBusbarId = cellData.busbarId;
      engine.welder.calculateOptimalPath(cellData.busbarId, currentDoc, engine.get3DPos.bind(engine));

      btnPlay?.removeAttribute('disabled');
      btnPrev?.removeAttribute('disabled');
      btnNext?.removeAttribute('disabled');
      btnPlay && (btnPlay.innerHTML = '▶');
    } else {
      engine.welder.onStatusChange?.('⚠️ 请点击灰色的金属镍片带，不要点电芯外壳');
    }
    return;
  }

  // 原万用表逻辑
  if (currentTool === 'multimeter') {
    const infoBox = document.getElementById('cell-info-box');
    infoBox?.classList.remove('hidden');
    document.getElementById('info-id') && (document.getElementById('info-id')!.innerText = cellData.id);
    document.getElementById('info-pol') && (document.getElementById('info-pol')!.innerText = cellData.polarity === 'positive' ? '正极 (+)' : '负极 (-)');
    document.getElementById('info-v') && (document.getElementById('info-v')!.innerText = `${cellData.voltage} V`);
    document.getElementById('info-r') && (document.getElementById('info-r')!.innerText = `${cellData.resistance} mΩ`);

    if (probedCells.length >= 2) {
      probedCells = [];
      engine.clearProbes();
    }

    probedCells.push({ id: cellData.id, voltage: parseFloat(cellData.voltage) || 3.7 });
    const color = probedCells.length === 1 ? '#ef4444' : '#000000';
    engine.addProbeMarker(intersectPoint, color, normal);

    const status = document.getElementById('probe-status');
    const lcd = document.getElementById('lcd-v');

    if (probedCells.length === 1) {
      status && (status.innerText = `红表笔 → ${cellData.id}`);
      status && (status.style.color = '#ef4444');
      lcd && (lcd.innerText = '0.00');
    } else {
      status && (status.innerText = `测量：${probedCells[0].id} ↔ ${probedCells[1].id}`);
      status && (status.style.color = '#10b981');
      lcd && (lcd.innerText = calculateTopologyVoltage(probedCells[0].id, probedCells[1].id, currentDoc));
    }
  }

  if (currentTool === 'bms') {
    if (!currentDoc.bmsWires) currentDoc.bmsWires = [];
    const idx = currentDoc.bmsWires.findIndex((w: any) => w.cellId === cellData.id);
    if (idx !== -1) {
      currentDoc.bmsWires.splice(idx, 1);
    } else {
      currentDoc.bmsWires.push({ cellId: cellData.id });
    }
    engine.renderBMS(currentDoc);
  }
});

document.getElementById('btn-reset-probes')?.addEventListener('click', () => {
  probedCells = [];
  engine.clearProbes();
  document.getElementById('lcd-v') && (document.getElementById('lcd-v')!.innerText = '0.00');
  document.getElementById('probe-status') && (document.getElementById('probe-status')!.innerText = '请点击金属极耳');
});

// =============================================
// 🌟 新增：统计信息UI更新函数
// =============================================
function updateStatsUI(doc: any, isDragging: boolean) {
  const stats = document.getElementById('stats-display')!;
  // 强制使用可选链 ?. 防止极端情况下的 undefined
  const cellCount = doc.cells?.length || 0;
  const busbarCount = doc.busbars?.length || 0;

  stats.innerHTML = `<span style="color:#38bdf8">📡 实时同步中</span><br>电芯: ${cellCount} | 镍片: ${busbarCount}`;
  if (isDragging) {
    stats.style.borderLeft = "4px solid #f59e0b";
    stats.style.paddingLeft = "8px";
  } else {
    stats.style.borderLeft = "4px solid #10b981";
    stats.style.paddingLeft = "8px";
    setTimeout(() => {
      stats.style.borderLeft = "none";
      stats.style.paddingLeft = "0";
    }, 500);
  }
}

// =============================================
// 🌟 重构：WebRTC智能数据清洗与分流引擎
// =============================================
let peer: Peer;
let connections: any[] = [];


function initNetwork() {
  const id = `3D-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  peer = new Peer(id, {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    }
  });

  peer.on('open', (id) => {
    document.getElementById('my-peer-id') && (document.getElementById('my-peer-id')!.innerText = id);
  });

  peer.on('connection', handleConnection);
}

function handleConnection(conn: any) {
  connections.push(conn);
  conn.on('open', () => {
    document.getElementById('net-status')!.innerText = `✅ 已直连 2D 引擎: ${conn.peer}`;
    document.getElementById('net-status')!.style.color = '#10b981';
  });

  conn.on('data', (data: any) => {
    // 过滤无关的鼠标光标移动事件
    if (data.cursor || data.type === 'cursor') return;

    let incomingDoc = data.doc ? data.doc : data;
    if (!incomingDoc.cells && data.data && data.data.doc) {
      incomingDoc = data.data.doc;
    }

    // 🚨 终极安全校验：防止 undefined 引发 TypeError 崩溃
    if (!incomingDoc || !Array.isArray(incomingDoc.cells)) return;

    // 强制初始化缺失的数组
    const inCells = incomingDoc.cells;
    const inBusbars = Array.isArray(incomingDoc.busbars) ? incomingDoc.busbars : [];
    const inBms = Array.isArray(incomingDoc.bmsWires) ? incomingDoc.bmsWires : [];

    if (!currentDoc) {
      // 第一次连接，执行全量加载
      currentDoc = { cells: inCells, busbars: inBusbars, bmsWires: inBms };
      engine.loadBatteryPack(currentDoc);
      updateStatsUI(currentDoc, false);
      return;
    }

    // 🚨 核心逻辑：精准判定是否为"局部拖拽包"
    // 判定条件：
    // 1. 数据明确标记为 drag
    // 2. 数据完全缺失 busbars 字段
    // 3. 只发送了不到一半的电芯且没有镍片数据
    let isPartialDrag = false;
    if (data.type === 'drag' || data.action === 'drag' || data.isDrag || incomingDoc.busbars === undefined) {
      isPartialDrag = true;
    } else if (inCells.length > 0 && inCells.length < currentDoc.cells.length * 0.5 && inBusbars.length === 0) {
      isPartialDrag = true;
    }

    if (isPartialDrag) {
      // 🚀 模式 A：拖拽高性能局部刷新
      inCells.forEach((ic: any) => {
        const target = currentDoc.cells.find((c: any) => c.id === ic.id);
        if (target) {
          target.cx = ic.cx;
          target.cy = ic.cy;
        }
      });
      engine.refreshPositions(currentDoc);
      updateStatsUI(currentDoc, true);
    } else {
      // 🚀 模式 B：全量状态智能Diff（增加、删除、连线）
      currentDoc = { cells: inCells, busbars: inBusbars, bmsWires: inBms };
      engine.syncBatteryPack(currentDoc); // 呼叫Diff大脑
      updateStatsUI(currentDoc, false);
    }
  });
}

document.getElementById('btn-connect-peer')?.addEventListener('click', () => {
  const target = (document.getElementById('target-peer-id') as HTMLInputElement).value.trim().toUpperCase();
  if (target) {
    document.getElementById('net-status') && (document.getElementById('net-status')!.innerText = `🚀 连接中：${target}`);
    handleConnection(peer.connect(target));
  }
});

initNetwork();

// =============================================
// 7. 本地导入
// =============================================
document.getElementById('file-upload')?.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target?.result as string);
      if (data?.doc) {
        currentDoc = data.doc;
        engine.loadBatteryPack(currentDoc);
        updateStatsUI(currentDoc, false);
      }
    } catch {
      alert('JSON 解析失败');
    }
  };
  reader.readAsText(file);
});

// =============================================
// 🌟 重构：统一面板关闭按钮逻辑
// =============================================
['multi', 'net', 'welder', 'nickel'].forEach(suffix => {
  document.getElementById(`btn-close-${suffix}`)?.addEventListener('click', () => {
    switchTool('pointer'); // 点击关闭时，强制退回默认鼠标指针状态
  });
});

// 🔥 点焊 CAM 仿真控制器
const btnPlay = document.getElementById('btn-weld-play') as HTMLButtonElement | null;
const btnPrev = document.getElementById('btn-weld-prev') as HTMLButtonElement | null;
const btnNext = document.getElementById('btn-weld-next') as HTMLButtonElement | null;

engine.welder.onStepChange = (step, total, currentCellId) => {
  const percent = total === 0 ? 0 : (step / total) * 100;
  document.getElementById('weld-progress-bar')?.style.setProperty('width', `${percent}%`);
  document.getElementById('weld-step-text') && (document.getElementById('weld-step-text')!.innerText = `Step ${step} / ${total}`);
  document.getElementById('weld-target-id') && (document.getElementById('weld-target-id')!.innerHTML = `目标电芯: <strong style="color:#f97316">${currentCellId}</strong>`);

  if (step >= total && total > 0 && btnPlay) {
    btnPlay.innerHTML = '↺';
  }
};

engine.welder.onStatusChange = (status) => {
  document.getElementById('weld-status') && (document.getElementById('weld-status')!.innerHTML = status);
};

btnPlay?.addEventListener('click', () => {
  if (btnPlay.innerHTML.includes('↺')) {
    const lastId = (engine.welder as any).lastBusbarId;
    if (lastId) {
      engine.welder.calculateOptimalPath(lastId, currentDoc, engine.get3DPos.bind(engine));
      engine.welder.play();
      btnPlay.innerHTML = '⏸';
    }
  } else if (btnPlay.innerHTML.includes('▶')) {
    engine.welder.play();
    btnPlay.innerHTML = '⏸';
  } else {
    engine.welder.pause();
    btnPlay.innerHTML = '▶';
  }
});

btnPrev?.addEventListener('click', () => {
  engine.welder.prevStep();
  btnPlay && (btnPlay.innerHTML = '▶');
});

btnNext?.addEventListener('click', () => {
  engine.welder.nextStep();
  btnPlay && (btnPlay.innerHTML = '▶');
});

// 镍片排布播放器控制
engine.nickelPlanner.onProgress = (step, total, info) => {
  const percent = total === 0 ? 0 : (step / total) * 100;
  document.getElementById('nickel-progress-bar')?.style.setProperty('width', `${percent}%`);
  document.getElementById('nickel-step-text') && (document.getElementById('nickel-step-text')!.innerText = `已贴装 ${step} / ${total} 条`);
  document.getElementById('nickel-info-text') && (document.getElementById('nickel-info-text')!.innerText = info);

  if (step >= total && total > 0) {
    document.getElementById('btn-nickel-play') && (document.getElementById('btn-nickel-play')!.innerHTML = '⏸');
  }
};

engine.nickelPlanner.onStatus = (status) => {
  document.getElementById('nickel-status') && (document.getElementById('nickel-status')!.innerHTML = status);
};

// 播放/暂停按钮
document.getElementById('btn-nickel-play')?.addEventListener('click', (e) => {
  const btn = e.target as HTMLButtonElement;
  if (btn.innerHTML.includes('▶')) {
    engine.nickelPlanner.play();
    btn.innerHTML = '⏸';
  } else {
    engine.nickelPlanner.pause();
    btn.innerHTML = '▶';
  }
});

// 上一步按钮
document.getElementById('btn-nickel-prev')?.addEventListener('click', () => {
  engine.nickelPlanner.prevStep();
  const nickelPlayBtn = document.getElementById('btn-nickel-play');
  nickelPlayBtn && (nickelPlayBtn.innerHTML = '▶');
});

// 下一步按钮
document.getElementById('btn-nickel-next')?.addEventListener('click', () => {
  engine.nickelPlanner.nextStep();
  const nickelPlayBtn = document.getElementById('btn-nickel-play');
  nickelPlayBtn && (nickelPlayBtn.innerHTML = '▶');
});

// 重置按钮（核心修复：重置时恢复所有镍片显示）
document.getElementById('btn-nickel-reset')?.addEventListener('click', () => {
  engine.nickelPlanner.reset();
  engine.showAllBusbars();
  const nickelPlayBtn = document.getElementById('btn-nickel-play');
  nickelPlayBtn && (nickelPlayBtn.innerHTML = '▶');
});
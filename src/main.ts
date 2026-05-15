import { Engine3D } from './scene/Engine3D';
import Peer from 'peerjs';

const engine = new Engine3D('canvas-container');

let currentDoc: any = null;
let probedCells: { id: string, voltage: number }[] = [];
let currentTool: 'pointer' | 'multimeter' | 'bms' | 'network' = 'pointer';

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
  document.getElementById('bright-val')!.innerText = `${val}%`;
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
// 🌟 1. 更安全的窗口拖拽 (避免吞噬关闭按钮)
// =============================================
function makeDraggable(panelId: string, handleId: string) {
  const panel = document.getElementById(panelId)!;
  const handle = document.getElementById(handleId)!;
  let isDragging = false, offsetX = 0, offsetY = 0;

  handle.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).classList.contains('close-btn')) return;

    isDragging = true;
    const rect = panel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    panel.style.transition = 'none';
    document.querySelectorAll('.draggable-panel').forEach(p => (p as HTMLElement).style.zIndex = '10');
    panel.style.zIndex = '20';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = `${e.clientX - offsetX}px`;
    panel.style.top = `${e.clientY - offsetY}px`;
    panel.style.bottom = 'auto';
    panel.style.right = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      panel.style.transition = 'opacity 0.3s';
    }
  });
}
makeDraggable('multimeter-ui', 'drag-header-multi');
makeDraggable('network-ui', 'drag-header-net');

// =============================================
// 3. FAB 菜单 & 工具切换
// =============================================
const fabContainer = document.getElementById('fab-container')!;
const multimeterUI = document.getElementById('multimeter-ui')!;
const networkUI = document.getElementById('network-ui')!;

document.getElementById('fab-main')?.addEventListener('click', () => {
  fabContainer.classList.toggle('open');
});

const switchTool = (tool: 'pointer' | 'multimeter' | 'bms' | 'network') => {
  currentTool = tool;
  document.querySelectorAll('.fab-item').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`tool-${tool}`)?.classList.add('active');

  multimeterUI.classList.toggle('hidden', tool !== 'multimeter');
  networkUI.classList.toggle('hidden', tool !== 'network');

  if (tool !== 'multimeter') {
    probedCells = [];
    engine.clearProbes();
  }

  fabContainer.classList.remove('open');
};

document.getElementById('tool-pointer')?.addEventListener('click', () => switchTool('pointer'));
document.getElementById('tool-multimeter')?.addEventListener('click', () => switchTool('multimeter'));
document.getElementById('tool-bms')?.addEventListener('click', () => switchTool('bms'));
document.getElementById('tool-network')?.addEventListener('click', () => switchTool('network'));

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

  if (currentTool === 'multimeter') {
    const infoBox = document.getElementById('cell-info-box')!;
    infoBox.classList.remove('hidden');
    document.getElementById('info-id')!.innerText = cellData.id;
    document.getElementById('info-pol')!.innerText = cellData.polarity === 'positive' ? '正极 (+)' : '负极 (-)';
    document.getElementById('info-v')!.innerText = `${cellData.voltage} V`;
    document.getElementById('info-r')!.innerText = `${cellData.resistance} mΩ`;

    if (probedCells.length >= 2) {
      probedCells = [];
      engine.clearProbes();
    }

    probedCells.push({ id: cellData.id, voltage: parseFloat(cellData.voltage) || 3.7 });
    const color = probedCells.length === 1 ? '#ef4444' : '#000000';
    engine.addProbeMarker(intersectPoint, color, normal);

    const status = document.getElementById('probe-status')!;
    const lcd = document.getElementById('lcd-v')!;

    if (probedCells.length === 1) {
      status.innerText = `红表笔 → ${cellData.id}`;
      status.style.color = '#ef4444';
      lcd.innerText = '0.00';
    } else {
      status.innerText = `测量：${probedCells[0].id} ↔ ${probedCells[1].id}`;
      status.style.color = '#10b981';
      lcd.innerText = calculateTopologyVoltage(probedCells[0].id, probedCells[1].id, currentDoc);
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
  document.getElementById('lcd-v')!.innerText = '0.00';
  document.getElementById('probe-status')!.innerText = '请点击金属极耳';
});

// =============================================
// 6. WebRTC 数字孪生同步引擎 (高性能局部刷新)
// =============================================
let peer: Peer;
let connections: any[] = [];
let firstLoadDone = false;

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
    document.getElementById('my-peer-id')!.innerText = id;
  });

  peer.on('connection', handleConnection);
}

function handleConnection(conn: any) {
  connections.push(conn);

  conn.on('open', () => {
    document.getElementById('net-status')!.innerText = `✅ 已成功直连 2D 引擎: ${conn.peer}`;
    document.getElementById('net-status')!.style.color = '#10b981';
  });

  conn.on('data', (data: any) => {
    if (data.cursor || data.type === 'cursor') return;

    let incomingDoc = data.doc ? data.doc : data;
    if (!incomingDoc.cells && data.data && data.data.doc) {
      incomingDoc = data.data.doc;
    }

    if (incomingDoc && incomingDoc.cells && Array.isArray(incomingDoc.cells)) {
      if (!incomingDoc.busbars) incomingDoc.busbars = [];
      if (!incomingDoc.bmsWires) incomingDoc.bmsWires = [];

      currentDoc = incomingDoc;

      // 🔥 核心：第一次全量加载，之后只刷新坐标 → 巨丝滑
      if (!firstLoadDone) {
        engine.loadBatteryPack(currentDoc);
        firstLoadDone = true;
      } else {
        engine.refreshPositions(currentDoc);
      }

      const stats = document.getElementById('stats-display')!;
      stats.innerHTML = `<span style="color:#38bdf8">📡 实时接收协同更新</span><br>电芯: ${currentDoc.cells.length} | 镍片: ${currentDoc.busbars.length}`;
      stats.style.borderLeft = "4px solid #38bdf8";
      stats.style.paddingLeft = "8px";

      setTimeout(() => {
        stats.style.borderLeft = "none";
        stats.style.paddingLeft = "0";
      }, 500);
    }
  });
}

document.getElementById('btn-connect-peer')?.addEventListener('click', () => {
  const target = (document.getElementById('target-peer-id') as HTMLInputElement).value.trim().toUpperCase();
  if (target) {
    document.getElementById('net-status')!.innerText = `🚀 连接中：${target}`;
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
        firstLoadDone = true;
        document.getElementById('stats-display')!.innerHTML = '✅ 模型已加载';
      }
    } catch {
      alert('JSON 解析失败');
    }
  };
  reader.readAsText(file);
});

// =============================================
// 🌟 2. 面板关闭按钮逻辑联动 FAB 菜单
// =============================================
document.getElementById('btn-close-multi')?.addEventListener('click', () => {
  document.getElementById('multimeter-ui')?.classList.add('hidden');
  document.getElementById('tool-multimeter')?.classList.remove('active');
  if (currentTool === 'multimeter') {
    currentTool = 'pointer';
    document.getElementById('tool-pointer')?.classList.add('active');
    probedCells = [];
    engine.clearProbes();
  }
});

document.getElementById('btn-close-net')?.addEventListener('click', () => {
  document.getElementById('network-ui')?.classList.add('hidden');
  document.getElementById('tool-network')?.classList.remove('active');
});
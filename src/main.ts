import { Engine3D } from './scene/Engine3D';
import * as THREE from 'three';

const engine = new Engine3D('canvas-container');

let currentDoc: any = null;
let probedCells: { id: string, voltage: number }[] = [];
let currentTool: 'pointer' | 'multimeter' | 'bms' = 'pointer'; // 🌟 全局状态机

// =============================================
// 1. UI 面板与图层控制 (保持原样)
// =============================================
document.getElementById('toggle-left-panel')?.addEventListener('click', () => document.getElementById('left-panel')?.classList.toggle('collapsed'));
document.getElementById('toggle-layer-panel')?.addEventListener('click', () => document.getElementById('layer-panel')?.classList.toggle('collapsed'));
document.getElementById('slider-brightness')?.addEventListener('input', (e) => {
  const val = (e.target as HTMLInputElement).value;
  document.getElementById('bright-val')!.innerText = `${val}%`;
  engine.setBrightness(parseInt(val));
});
['cells', 'busbars', 'bms', 'labels'].forEach(layer => {
  document.getElementById(`layer-${layer}`)?.addEventListener('change', (e) => engine.setLayerVisible(layer as any, (e.target as HTMLInputElement).checked));
});
document.getElementById('btn-reset-cam')?.addEventListener('click', () => engine.resetCamera());
document.getElementById('btn-auto-rotate')?.addEventListener('click', (e) => {
  const isRotating = engine.toggleAutoRotate();
  const btn = e.target as HTMLButtonElement;
  btn.classList.toggle('active', isRotating);
  btn.innerText = isRotating ? '⏹️ 停止旋转' : '🔄 自动旋转';
});
document.getElementById('toggle-wireframe')?.addEventListener('change', (e) => engine.setWireframe((e.target as HTMLInputElement).checked));

// =============================================
// 2. 🌟 FAB 菜单状态机与工具切换
// =============================================
const fabContainer = document.getElementById('fab-container')!;
const multimeterUI = document.getElementById('multimeter-ui')!;

document.getElementById('fab-main')?.addEventListener('click', () => {
  fabContainer.classList.toggle('open');
});

const switchTool = (tool: 'pointer' | 'multimeter' | 'bms') => {
  currentTool = tool;
  document.querySelectorAll('.fab-item').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`tool-${tool}`)?.classList.add('active');

  if (tool === 'multimeter') {
    multimeterUI.classList.remove('hidden');
  } else {
    multimeterUI.classList.add('hidden');
    probedCells = [];
    engine.clearProbes();
  }
  fabContainer.classList.remove('open'); // 选完收起菜单
};

document.getElementById('tool-pointer')?.addEventListener('click', () => switchTool('pointer'));
document.getElementById('tool-multimeter')?.addEventListener('click', () => switchTool('multimeter'));
document.getElementById('tool-bms')?.addEventListener('click', () => switchTool('bms'));

// =============================================
// 3. 🌟 操作系统级窗口拖拽 (Draggable UI)
// =============================================
const dragHeader = document.getElementById('drag-header')!;
let isDragging = false, offsetX = 0, offsetY = 0;

dragHeader.addEventListener('mousedown', (e) => {
  isDragging = true;
  const rect = multimeterUI.getBoundingClientRect();
  offsetX = e.clientX - rect.left;
  offsetY = e.clientY - rect.top;
  multimeterUI.style.transition = 'none'; // 拖拽时取消过渡，防止延迟跟手
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  // 动态覆盖 fixed 布局的约束
  multimeterUI.style.left = `${e.clientX - offsetX}px`;
  multimeterUI.style.top = `${e.clientY - offsetY}px`;
  multimeterUI.style.bottom = 'auto';
  multimeterUI.style.right = 'auto';
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    multimeterUI.style.transition = 'opacity 0.3s'; // 恢复渐变动画
  }
});

// =============================================
// 4. 🌟 拓扑引擎算法 (计算电位差)
// =============================================
function calculateTopologyVoltage(idA: string, idB: string, doc: any): string {
  if (idA === idB) return "0.00";
  const graph: Record<string, string[]> = {};
  doc.cells.forEach((c: any) => graph[c.id] = []);
  doc.busbars.forEach((b: any) => {
    if (graph[b.from] && graph[b.to]) { graph[b.from].push(b.to); graph[b.to].push(b.from); }
  });

  const queue: { id: string, steps: number }[] = [{ id: idA, steps: 0 }];
  const visited = new Set<string>([idA]);
  let pathLength = -1;

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr.id === idB) { pathLength = curr.steps; break; }
    graph[curr.id].forEach(neighbor => {
      if (!visited.has(neighbor)) { visited.add(neighbor); queue.push({ id: neighbor, steps: curr.steps + 1 }); }
    });
  }

  if (pathLength === -1) return "OL (开路)";
  const singleV = parseFloat(doc.cells[0].voltage) || 3.7;
  return (Math.ceil(pathLength / 2) * singleV).toFixed(2);
}

// =============================================
// 5. 🌟 3D 射线交互大脑 (融合万用表与 3D 飞线编辑)
// =============================================
engine.onCellClick((cellData, intersectPoint, normal) => {
  if (!currentDoc) return;

  // A: 万用表测量模式
  if (currentTool === 'multimeter') {
    const infoBox = document.getElementById('cell-info-box')!;
    infoBox.classList.remove('hidden');
    document.getElementById('info-id')!.innerText = cellData.id;
    document.getElementById('info-pol')!.innerText = cellData.polarity === 'positive' ? '正极 (+)' : '负极 (-)';
    document.getElementById('info-v')!.innerText = `${cellData.voltage} V`;
    document.getElementById('info-r')!.innerText = `${cellData.resistance} mΩ`;

    if (probedCells.length >= 2) { probedCells = []; engine.clearProbes(); }

    probedCells.push({ id: cellData.id, voltage: parseFloat(cellData.voltage) || 3.7 });
    const probeColor = probedCells.length === 1 ? '#ef4444' : '#000000';
    engine.addProbeMarker(intersectPoint, probeColor, normal); // 传入法线，永不穿模！

    const statusEl = document.getElementById('probe-status')!;
    const lcdEl = document.getElementById('lcd-v')!;
    if (probedCells.length === 1) {
      statusEl.innerText = `红表笔接入 ${cellData.id}，请接入黑表笔...`;
      statusEl.style.color = '#ef4444';
      lcdEl.innerText = '0.00';
    } else if (probedCells.length === 2) {
      statusEl.innerText = `测量完成: ${probedCells[0].id} ↔ ${probedCells[1].id}`;
      statusEl.style.color = '#10b981';
      lcdEl.innerText = calculateTopologyVoltage(probedCells[0].id, probedCells[1].id, currentDoc);
    }
  }
  // B: 3D 实时 BMS 飞线模式
  else if (currentTool === 'bms') {
    if (!currentDoc.bmsWires) currentDoc.bmsWires = [];

    // 查找是否已经有飞线，有则拔除，无则焊接
    const existingIdx = currentDoc.bmsWires.findIndex((w: any) => w.cellId === cellData.id);
    if (existingIdx !== -1) {
      currentDoc.bmsWires.splice(existingIdx); // 切断此线之后的排序
    } else {
      currentDoc.bmsWires.push({ cellId: cellData.id });
    }

    // 触发引擎局部重绘
    engine.renderBMS(currentDoc);
  }
});

document.getElementById('btn-reset-probes')?.addEventListener('click', () => {
  probedCells = []; engine.clearProbes();
  document.getElementById('lcd-v')!.innerText = '0.00';
  document.getElementById('probe-status')!.innerText = '请点击金属极耳放置探针';
});

// =============================================
// 6. 导入逻辑
// =============================================
document.getElementById('file-upload')?.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target?.result as string);
      if (data && data.doc) {
        currentDoc = data.doc;
        engine.loadBatteryPack(currentDoc);
        document.getElementById('stats-display')!.innerHTML = `<span style="color:#10b981">✅ 模型已就绪</span>`;
      }
    } catch (err) { alert("JSON解析失败！"); }
  };
  reader.readAsText(file);
});
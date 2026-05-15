import { Engine3D } from './scene/Engine3D';
import * as THREE from 'three';

const engine = new Engine3D('canvas-container');

// --- 1. UI 面板折叠逻辑 ---
document.getElementById('toggle-left-panel')?.addEventListener('click', () => {
  document.getElementById('left-panel')?.classList.toggle('collapsed');
});

// --- 2. 亮度调节与图层控制 ---
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

// --- 3. 万用表与探针状态机 ---
let currentDoc: any = null;
let probedCells: { id: string, voltage: number }[] = [];

// 简易拓扑寻路算法 (计算两个电芯之间相差几个串联级)
function calculateTopologyVoltage(idA: string, idB: string, doc: any): string {
  if (idA === idB) return "0.00";

  // 构建基于 busbar 的无向图邻接表
  const graph: Record<string, string[]> = {};
  doc.cells.forEach((c: any) => graph[c.id] = []);
  doc.busbars.forEach((b: any) => {
    if (graph[b.from] && graph[b.to]) { graph[b.from].push(b.to); graph[b.to].push(b.from); }
  });

  // BFS 寻找最短串联路径步数 (近似电位差)
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

  if (pathLength === -1) return "OL (开路)"; // 没有物理连接

  // 假设系统并联数为 P，实际路径长需除以 2 (因为正负极两次跨越算作1级)
  // 这里做个近似仿真：每走一步如果是不同电位，则产生电压差
  // 工业级做法是引入 TopologyEngine，这里我们用简化的平均单体电压估算
  const singleV = parseFloat(doc.cells[0].voltage) || 3.7;
  const diff = Math.ceil(pathLength / 2) * singleV;
  return diff.toFixed(2);
}

// 监听 3D 场景中的射线点击
engine.onCellClick((cellData, intersectPoint) => {
  const multiUi = document.getElementById('multimeter-ui')!;
  const infoBox = document.getElementById('cell-info-box')!;
  multiUi.classList.remove('hidden');
  infoBox.classList.remove('hidden');

  // 刷新单体信息面板
  document.getElementById('info-id')!.innerText = cellData.id;
  document.getElementById('info-pol')!.innerText = cellData.polarity === 'positive' ? '正极 (+)' : '负极 (-)';
  document.getElementById('info-v')!.innerText = `${cellData.voltage} V`;
  document.getElementById('info-r')!.innerText = `${cellData.resistance} mΩ`;

  // 处理万用表探针逻辑 (最多 2 根针)
  if (probedCells.length >= 2) {
    probedCells = [];
    engine.clearProbes();
  }

  probedCells.push({ id: cellData.id, voltage: parseFloat(cellData.voltage) || 3.7 });
  const probeColor = probedCells.length === 1 ? '#ef4444' : '#000000'; // 第一根红表笔，第二根黑表笔
  engine.addProbeMarker(intersectPoint, probeColor);

  const statusEl = document.getElementById('probe-status')!;
  const lcdEl = document.getElementById('lcd-v')!;

  if (probedCells.length === 1) {
    statusEl.innerText = `红表笔已连接 ${cellData.id}，请点击另一个电芯接入黑表笔...`;
    statusEl.style.color = '#ef4444';
    lcdEl.innerText = '0.00';
  } else if (probedCells.length === 2 && currentDoc) {
    statusEl.innerText = `测量完成: 跨越测算 ${probedCells[0].id} 与 ${probedCells[1].id}`;
    statusEl.style.color = '#10b981';
    lcdEl.innerText = calculateTopologyVoltage(probedCells[0].id, probedCells[1].id, currentDoc);
  }
});

document.getElementById('btn-reset-probes')?.addEventListener('click', () => {
  probedCells = []; engine.clearProbes();
  document.getElementById('lcd-v')!.innerText = '0.00';
  document.getElementById('probe-status')!.innerText = '请使用鼠标点击电芯极耳放置探针';
  document.getElementById('probe-status')!.style.color = '#fbbf24';
});

// --- 4. 导入 CAD JSON ---
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
        document.getElementById('multimeter-ui')?.classList.remove('hidden');
        document.getElementById('stats-display')!.innerHTML = `<span style="color:#10b981">✅ 模型已就绪</span>`;
      }
    } catch (err) { alert("JSON解析失败！"); }
  };
  reader.readAsText(file);
});
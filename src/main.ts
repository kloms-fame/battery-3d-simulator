import { Engine3D } from './scene/Engine3D';

// 初始化 3D 引擎
const engine = new Engine3D('canvas-container');

// 监听文件上传
const fileUpload = document.getElementById('file-upload') as HTMLInputElement;
const statsDisplay = document.getElementById('stats-display')!;

fileUpload.addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const jsonStr = e.target?.result as string;
      const data = JSON.parse(jsonStr);

      if (data && data.doc) {
        // 将数据喂给 3D 引擎
        engine.loadBatteryPack(data.doc);

        // 更新面板状态
        statsDisplay.innerHTML = `
                    <span style="color:#10b981">✅ 模型加载成功</span><br><br>
                    电芯数量: <strong>${data.doc.cells.length}</strong> 节<br>
                    物理连线: <strong>${data.doc.busbars.length}</strong> 根<br>
                    BMS飞线: <strong>${data.doc.bmsWires ? data.doc.bmsWires.length : 0}</strong> 根<br><br>
                    <em>按住鼠标左键旋转视角<br>滚动滚轮缩放</em>
                `;
      } else {
        alert("无效的 Pack Architect JSON 格式！");
      }
    } catch (error) {
      console.error(error);
      alert("文件解析失败！");
    }
  };
  reader.readAsText(file);
});
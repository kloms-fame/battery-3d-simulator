import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class Engine3D {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;
    private packGroup: THREE.Group; // 管理整个电池包图元

    constructor(containerId: string) {
        const container = document.getElementById(containerId)!;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#0f172a');

        // 🔧 修复 1：扩大雾化范围与摄像机视野，解决“拉远消失”和“太暗”的问题
        this.scene.fog = new THREE.Fog('#0f172a', 500, 4000);
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 5000);
        this.camera.position.set(0, 400, 500);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // 💡 优化光照系统：增加全局环境光，使金属材质更有质感
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(100, 300, 150);
        dirLight.castShadow = true;
        this.scene.add(dirLight);

        const blueLight = new THREE.PointLight('#38bdf8', 2, 800);
        blueLight.position.set(-150, 100, -150);
        this.scene.add(blueLight);

        const gridHelper = new THREE.GridHelper(1000, 50, '#334155', '#1e293b');
        gridHelper.position.y = -33;
        this.scene.add(gridHelper);

        this.packGroup = new THREE.Group();
        this.scene.add(this.packGroup);

        window.addEventListener('resize', this.onWindowResize.bind(this));
        this.animate();
    }

    public loadBatteryPack(doc: any) {
        this.packGroup.clear(); // 清理旧模型

        const cells = doc.cells;
        if (!cells || cells.length === 0) return;

        // 🔧 修复 2：物理缩放映射因子。CAD 半径18px -> 3D 物理半径 9mm，比例正好是 0.5
        const scale = 0.5;

        // 计算 2D 矩阵按比例缩放后的中心点
        let sumX = 0, sumY = 0;
        cells.forEach((c: any) => { sumX += c.cx * scale; sumY += c.cy * scale; });
        const centerX = sumX / cells.length;
        const centerZ = sumY / cells.length;

        // 坐标转换器：将 CAD 的 (cx, cy) 转化为 3D 世界的 (x, z)
        const get3DPos = (cx: number, cy: number) => ({ x: cx * scale - centerX, z: cy * scale - centerZ });

        const radius = 9;
        const height = 65;

        // --- 1. 渲染电芯阵列 ---
        const geometry = new THREE.CylinderGeometry(radius, radius, height, 32);
        const posMat = new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.3, metalness: 0.5 });
        const negMat = new THREE.MeshStandardMaterial({ color: '#3b82f6', roughness: 0.3, metalness: 0.5 });
        const wrapMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.8 });
        const capGeometry = new THREE.CylinderGeometry(radius - 1, radius - 1, 2, 32);

        cells.forEach((c: any) => {
            const p = get3DPos(c.cx, c.cy);
            const cell3D = new THREE.Group();
            cell3D.position.set(p.x, 0, p.z);

            const wrapper = new THREE.Mesh(geometry, wrapMat);
            wrapper.castShadow = true;
            wrapper.receiveShadow = true;
            cell3D.add(wrapper);

            const topCap = new THREE.Mesh(capGeometry, c.polarity === 'positive' ? posMat : negMat);
            topCap.position.y = height / 2 + 0.5;
            const bottomCap = new THREE.Mesh(capGeometry, c.polarity === 'positive' ? negMat : posMat);
            bottomCap.position.y = -height / 2 - 0.5;

            cell3D.add(topCap, bottomCap);
            cell3D.userData = { type: 'cell', id: c.id, polarity: c.polarity, voltage: c.voltage, resistance: c.resistance };
            this.packGroup.add(cell3D);
        });

        // --- 2. 渲染工业级金属镍片 (Busbars) ---
        if (doc.busbars) {
            const nickelMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 1.0, roughness: 0.2 }); // 闪亮的高光金属
            doc.busbars.forEach((b: any) => {
                const c1 = cells.find((c: any) => c.id === b.from);
                const c2 = cells.find((c: any) => c.id === b.to);
                if (!c1 || !c2) return;

                const p1 = get3DPos(c1.cx, c1.cy);
                const p2 = get3DPos(c2.cx, c2.cy);

                const distance = Math.hypot(p2.x - p1.x, p2.z - p1.z);
                // 镍片长方体：宽 8mm，厚度 0.3mm，长度为两点距离
                const busbarGeo = new THREE.BoxGeometry(8, 0.3, distance);
                const busbarMesh = new THREE.Mesh(busbarGeo, nickelMat);

                // 判断连接高度：正面在顶部，反面在底部
                const yPos = (b.side === 'back') ? (-height / 2 - 2) : (height / 2 + 2);
                busbarMesh.position.set((p1.x + p2.x) / 2, yPos, (p1.z + p2.z) / 2);

                // 让镍片指向目标点
                busbarMesh.lookAt(p2.x, yPos, p2.z);
                this.packGroup.add(busbarMesh);
            });
        }

        // --- 3. 渲染 BMS 主板与 3D 立体贝塞尔排线 ---
        if (doc.bmsWires && doc.bmsWires.length > 0) {
            // 计算电池包边界，决定 BMS 放置位置
            const xs = cells.map((c: any) => get3DPos(c.cx, c.cy).x);
            const zs = cells.map((c: any) => get3DPos(c.cx, c.cy).z);
            const minX = Math.min(...xs), maxX = Math.max(...xs);
            const maxZ = Math.max(...zs);

            const bmsX = (minX + maxX) / 2;
            const bmsY = height / 2 + 20; // 悬浮在电池包上方
            const bmsZ = maxZ + 50; // 放置在电池包靠外侧

            // 生成暗黑赛博风 BMS 主板
            const boardWidth = Math.max(120, maxX - minX + 20);
            const bmsGeo = new THREE.BoxGeometry(boardWidth, 4, 30);
            const bmsMat = new THREE.MeshStandardMaterial({ color: '#020617', roughness: 0.9 });
            const bmsMesh = new THREE.Mesh(bmsGeo, bmsMat);
            bmsMesh.position.set(bmsX, bmsY, bmsZ);

            // 给主板加一圈发光的绿色电路边框
            const edges = new THREE.EdgesGeometry(bmsGeo);
            const lineMat = new THREE.LineBasicMaterial({ color: '#10b981', linewidth: 2 });
            const bmsOutline = new THREE.LineSegments(edges, lineMat);
            bmsMesh.add(bmsOutline);
            this.packGroup.add(bmsMesh);

            // 绘制立体飞线
            const colors = ['#ffffff', '#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7', '#f97316'];
            doc.bmsWires.forEach((bw: any, index: number) => {
                const cell = cells.find((c: any) => c.id === bw.cellId);
                if (!cell) return;

                const p = get3DPos(cell.cx, cell.cy);
                const color = colors[index % colors.length];

                // 起点：电芯极耳中心
                const startPt = new THREE.Vector3(p.x, height / 2 + 3, p.z);
                // 终点：BMS 主板前沿插槽处
                const endPt = new THREE.Vector3(bmsX, bmsY, bmsZ - 15);

                // 立体贝塞尔曲线控制点：让排线先向上拔起，再在空中平滑弯曲进入 BMS
                const cp1 = new THREE.Vector3(p.x, height / 2 + 45, p.z);
                const cp2 = new THREE.Vector3(bmsX, bmsY + 20, bmsZ - 20);

                const curve = new THREE.CubicBezierCurve3(startPt, cp1, cp2, endPt);
                // 沿曲线生成 3D 圆管体 (粗细 0.8mm)
                const tubeGeo = new THREE.TubeGeometry(curve, 64, 0.8, 8, false);
                const wireMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.4 });
                const wireMesh = new THREE.Mesh(tubeGeo, wireMat);

                wireMesh.castShadow = true;
                this.packGroup.add(wireMesh);
            });
        }
    }

    private onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    private animate() {
        requestAnimationFrame(this.animate.bind(this));
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}
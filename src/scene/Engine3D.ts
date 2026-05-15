import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WeldingSimulator } from './WeldingSimulator';
import { NickelLayoutPlanner } from './NickelLayoutPlanner';

export class Engine3D {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;

    // 新增：中心坐标与缩放系数（用于局部无损刷新）
    private centerX: number = 0;
    private centerZ: number = 0;
    private readonly scaleFactor: number = 0.5;

    // 焊接仿真器实例
    public welder: WeldingSimulator;
    public nickelPlanner: NickelLayoutPlanner;

    // 图层管理
    public groups = {
        cells: new THREE.Group(),
        busbars: new THREE.Group(),
        bms: new THREE.Group(),
        labels: new THREE.Group(),
        probes: new THREE.Group()
    };

    // 灯光管理
    private ambientLight: THREE.AmbientLight;
    private dirLight: THREE.DirectionalLight;

    // 射线检测
    private raycaster = new THREE.Raycaster();
    private mouse = new THREE.Vector2();
    private onCellClickHandler: ((cellData: any, intersectPoint: THREE.Vector3, normal: THREE.Vector3) => void) | null = null;

    constructor(containerId: string) {
        const container = document.getElementById(containerId)!;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#0f1219');
        this.scene.fog = new THREE.Fog('#0f1219', 500, 4000);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 5000);
        this.camera.position.set(0, 400, 500);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        container.appendChild(this.renderer.domElement);

        // 轨道控制器
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.autoRotateSpeed = 2.0;

        // 灯光系统
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(this.ambientLight);

        this.dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        this.dirLight.position.set(100, 300, 150);
        this.dirLight.castShadow = true;
        this.scene.add(this.dirLight);

        // 网格辅助
        const gridHelper = new THREE.GridHelper(1000, 50, '#334155', '#1e293b');
        gridHelper.position.y = -33;
        this.scene.add(gridHelper);

        // 加载所有图层
        Object.values(this.groups).forEach(g => this.scene.add(g));

        // 事件监听
        window.addEventListener('resize', this.onWindowResize.bind(this));
        container.addEventListener('pointerdown', this.onPointerDown.bind(this));

        // 实例化焊接仿真器
        this.welder = new WeldingSimulator(this.scene);
        this.nickelPlanner = new NickelLayoutPlanner(this.scene);

        this.animate();
    }

    // ==========================
    // 公开 API：视图控制
    // ==========================
    public resetCamera(): void {
        this.camera.position.set(0, 400, 500);
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    public toggleAutoRotate(): boolean {
        this.controls.autoRotate = !this.controls.autoRotate;
        return this.controls.autoRotate;
    }

    public setWireframe(isWireframe: boolean): void {
        this.scene.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material) {
                (child.material as THREE.MeshStandardMaterial).wireframe = isWireframe;
            }
        });
    }

    public setLayerVisible(layerName: keyof typeof this.groups, isVisible: boolean): void {
        if (this.groups[layerName]) this.groups[layerName].visible = isVisible;
    }

    public setBrightness(intensityPercent: number): void {
        const factor = intensityPercent / 100;
        this.ambientLight.intensity = 0.6 * factor;
        this.dirLight.intensity = 1.2 * factor;
    }

    // 🌟 隐藏指定ID的短连接镍片（不影响其他镍片）
    public hideSpecificBusbars(busbarIds: string[]): void {
        this.groups.busbars.children.forEach((mesh) => {
            if (mesh.userData && busbarIds.includes(mesh.userData.busbarId)) {
                mesh.visible = false;
            }
        });
    }

    // 🌟 恢复所有镍片的显示
    public showAllBusbars(): void {
        this.groups.busbars.children.forEach((mesh) => {
            mesh.visible = true;
        });
    }

    // ==========================
    // 核心：射线检测 + 法线交互
    // ==========================
    private onPointerDown(event: PointerEvent): void {
        if (event.target !== this.renderer.domElement) return;

        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const colliders = [...this.groups.cells.children, ...this.groups.busbars.children];
        const intersects = this.raycaster.intersectObjects(colliders, true);

        const validHit = intersects.find(hit => hit.object.userData.isTerminal && hit.face);
        if (!validHit || !this.onCellClickHandler) return;

        const normalMatrix = new THREE.Matrix3().getNormalMatrix(validHit.object.matrixWorld);
        if (!validHit.face) return;
        const worldNormal = validHit.face.normal.clone().applyMatrix3(normalMatrix).normalize();

        this.onCellClickHandler(validHit.object.userData, validHit.point, worldNormal);
    }

    public onCellClick(callback: (cellData: any, point: THREE.Vector3, normal: THREE.Vector3) => void): void {
        this.onCellClickHandler = callback;
    }

    // ==========================
    // 终极探针：永不穿模
    // ==========================
    public addProbeMarker(position: THREE.Vector3, color: string, normal: THREE.Vector3) {
        const geo = new THREE.ConeGeometry(3, 25, 16);
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, 0, 12.5);

        const mat = new THREE.MeshStandardMaterial({
            color: color,
            metalness: 0.9,
            roughness: 0.2
        });

        const probe = new THREE.Mesh(geo, mat);
        probe.position.copy(position);
        const target = position.clone().add(normal);
        probe.lookAt(target);

        this.groups.probes.add(probe);
    }

    public clearProbes(): void {
        this.groups.probes.clear();
    }

    // ==========================
    // 独立坐标转换器
    // ==========================
    public get3DPos(cx: number, cy: number) {
        return {
            x: cx * this.scaleFactor - this.centerX,
            z: cy * this.scaleFactor - this.centerZ
        };
    }

    // ==========================
    // BMS 渲染（带主板）
    // ==========================
    public renderBMS(doc: any) {
        this.groups.bms.clear();
        if (!doc.cells || !doc.bmsWires || doc.bmsWires.length === 0) return;

        const height = 65;
        const xs = doc.cells.map((c: any) => this.get3DPos(c.cx, c.cy).x);
        const zs = doc.cells.map((c: any) => this.get3DPos(c.cx, c.cy).z);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const maxZ = Math.max(...zs);

        const bmsX = (minX + maxX) / 2;
        const bmsY = height / 2 + 20;
        const bmsZ = maxZ + 50;

        // BMS 主板
        const boardWidth = Math.max(120, maxX - minX + 20);
        const bmsMesh = new THREE.Mesh(
            new THREE.BoxGeometry(boardWidth, 4, 30),
            new THREE.MeshStandardMaterial({ color: '#020617', roughness: 0.9 })
        );
        bmsMesh.position.set(bmsX, bmsY, bmsZ);

        const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(boardWidth, 4, 30));
        const edgeMat = new THREE.LineBasicMaterial({ color: '#10b981' });
        bmsMesh.add(new THREE.LineSegments(edgeGeo, edgeMat));
        this.groups.bms.add(bmsMesh);

        // BMS 飞线
        const colors = ['#fff', '#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7', '#f97316'];
        doc.bmsWires.forEach((bw: any, i: number) => {
            const cell = doc.cells.find((c: any) => c.id === bw.cellId);
            if (!cell) return;

            const p = this.get3DPos(cell.cx, cell.cy);
            const curve = new THREE.CubicBezierCurve3(
                new THREE.Vector3(p.x, height / 2 + 3, p.z),
                new THREE.Vector3(p.x, height / 2 + 45, p.z),
                new THREE.Vector3(bmsX, bmsY + 20, bmsZ - 20),
                new THREE.Vector3(bmsX, bmsY, bmsZ - 15)
            );

            const wire = new THREE.Mesh(
                new THREE.TubeGeometry(curve, 64, 0.8, 8, false),
                new THREE.MeshStandardMaterial({ color: colors[i % colors.length] })
            );

            this.groups.bms.add(wire);
        });
    }

    // ==========================
    // 独立镍片渲染
    // ==========================
    public renderBusbars(doc: any) {
        this.groups.busbars.clear();
        if (!doc.busbars || doc.busbars.length === 0) return;

        const nickelMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 1.0 });
        const height = 65;

        doc.busbars.forEach((b: any) => {
            const c1 = doc.cells.find((c: any) => c.id === b.from);
            const c2 = doc.cells.find((c: any) => c.id === b.to);
            if (!c1 || !c2) return;

            const p1 = this.get3DPos(c1.cx, c1.cy);
            const p2 = this.get3DPos(c2.cx, c2.cy);
            const distance = Math.hypot(p2.x - p1.x, p2.z - p1.z);
            if (distance < 0.1) return;

            const busbarMesh = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, distance), nickelMat);
            const yPos = b.side === 'back' ? -height / 2 - 2 : height / 2 + 2;
            busbarMesh.position.set((p1.x + p2.x) / 2, yPos, (p1.z + p2.z) / 2);
            busbarMesh.lookAt(p2.x, yPos, p2.z);
            // 🌟 核心：注入 busbarId，让射线检测知道我们点的是哪条特定的金属带
            busbarMesh.userData = {
                isTerminal: true,
                busbarId: b.id,  // 记录属于哪段镍片连接
                id: c1.id,       // 继承一个电芯ID用于万用表
                polarity: c1.polarity,
                voltage: c1.voltage || '3.7',
                resistance: c1.resistance || '15'
            };
            this.groups.busbars.add(busbarMesh);
        });
    }

    // ==========================
    // 🌟 新增：独立电芯3D网格生成器
    // ==========================
    private createCellMesh(c: any, p: { x: number, z: number }) {
        const radius = 9, height = 65;
        const geometry = new THREE.CylinderGeometry(radius, radius, height, 32);
        const posMat = new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.3, metalness: 0.5 });
        const negMat = new THREE.MeshStandardMaterial({ color: '#3b82f6', roughness: 0.3, metalness: 0.5 });
        const wrapMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.8 });
        const capGeometry = new THREE.CylinderGeometry(radius - 1, radius - 1, 2, 32);

        const cell3D = new THREE.Group();
        cell3D.position.set(p.x, 0, p.z);
        cell3D.userData = { id: c.id };

        const wrapper = new THREE.Mesh(geometry, wrapMat);
        const topCap = new THREE.Mesh(capGeometry, c.polarity === 'positive' ? posMat : negMat);
        topCap.position.y = height / 2 + 0.5;
        const bottomCap = new THREE.Mesh(capGeometry, c.polarity === 'positive' ? negMat : posMat);
        bottomCap.position.y = -height / 2 - 0.5;

        // 绑定电气属性供万用表读取
        topCap.userData = {
            isTerminal: true,
            id: c.id,
            polarity: c.polarity,
            voltage: c.voltage || '3.7',
            resistance: c.resistance || '15'
        };
        bottomCap.userData = { ...topCap.userData };

        cell3D.add(wrapper, topCap, bottomCap);
        this.groups.cells.add(cell3D);

        const label = this.createSpriteLabel(c.id);
        label.position.set(p.x, height / 2 + 15, p.z);
        label.userData = { id: c.id };
        this.groups.labels.add(label);
    }

    // ==========================
    // 🌟 重构：初始全量加载
    // ==========================
    public loadBatteryPack(doc: any) {
        Object.values(this.groups).forEach(g => g.clear());
        if (!doc || !doc.cells || !Array.isArray(doc.cells) || doc.cells.length === 0) return;

        let sumX = 0, sumY = 0;
        doc.cells.forEach((c: any) => {
            sumX += c.cx * this.scaleFactor;
            sumY += c.cy * this.scaleFactor;
        });
        this.centerX = sumX / doc.cells.length;
        this.centerZ = sumY / doc.cells.length;

        doc.cells.forEach((c: any) => this.createCellMesh(c, this.get3DPos(c.cx, c.cy)));
        this.renderBusbars(doc);
        this.renderBMS(doc);
    }

    // ==========================
    // 🌟 新增：True Diff智能拓扑同步引擎
    // 解决：增加/删除电芯不显示、全量更新卡顿问题
    // ==========================
    public syncBatteryPack(doc: any) {
        if (!doc || !doc.cells || !Array.isArray(doc.cells)) return;

        // 重新计算中心点，防止删除/增加边缘电芯导致整体坐标系跑偏
        let sumX = 0, sumY = 0;
        doc.cells.forEach((c: any) => {
            sumX += c.cx * this.scaleFactor;
            sumY += c.cy * this.scaleFactor;
        });
        this.centerX = doc.cells.length > 0 ? sumX / doc.cells.length : 0;
        this.centerZ = doc.cells.length > 0 ? sumY / doc.cells.length : 0;

        const incomingIds = new Set(doc.cells.map((c: any) => c.id));
        const cellsGroup = this.groups.cells;
        const labelsGroup = this.groups.labels;

        // A. 智能删除：对比发现旧的有，新的没有，立刻删掉
        for (let i = cellsGroup.children.length - 1; i >= 0; i--) {
            const child = cellsGroup.children[i];
            if (!incomingIds.has(child.userData.id)) {
                cellsGroup.remove(child);
                const label = labelsGroup.children.find(l => l.userData.id === child.userData.id);
                if (label) labelsGroup.remove(label);
            }
        }

        // B. 智能增加与坐标平滑更新
        doc.cells.forEach((c: any) => {
            const p = this.get3DPos(c.cx, c.cy);
            const existing = cellsGroup.children.find(obj => obj.userData.id === c.id);
            if (existing) {
                // 如果存在，仅更新位置（绝不销毁重建）
                existing.position.set(p.x, 0, p.z);
                const label = labelsGroup.children.find(l => l.userData.id === c.id);
                if (label) label.position.set(p.x, 65 / 2 + 15, p.z);
            } else {
                // 如果不存在，立刻凭空生成新电芯
                this.createCellMesh(c, p);
            }
        });

        // 镍片和BMS线数量较少且计算快，直接重新生成确保连接无误
        this.renderBusbars(doc);
        this.renderBMS(doc);
    }

    // ==========================
    // 🌟 重构：高频局部拖拽更新
    // 严格禁止重算中心点！防止拖拽时整个电池包跳动
    // ==========================
    public refreshPositions(doc: any) {
        if (!doc || !doc.cells) return;
        const height = 65;
        doc.cells.forEach((c: any) => {
            const p = this.get3DPos(c.cx, c.cy); // 直接使用原有锚点
            const cell3D = this.groups.cells.children.find(obj => obj.userData.id === c.id);
            if (cell3D) cell3D.position.set(p.x, 0, p.z);
            const label = this.groups.labels.children.find(obj => obj.userData.id === c.id);
            if (label) label.position.set(p.x, height / 2 + 15, p.z);
        });

        // 拖拽时镍片需要跟着拉伸
        this.renderBusbars(doc);
        this.renderBMS(doc);
    }

    // ==========================
    // 3D文字标签
    // ==========================
    private createSpriteLabel(text: string): THREE.Sprite {
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 64;
        const ctx = canvas.getContext('2d')!;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
        ctx.roundRect(0, 0, 128, 64, 16);
        ctx.fill();

        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.font = 'bold 32px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 64, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(16, 8, 1);
        return sprite;
    }

    // ==========================
    // 基础渲染
    // ==========================
    private onWindowResize(): void {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    private animate(): void {
        requestAnimationFrame(this.animate.bind(this));
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}
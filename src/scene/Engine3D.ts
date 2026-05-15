import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class Engine3D {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;

    // 图层管理
    public groups = {
        cells: new THREE.Group(),
        busbars: new THREE.Group(),
        bms: new THREE.Group(),
        labels: new THREE.Group(),
        probes: new THREE.Group() // 万用表探针图层
    };

    // 灯光管理
    private ambientLight: THREE.AmbientLight;
    private dirLight: THREE.DirectionalLight;

    // 射线检测 (Raycasting)
    private raycaster = new THREE.Raycaster();
    private mouse = new THREE.Vector2();
    private onCellClickHandler: ((cellData: any, intersectPoint: THREE.Vector3) => void) | null = null;

    constructor(containerId: string) {
        const container = document.getElementById(containerId)!;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#0f172a');
        this.scene.fog = new THREE.Fog('#0f172a', 500, 4000);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 5000);
        this.camera.position.set(0, 400, 500);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;

        // 灯光
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(this.ambientLight);
        this.dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        this.dirLight.position.set(100, 300, 150);
        this.scene.add(this.dirLight);

        const gridHelper = new THREE.GridHelper(1000, 50, '#334155', '#1e293b');
        gridHelper.position.y = -33;
        this.scene.add(gridHelper);

        // 加入所有图层
        Object.values(this.groups).forEach(g => this.scene.add(g));

        window.addEventListener('resize', this.onWindowResize.bind(this));

        // 🌟 绑定射线点击事件
        container.addEventListener('pointerdown', this.onPointerDown.bind(this));

        this.animate();
    }

    // --- 图层与亮度控制 API ---
    public setLayerVisible(layerName: keyof typeof this.groups, isVisible: boolean) {
        if (this.groups[layerName]) this.groups[layerName].visible = isVisible;
    }

    public setBrightness(intensityPercent: number) {
        const factor = intensityPercent / 100;
        this.ambientLight.intensity = 0.6 * factor;
        this.dirLight.intensity = 1.2 * factor;
    }

    // --- 射线检测逻辑 ---
    private onPointerDown(event: PointerEvent) {
        // 将鼠标位置归一化为设备坐标 [-1, 1]
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        // 只检测电芯图层中的物体
        const intersects = this.raycaster.intersectObjects(this.groups.cells.children, true);

        if (intersects.length > 0 && this.onCellClickHandler) {
            // 向上遍历寻找挂载了 userData 的 Group
            let object: THREE.Object3D | null = intersects[0].object;
            while (object && !object.userData.id) {
                object = object.parent;
            }
            if (object && object.userData.id) {
                this.onCellClickHandler(object.userData, intersects[0].point);
            }
        }
    }

    public onCellClick(callback: (cellData: any, point: THREE.Vector3) => void) {
        this.onCellClickHandler = callback;
    }

    // --- 万用表探针视觉生成器 ---
    public addProbeMarker(position: THREE.Vector3, color: string) {
        const geo = new THREE.ConeGeometry(4, 20, 16);
        const mat = new THREE.MeshStandardMaterial({ color: color, metalness: 0.8 });
        const probe = new THREE.Mesh(geo, mat);
        // 探针尖端朝下对准点击位置
        probe.position.copy(position);
        probe.position.y += 10;
        probe.rotation.x = Math.PI;
        this.groups.probes.add(probe);
    }

    public clearProbes() {
        this.groups.probes.clear();
    }

    // --- 创建 3D 文字标签精灵 ---
    private createSpriteLabel(text: string): THREE.Sprite {
        const canvas = document.createElement('canvas');
        canvas.width = 128; canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
        ctx.roundRect(0, 0, 128, 64, 16); ctx.fill();
        ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 4; ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 64, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(16, 8, 1);
        return sprite;
    }

    // --- 核心加载逻辑 ---
    public loadBatteryPack(doc: any) {
        Object.values(this.groups).forEach(g => g.clear()); // 清理全场

        const cells = doc.cells;
        if (!cells || cells.length === 0) return;

        const scale = 0.5;
        let sumX = 0, sumY = 0;
        cells.forEach((c: any) => { sumX += c.cx * scale; sumY += c.cy * scale; });
        const centerX = sumX / cells.length, centerZ = sumY / cells.length;
        const get3DPos = (cx: number, cy: number) => ({ x: cx * scale - centerX, z: cy * scale - centerZ });

        const radius = 9, height = 65;
        const geometry = new THREE.CylinderGeometry(radius, radius, height, 32);
        const posMat = new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.3, metalness: 0.5 });
        const negMat = new THREE.MeshStandardMaterial({ color: '#3b82f6', roughness: 0.3, metalness: 0.5 });
        const wrapMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.8 });
        const capGeometry = new THREE.CylinderGeometry(radius - 1, radius - 1, 2, 32);

        // 1. 电芯与标签
        cells.forEach((c: any) => {
            const p = get3DPos(c.cx, c.cy);
            const cell3D = new THREE.Group();
            cell3D.position.set(p.x, 0, p.z);

            const wrapper = new THREE.Mesh(geometry, wrapMat);
            const topCap = new THREE.Mesh(capGeometry, c.polarity === 'positive' ? posMat : negMat);
            topCap.position.y = height / 2 + 0.5;
            const bottomCap = new THREE.Mesh(capGeometry, c.polarity === 'positive' ? negMat : posMat);
            bottomCap.position.y = -height / 2 - 0.5;

            cell3D.add(wrapper, topCap, bottomCap);
            // 🌟 注入数据供射线读取
            cell3D.userData = { id: c.id, polarity: c.polarity, voltage: c.voltage || '3.7', resistance: c.resistance || '15' };
            this.groups.cells.add(cell3D);

            // 🌟 悬浮标签
            const label = this.createSpriteLabel(c.id);
            label.position.set(p.x, height / 2 + 15, p.z);
            this.groups.labels.add(label);
        });

        // 2. 镍片 (略缩版，逻辑同上一版)
        if (doc.busbars) {
            const nickelMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 1.0 });
            doc.busbars.forEach((b: any) => {
                const c1 = cells.find((c: any) => c.id === b.from), c2 = cells.find((c: any) => c.id === b.to);
                if (!c1 || !c2) return;
                const p1 = get3DPos(c1.cx, c1.cy), p2 = get3DPos(c2.cx, c2.cy);
                const busbarMesh = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, Math.hypot(p2.x - p1.x, p2.z - p1.z)), nickelMat);
                const yPos = (b.side === 'back') ? (-height / 2 - 2) : (height / 2 + 2);
                busbarMesh.position.set((p1.x + p2.x) / 2, yPos, (p1.z + p2.z) / 2);
                busbarMesh.lookAt(p2.x, yPos, p2.z);
                this.groups.busbars.add(busbarMesh);
            });
        }

        // 3. BMS 飞线 (略缩版，逻辑同上一版)
        if (doc.bmsWires && doc.bmsWires.length > 0) {
            const bmsX = Math.max(...cells.map((c: any) => get3DPos(c.cx, c.cy).x)) + 30;
            const bmsZ = Math.max(...cells.map((c: any) => get3DPos(c.cx, c.cy).z)) + 30;
            doc.bmsWires.forEach((bw: any, i: number) => {
                const cell = cells.find((c: any) => c.id === bw.cellId);
                if (!cell) return;
                const p = get3DPos(cell.cx, cell.cy);
                const colors = ['#ffffff', '#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7'];
                const curve = new THREE.CubicBezierCurve3(
                    new THREE.Vector3(p.x, height / 2 + 3, p.z), new THREE.Vector3(p.x, height / 2 + 45, p.z),
                    new THREE.Vector3(bmsX, height / 2 + 20, bmsZ - 20), new THREE.Vector3(bmsX, height / 2 + 20, bmsZ - 15)
                );
                const wireMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.8, 8, false), new THREE.MeshStandardMaterial({ color: colors[i % colors.length] }));
                this.groups.bms.add(wireMesh);
            });
        }
    }

    private onWindowResize() { this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(window.innerWidth, window.innerHeight); }
    private animate() { requestAnimationFrame(this.animate.bind(this)); this.controls.update(); this.renderer.render(this.scene, this.camera); }
}
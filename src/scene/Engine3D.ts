import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class Engine3D {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;
    private cellGroup: THREE.Group;

    constructor(containerId: string) {
        const container = document.getElementById(containerId)!;

        // 1. 初始化场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#0f172a'); // 暗黑背景
        this.scene.fog = new THREE.Fog('#0f172a', 100, 1000);

        // 2. 初始化相机
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.set(0, 300, 400);

        // 3. 初始化渲染器
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);

        // 4. 控制器 (允许鼠标拖拽旋转、缩放)
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        // 5. 光照系统 (赛博朋克风打光)
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(100, 200, 50);
        dirLight.castShadow = true;
        this.scene.add(dirLight);

        // 蓝色轮廓光 (增加科技感)
        const blueLight = new THREE.PointLight('#38bdf8', 1, 500);
        blueLight.position.set(-100, -50, -100);
        this.scene.add(blueLight);

        // 添加网格辅助线
        const gridHelper = new THREE.GridHelper(1000, 50, '#334155', '#1e293b');
        gridHelper.position.y = -33; // 放在 18650 电池 (高65) 的底部
        this.scene.add(gridHelper);

        this.cellGroup = new THREE.Group();
        this.scene.add(this.cellGroup);

        // 窗口缩放适配
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // 启动渲染循环
        this.animate();
    }

    // 🌟 核心：将 Easy_Battery_Tool 的 JSON 转化为 3D 实体
    public loadBatteryPack(doc: any) {
        // 清理旧模型
        while (this.cellGroup.children.length > 0) {
            this.cellGroup.remove(this.cellGroup.children[0]);
        }

        const cells = doc.cells;
        if (!cells || cells.length === 0) return;

        // 计算 2D 矩阵的中心点，用于在 3D 世界中居中显示
        let sumX = 0, sumY = 0;
        cells.forEach((c: any) => { sumX += c.cx; sumY += c.cy; });
        const centerX = sumX / cells.length;
        const centerY = sumY / cells.length;

        // 18650 物理尺寸参数
        const radius = 9;
        const height = 65;

        // 创建通用的材质和几何体优化性能
        const geometry = new THREE.CylinderGeometry(radius, radius, height, 32);
        const posMaterial = new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.3, metalness: 0.8 }); // 正极红
        const negMaterial = new THREE.MeshStandardMaterial({ color: '#3b82f6', roughness: 0.3, metalness: 0.8 }); // 负极蓝
        const wrapperMaterial = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.6, metalness: 0.2 }); // 电池外皮机甲灰

        cells.forEach((c: any) => {
            // 🌟 核心映射：2D(X,Y) -> 3D(X,Z)，由于屏幕Y向下为正，3D Z向外为正，所以需要调整
            const x3d = c.cx - centerX;
            const z3d = c.cy - centerY;

            // 电池实体 (组装包裹层和两极)
            const cell3D = new THREE.Group();
            cell3D.position.set(x3d, 0, z3d);

            // 1. 电池主体外皮
            const wrapper = new THREE.Mesh(geometry, wrapperMaterial);
            wrapper.castShadow = true;
            wrapper.receiveShadow = true;
            cell3D.add(wrapper);

            // 2. 正/负极贴片 (顶部和底部)
            const capGeometry = new THREE.CylinderGeometry(radius - 1, radius - 1, 2, 32);

            const topCap = new THREE.Mesh(capGeometry, c.polarity === 'positive' ? posMaterial : negMaterial);
            topCap.position.y = height / 2 + 0.5; // 放在顶部

            const bottomCap = new THREE.Mesh(capGeometry, c.polarity === 'positive' ? negMaterial : posMaterial);
            bottomCap.position.y = -height / 2 - 0.5; // 放在底部

            cell3D.add(topCap);
            cell3D.add(bottomCap);

            // 保存自定义数据供后续万用表射线检测使用
            cell3D.userData = { id: c.id, polarity: c.polarity, voltage: c.voltage, resistance: c.resistance };

            this.cellGroup.add(cell3D);
        });

        console.log(`成功生成 ${cells.length} 个 3D 电芯`);
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
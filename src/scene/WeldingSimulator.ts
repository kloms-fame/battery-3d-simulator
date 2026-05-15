import * as THREE from 'three';

export class WeldingSimulator {
    private scene: THREE.Scene;
    private welderGroup: THREE.Group;
    private sparks: THREE.PointLight;

    // 路径与状态数据
    private currentPath: THREE.Vector3[] = [];
    private currentCellIds: string[] = [];
    private currentStep: number = 0;
    private isPlaying: boolean = false;
    private isAnimating: boolean = false; // 正在执行单步动画时锁定
    private targetSide: 'front' | 'back' = 'front';

    // UI 回调接口
    public onStepChange: ((step: number, total: number, cellId: string) => void) | null = null;
    public onStatusChange: ((status: string) => void) | null = null;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.welderGroup = new THREE.Group();
        this.scene.add(this.welderGroup);

        // 1. 构建工业级紫铜双针探头
        const copperMat = new THREE.MeshStandardMaterial({ color: '#b87333', metalness: 0.9, roughness: 0.2 });
        const pinGeo = new THREE.CylinderGeometry(0.8, 0.2, 12, 16);
        pinGeo.translate(0, 6, 0); // 让针尖对齐原点，方便法线和坐标定位

        const pin1 = new THREE.Mesh(pinGeo, copperMat);
        pin1.position.set(-1.5, 0, 0);
        const pin2 = new THREE.Mesh(pinGeo, copperMat);
        pin2.position.set(1.5, 0, 0);

        // 探头基座 (绝缘工程塑料)
        const baseGeo = new THREE.BoxGeometry(6, 4, 4);
        baseGeo.translate(0, 14, 0);
        const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: '#1e293b' }));

        this.welderGroup.add(pin1, pin2, base);
        this.welderGroup.visible = false; // 默认隐藏

        // 2. 焊接火花光效
        this.sparks = new THREE.PointLight('#fbbf24', 0, 80);
        this.sparks.position.set(0, 1, 0);
        this.welderGroup.add(this.sparks);
    }

    // 🌟 核心一：贪心最近邻算法 (Greedy Nearest Neighbor) 提取并计算最优路径
    public calculateOptimalPath(clickedBusbarId: string, doc: any, get3DPos: (cx: number, cy: number) => { x: number, z: number }) {
        const startBar = doc.busbars.find((b: any) => b.id === clickedBusbarId);
        if (!startBar) return;

        this.targetSide = startBar.side || 'front';

        // 1. 广度优先搜索 (BFS) 找出与这根镍片相连的整个局部网络
        const graph: Record<string, string[]> = {};
        doc.cells.forEach((c: any) => graph[c.id] = []);
        doc.busbars.filter((b: any) => b.side === this.targetSide).forEach((b: any) => {
            if (graph[b.from] && graph[b.to]) { graph[b.from].push(b.to); graph[b.to].push(b.from); }
        });

        const connectedCells = new Set<string>();
        const queue = [startBar.from];
        while (queue.length > 0) {
            const curr = queue.shift()!;
            if (!connectedCells.has(curr)) {
                connectedCells.add(curr);
                graph[curr].forEach(neighbor => queue.push(neighbor));
            }
        }

        const cellNodes = Array.from(connectedCells).map(id => {
            const c = doc.cells.find((cell: any) => cell.id === id);
            return { id: c.id, pos: get3DPos(c.cx, c.cy) };
        });

        if (cellNodes.length === 0) return;

        // 2. 贪心算法规划最短防交叉路径
        const optimizedPath: typeof cellNodes = [];
        const unvisited = new Set(cellNodes);

        // 启发式寻找最左侧的点作为起点，符合一般装配习惯
        let currNode = Array.from(unvisited).sort((a, b) => a.pos.x - b.pos.x)[0];

        while (unvisited.size > 0) {
            optimizedPath.push(currNode);
            unvisited.delete(currNode);
            if (unvisited.size === 0) break;

            let nearestDist = Infinity;
            let nearestNode = null;
            unvisited.forEach(node => {
                const dist = Math.hypot(node.pos.x - currNode.pos.x, node.pos.z - currNode.pos.z);
                if (dist < nearestDist) { nearestDist = dist; nearestNode = node; }
            });
            currNode = nearestNode!;
        }

        // 3. 将 2D 最优节点转化为 3D 物理空间坐标
        const height = 65;
        const surfaceY = this.targetSide === 'back' ? -height / 2 - 2.5 : height / 2 + 2.5;

        this.currentPath = optimizedPath.map(node => new THREE.Vector3(node.pos.x, surfaceY, node.pos.z));
        this.currentCellIds = optimizedPath.map(n => n.id);

        this.currentStep = 0;
        this.isPlaying = false;

        // 4. 重置探头位置并悬停在安全高度 (Z-Hop)
        this.welderGroup.visible = true;
        this.welderGroup.rotation.x = this.targetSide === 'back' ? Math.PI : 0; // 反面打焊需翻转探头180度
        const safeHoverOffset = new THREE.Vector3(0, this.targetSide === 'back' ? -20 : 20, 0);
        this.welderGroup.position.copy(this.currentPath[0]).add(safeHoverOffset);

        this.updateUI();
        if (this.onStatusChange) this.onStatusChange("✅ 最优路径规划完毕，等待执行");
    }

    // --- 播放器控制状态机 ---
    public play() {
        if (this.currentPath.length === 0 || this.currentStep >= this.currentPath.length) return;
        this.isPlaying = true;
        if (!this.isAnimating) this.executeWeldStep();
    }

    public pause() {
        this.isPlaying = false;
    }

    public nextStep() {
        this.pause();
        if (!this.isAnimating && this.currentStep < this.currentPath.length) this.executeWeldStep();
    }

    public prevStep() {
        this.pause();
        if (!this.isAnimating && this.currentStep > 0) {
            this.currentStep--;
            // 瞬间移动到上一个位置的安全高度
            const safeHoverOffset = new THREE.Vector3(0, this.targetSide === 'back' ? -20 : 20, 0);
            this.welderGroup.position.copy(this.currentPath[this.currentStep]).add(safeHoverOffset);
            this.updateUI();
        }
    }

    public reset() {
        this.pause();
        this.welderGroup.visible = false;
        this.currentPath = [];
        this.currentStep = 0;
        this.updateUI();
    }

    private updateUI() {
        if (this.onStepChange) {
            const displayId = this.currentCellIds[this.currentStep] || '--';
            this.onStepChange(this.currentStep, this.currentPath.length, displayId);
        }
    }

    // 🌟 核心二：真实的 Z-Hop 点焊物理动画算法
    private executeWeldStep() {
        if (this.currentStep >= this.currentPath.length) {
            this.isPlaying = false;
            if (this.onStatusChange) this.onStatusChange("🎉 当前镍片组点焊任务完成");
            return;
        }

        this.isAnimating = true;
        const targetPos = this.currentPath[this.currentStep];

        // 安全抬起高度向量 (Z-Hop)，避免撞击 BMS 线
        const zHopOffset = new THREE.Vector3(0, this.targetSide === 'back' ? -20 : 20, 0);

        const startPos = this.welderGroup.position.clone();
        const hoverEnd = targetPos.clone().add(zHopOffset); // 目标上空的安全点

        let progress = 0;
        const animate = () => {
            progress += 0.05; // 播放速度调整

            if (progress < 1.0) {
                // 阶段 1：在安全高度水平移动到目标上方 (XY 轴插值)
                this.welderGroup.position.lerpVectors(startPos, hoverEnd, progress);
                requestAnimationFrame(animate);
            } else if (progress < 1.5) {
                // 阶段 2：垂直下压进行点焊 (Z 轴插值)
                const plungeProgress = (progress - 1.0) * 2;
                this.welderGroup.position.lerpVectors(hoverEnd, targetPos, plungeProgress);
                requestAnimationFrame(animate);
            } else if (progress < 1.8) {
                // 阶段 3：爆发强光，模拟打靶火花
                this.sparks.intensity = Math.random() * 200 + 50;
                requestAnimationFrame(animate);
            } else if (progress < 2.3) {
                // 阶段 4：收起火花，垂直抬起恢复到安全 Z-Hop 高度
                this.sparks.intensity = 0;
                const liftProgress = (progress - 1.8) * 2;
                this.welderGroup.position.lerpVectors(targetPos, hoverEnd, liftProgress);
                requestAnimationFrame(animate);
            } else {
                // 单步完成
                this.currentStep++;
                this.updateUI();
                this.isAnimating = false;

                // 如果处于连续播放状态，继续下一帧
                if (this.isPlaying) {
                    setTimeout(() => this.executeWeldStep(), 150); // 留出视觉停顿感
                }
            }
        };
        animate();
    }
}
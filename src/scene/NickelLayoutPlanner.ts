import * as THREE from 'three';

// 镍条数据结构
export interface NickelStrip {
    id: string;
    startCellId: string;
    endCellId: string;
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    length: number;
    layerIndex: number; // 0 为底层，1 为重叠层
    estimatedResistance: string;
}

export class NickelLayoutPlanner {
    private scene: THREE.Scene;
    public layoutGroup: THREE.Group;

    private targetStrips: NickelStrip[] = [];
    private currentStep: number = 0;
    private isPlaying: boolean = false;
    private isAnimating: boolean = false;

    // UI 回调
    public onProgress: ((step: number, total: number, stripInfo: string) => void) | null = null;
    public onStatus: ((status: string) => void) | null = null;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.layoutGroup = new THREE.Group();
        this.scene.add(this.layoutGroup);
    }

    // 🌟 核心算法：贪心共线合并与分层排列
    public calculateLayout(clickedBusbarId: string, doc: any, get3DPos: (cx: number, cy: number) => { x: number, z: number }): string[] {
        const startBar = doc.busbars.find((b: any) => b.id === clickedBusbarId);
        if (!startBar) return []; // 失败返回空数组

        const targetSide = startBar.side || 'front';
        const height = 65;
        const baseSurfaceY = targetSide === 'back' ? -height / 2 - 2.0 : height / 2 + 2.0;

        // 1. 寻找属于同一等电位面的所有短连接
        const localBusbars: any[] = [];
        const visited = new Set<string>();
        const queue = [startBar.id];

        while (queue.length > 0) {
            const currId = queue.shift()!;
            if (visited.has(currId)) continue;
            visited.add(currId);

            const b = doc.busbars.find((x: any) => x.id === currId);
            if (b) {
                localBusbars.push(b);
                // 寻找共用节点的相邻连线
                doc.busbars.filter((x: any) => x.side === targetSide && (x.from === b.from || x.from === b.to || x.to === b.from || x.to === b.to))
                    .forEach((x: any) => { if (!visited.has(x.id)) queue.push(x.id); });
            }
        }

        // 🌟 提取所有参与合并的原始短线ID
        const originalBusbarIds = localBusbars.map(b => b.id);

        // 2. 贪心共线合并 (合并相邻且斜率相同的短线，变成长条镍片)
        let mergedStrips: any[] = [];
        let remaining = [...localBusbars];

        while (remaining.length > 0) {
            let currentStrip = [remaining.shift()!];
            let changed = true;

            while (changed) {
                changed = false;
                // 获取当前镍条两端的坐标
                let head = doc.cells.find((c: any) => c.id === currentStrip[0].from);
                let tail = doc.cells.find((c: any) => c.id === currentStrip[currentStrip.length - 1].to);

                if (!head || !tail) break;
                let slopeX = tail.cx - head.cx;
                let slopeY = tail.cy - head.cy;

                for (let i = 0; i < remaining.length; i++) {
                    const candidate = remaining[i];
                    const candCell = doc.cells.find((c: any) => c.id === candidate.to || c.id === candidate.from);
                    if (!candCell) continue;

                    // 判断是否首尾相连
                    const connectsToTail = candidate.from === tail.id || candidate.to === tail.id;
                    const connectsToHead = candidate.from === head.id || candidate.to === head.id;

                    if (connectsToTail || connectsToHead) {
                        const targetCellId = connectsToTail ?
                            (candidate.from === tail.id ? candidate.to : candidate.from) :
                            (candidate.from === head.id ? candidate.to : candidate.from);

                        const targetCell = doc.cells.find((c: any) => c.id === targetCellId);
                        if (!targetCell) continue;

                        // 向量叉乘判断共线 (Tolerance: 近似0)
                        let newSlopeX = targetCell.cx - (connectsToTail ? tail.cx : head.cx);
                        let newSlopeY = targetCell.cy - (connectsToTail ? tail.cy : head.cy);
                        let crossProduct = slopeX * newSlopeY - slopeY * newSlopeX;

                        if (Math.abs(crossProduct) < 0.1) {
                            if (connectsToTail) currentStrip.push(candidate);
                            else currentStrip.unshift(candidate);
                            remaining.splice(i, 1);
                            changed = true;
                            break;
                        }
                    }
                }
            }
            mergedStrips.push(currentStrip);
        }

        // 3. 构建 3D 物理条带，并分配层级防重叠
        this.targetStrips = mergedStrips.map((stripArr, index) => {
            const startCell = doc.cells.find((c: any) => c.id === stripArr[0].from);
            const endCell = doc.cells.find((c: any) => c.id === stripArr[stripArr.length - 1].to);

            const p1 = get3DPos(startCell.cx, startCell.cy);
            const p2 = get3DPos(endCell.cx, endCell.cy);
            const length = Math.hypot(p2.x - p1.x, p2.z - p1.z);

            // 交叉检测分配 Layer (0 或 1，模拟镍片叠层)
            const layerIndex = index % 2;
            const yPos = baseSurfaceY + (targetSide === 'back' ? -layerIndex * 0.4 : layerIndex * 0.4);

            return {
                id: `Strip-${index + 1}`,
                startCellId: startCell.id,
                endCellId: endCell.id,
                startPos: new THREE.Vector3(p1.x, yPos, p1.z),
                endPos: new THREE.Vector3(p2.x, yPos, p2.z),
                length: length,
                layerIndex: layerIndex,
                // 估算内阻 (假设 0.15*8mm 纯镍，电阻率约 9.6e-8)
                estimatedResistance: ((length * 9.6) / (8 * 0.15)).toFixed(2)
            };
        });

        // 排序：先铺底层，再铺叠加层
        this.targetStrips.sort((a, b) => a.layerIndex - b.layerIndex);

        this.layoutGroup.clear();
        this.currentStep = 0;
        this.isPlaying = false;

        if (this.onStatus) this.onStatus(`✅ 路径拓扑优化完毕，共整合为 ${this.targetStrips.length} 条长镍片。`);
        this.updateUI();

        return originalBusbarIds; // 🌟 返回所有被合并的原始镍片ID
    }

    public play() {
        if (this.currentStep >= this.targetStrips.length) return;
        this.isPlaying = true;
        if (!this.isAnimating) this.animateNextStrip();
    }

    public pause() { this.isPlaying = false; }

    // 🌟 下一步：单步贴装一条长镍片
    public nextStep() {
        this.pause();
        if (!this.isAnimating && this.currentStep < this.targetStrips.length) {
            this.animateNextStrip();
        }
    }

    // 🌟 上一步：移除最后一条贴装好的长镍片
    public prevStep() {
        this.pause();
        if (!this.isAnimating && this.currentStep > 0) {
            this.currentStep--;
            // 移除3D场景中最后添加的镍片
            const lastStripMesh = this.layoutGroup.children[this.currentStep];
            if (lastStripMesh) {
                this.layoutGroup.remove(lastStripMesh);
            }
            this.updateUI();
        }
    }

    public reset() {
        this.pause();
        this.layoutGroup.clear();
        this.currentStep = 0;
        this.updateUI();
    }

    private updateUI() {
        if (this.onProgress) {
            const info = this.currentStep > 0 ?
                `[${this.targetStrips[this.currentStep - 1].id}] 估算内阻: ${this.targetStrips[this.currentStep - 1].estimatedResistance} mΩ` : "等待贴装";
            this.onProgress(this.currentStep, this.targetStrips.length, info);
        }
    }

    // 🌟 物理动画：模拟机械臂吸盘将整根长条镍片从空中精准压下贴装
    private animateNextStrip() {
        if (this.currentStep >= this.targetStrips.length) {
            this.isPlaying = false;
            if (this.onStatus) this.onStatus("🎉 所有长段镍条已按照防重叠时序摆放完毕！");
            return;
        }

        this.isAnimating = true;
        const stripData = this.targetStrips[this.currentStep];

        // 材质：极具科技感的闪耀镍金属
        const nickelMat = new THREE.MeshStandardMaterial({
            color: '#e2e8f0', metalness: 1.0, roughness: 0.1,
            emissive: '#38bdf8', emissiveIntensity: 0.5 // 刚放下去时带一点科技蓝光
        });

        const busbarMesh = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, stripData.length), nickelMat);

        // 目标位置
        const targetY = stripData.startPos.y;
        const center = new THREE.Vector3().addVectors(stripData.startPos, stripData.endPos).multiplyScalar(0.5);

        // 动画起始位置 (空中悬浮)
        const dropHeight = targetY + (targetY > 0 ? 40 : -40);
        busbarMesh.position.set(center.x, dropHeight, center.z);
        busbarMesh.lookAt(stripData.endPos.x, dropHeight, stripData.endPos.z);

        this.layoutGroup.add(busbarMesh);

        let progress = 0;
        const animate = () => {
            progress += 0.08;
            if (progress <= 1) {
                // 平滑下落
                busbarMesh.position.y = dropHeight - (dropHeight - targetY) * (1 - Math.pow(1 - progress, 3)); // EaseOut
                requestAnimationFrame(animate);
            } else {
                busbarMesh.position.y = targetY;
                nickelMat.emissiveIntensity = 0; // 熄灭高光

                this.currentStep++;
                this.updateUI();
                this.isAnimating = false;
                if (this.isPlaying) setTimeout(() => this.animateNextStrip(), 200);
            }
        };
        animate();
    }
}
// phone/relationMap.js
import { db } from './db.js';

document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('relation-network');
    if (!container) return;

    // --- 1. 加载数据 ---
    const [allChats, allRelations, globalSettings, allPersonas] = await Promise.all([
        db.chats.filter(c => !c.isGroup).toArray(),
        db.relationships.toArray(),
        db.globalSettings.get('main'),
        db.personaPresets.toArray()
    ]);

    // --- 2. 过滤掉不重要的“陌生人”关系 ---
    const significantRelations = allRelations.filter(rel => {
        const isStranger = rel.type === 'stranger' || !rel.type;
        const isLowScore = rel.score >= -100 && rel.score <= 100;
        // 如果是好感度低的陌生人，则过滤掉
        if (isStranger && isLowScore) {
            return false;
        }
        return true;
    });

    // --- 3. 准备节点 (Nodes) ---
    const nodes = new vis.DataSet();

    // 添加 User 的 Persona 节点
    allPersonas.forEach(persona => {
        nodes.add({
            id: `persona_${persona.id}`,
            label: persona.name,
            shape: 'image',
            image: persona.avatar || 'https://files.catbox.moe/kkll8p.svg',
            color: { background: '#ffffff', border: '#cccccc' },
            borderWidth: 4,
            size: 50,
            font: { color: '#333333', face: 'Inter', size: 16, strokeWidth: 1, strokeColor: 'white' }
        });
    });

    // 添加角色节点
    allChats.forEach(chat => {
        nodes.add({
            id: chat.id,
            label: chat.name,
            shape: 'circularImage',
            image: chat.settings.aiAvatar || 'https://files.catbox.moe/kkll8p.svg',
            font: { face: 'Inter' }
        });
    });

    // --- 4. 准备边 (Edges) ---
    const edges = new vis.DataSet();
    const relationTypeColors = {
        lover: '#e91e63', friend: '#4caf50', family: '#2196f3',
        rival: '#ff9800', stranger: '#9e9e9e'
    };
    
    // 创建一个从角色ID到PersonaID的映射
    const charIdToPersonaId = new Map();
    allPersonas.forEach(persona => {
        if (persona.appliedChats && persona.appliedChats.length > 0) {
            const appliedSet = new Set(persona.appliedChats.map(String));
            allChats.forEach(chat => {
                const chatGroupIdStr = chat.groupId ? String(chat.groupId) : null;
                if (appliedSet.has(chat.id) || (chatGroupIdStr && appliedSet.has(chatGroupIdStr))) {
                    charIdToPersonaId.set(chat.id, persona.id);
                }
            });
        }
    });

    // --- 处理角色与人格之间的关系 ---
    const userRelations = significantRelations.filter(r => r.targetCharId === 'user');
    userRelations.forEach(rel => {
        const charId = rel.sourceCharId;
        const charNode = nodes.get(charId);
        if (!charNode) return;

        const personaId = charIdToPersonaId.get(charId);
        if (!personaId) return;

        const score = rel.score;
        const type = rel.type || 'stranger';
        const color = relationTypeColors[type] || '#9e9e9e';
        const width = Math.max(1, (Math.abs(score) / 1000) * 6);
        const personaNodeId = `persona_${personaId}`;
        const persona = allPersonas.find(p => p.id === personaId);

        if (persona) {
            edges.add({
                from: charId,
                to: personaNodeId,
                width: width,
                label: String(score),
                color: color,
                smooth: { type: 'continuous' },
                title: `${charNode.label} → ${persona.name}<br>关系: ${type}<br>好感度: ${score}`
            });
        }
    });

    // --- 处理角色与角色之间的关系 ---
    const processedRelations = new Set();
    significantRelations.forEach(relA => {
        if (relA.sourceCharId === 'user' || relA.targetCharId === 'user') return;

        const sourceId = relA.sourceCharId;
        const targetId = relA.targetCharId;

        if (!nodes.get(sourceId) || !nodes.get(targetId) || processedRelations.has(`${sourceId}-${targetId}`)) {
            return;
        }

        const relB = significantRelations.find(r => r.sourceCharId === targetId && r.targetCharId === sourceId);

        const scoreA = relA.score;
        const typeA = relA.type || 'stranger';
        const colorA = relationTypeColors[typeA] || '#9e9e9e';
        const widthA = Math.max(1, (Math.abs(scoreA) / 1000) * 6);
        edges.add({
            from: sourceId,
            to: targetId,
            width: widthA,
            label: String(scoreA),
            color: colorA,
            smooth: { type: 'curvedCW', roundness: 0.2 },
            title: `${nodes.get(sourceId).label} → ${nodes.get(targetId).label}<br>关系: ${typeA}<br>好感度: ${scoreA}`
        });

        if (relB) {
            const scoreB = relB.score;
            const typeB = relB.type || 'stranger';
            const colorB = relationTypeColors[typeB] || '#9e9e9e';
            const widthB = Math.max(1, (Math.abs(scoreB) / 1000) * 6);
            edges.add({
                from: targetId,
                to: sourceId,
                width: widthB,
                label: String(scoreB),
                color: colorB,
                smooth: { type: 'curvedCCW', roundness: -0.2 },
                title: `${nodes.get(targetId).label} → ${nodes.get(sourceId).label}<br>关系: ${typeB}<br>好感度: ${scoreB}`
            });
        }

        processedRelations.add(`${sourceId}-${targetId}`);
        processedRelations.add(`${targetId}-${sourceId}`);
    });

    // --- 5. 配置选项 ---
    const options = {
        nodes: {
            borderWidth: 2, size: 40,
            color: { border: '#222222', background: '#666666' },
            font: { color: '#000000', size: 12, face: 'Inter' }
        },
        edges: {
            arrows: { to: { enabled: true, scaleFactor: 0.7 } },
            font: {
                color: '#ffffff', 
                size: 14,
                face: 'Inter',
                strokeWidth: 3, 
                strokeColor: 'rgba(0,0,0,0.8)', 
                align: 'middle'
            }
        },
        physics: {
            barnesHut: {
                gravitationalConstant: -15000,
                springConstant: 0.04,
                springLength: 200
            },
            minVelocity: 0.75
        },
        interaction: {
            tooltipDelay: 200,
            hideEdgesOnDrag: true
        }
    };

    // --- 6. 创建网络 ---
    const data = { nodes: nodes, edges: edges };
    const network = new vis.Network(container, data, options);

    // --- 7. 点击聚焦和取消聚焦的逻辑 ---
    network.on("selectNode", function (params) {
        const selectedNodeId = params.nodes[0];
        if (!selectedNodeId) return;

        // 获取所有与选中节点直接相连的边和节点
        const connectedEdges = edges.get({
            filter: edge => edge.from === selectedNodeId || edge.to === selectedNodeId
        });
        const connectedNodeIds = new Set([selectedNodeId]);
        connectedEdges.forEach(edge => {
            connectedNodeIds.add(edge.from);
            connectedNodeIds.add(edge.to);
        });
        
        const filteredNodes = nodes.get({
            filter: node => connectedNodeIds.has(node.id)
        });

        // 使用 setData 更新网络，只显示相关的节点和边
        network.setData({
            nodes: new vis.DataSet(filteredNodes),
            edges: new vis.DataSet(connectedEdges)
        });
    });

    network.on("deselectNode", function () {
        // 当取消选择时，恢复原始的完整数据集
        network.setData(data);
    });
});
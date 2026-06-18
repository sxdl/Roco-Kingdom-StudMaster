// common.js - 洛克王国宠物蛋组数据引擎（Bwiki 实时数据版）
// 数据来源：Bwiki MediaWiki:Egg.json（实时拉取，无需手动更新）

const BWIKI_EGG_JSON_URL = 'https://wiki.biligame.com/rocom/index.php?title=MediaWiki:Egg.json&action=raw';
const BWIKI_CACHE_KEY = 'bwiki_egg_cache';
const BWIKI_CACHE_TS_KEY = 'bwiki_egg_ts';
const CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6小时缓存，避免频繁请求

// ===== 全局状态 =====
let eggDataList = [];         // 原始 JSON 数组 [{id, name, eggGroups[]}]
let petToGroups = new Map();  // name.lower -> { id, name, groups: Set }
let groupToPets = new Map(); // 蛋组名 -> Set(name)
let petMatchCount = new Map();// name.lower -> 可配种宠物总数

// ===== 数据加载 =====
function loadEggData() {
    return new Promise((resolve, reject) => {
        // 尝试从缓存读取
        try {
            const cached = localStorage.getItem(BWIKI_CACHE_KEY);
            const ts = parseInt(localStorage.getItem(BWIKI_CACHE_TS_KEY) || '0');
            if (cached && (Date.now() - ts) < CACHE_DURATION_MS) {
                eggDataList = JSON.parse(cached);
                buildMappings();
                resolve(eggDataList);
                // 后台静默刷新（不阻塞 UI）
                fetchEggDataFromWiki().then(() => {}).catch(() => {});
                return;
            }
        } catch (e) {}

        // 缓存过期或不存在，从 wiki 拉取
        fetchEggDataFromWiki().then(resolve).catch(reject);
    });
}

function fetchEggDataFromWiki() {
    return fetch(BWIKI_EGG_JSON_URL)
        .then(res => {
            if (!res.ok) throw new Error('Bwiki 数据请求失败: ' + res.status);
            return res.json();
        })
        .then(data => {
            eggDataList = data;
            // 写入缓存
            try {
                localStorage.setItem(BWIKI_CACHE_KEY, JSON.stringify(data));
                localStorage.setItem(BWIKI_CACHE_TS_KEY, String(Date.now()));
            } catch (e) {}
            buildMappings();
            return data;
        });
}

// 强制刷新数据（绕过缓存）
function forceRefreshData() {
    return fetchEggDataFromWiki();
}

// ===== 构建映射 =====
function buildMappings() {
    petToGroups.clear();
    groupToPets.clear();
    petMatchCount.clear();

    // 收集所有蛋组名
    const allGroups = new Set();
    for (let item of eggDataList) {
        for (let g of (item.eggGroups || [])) {
            allGroups.add(g);
        }
    }
    for (let g of allGroups) groupToPets.set(g, new Set());

    // 映射：宠物名 -> 蛋组集合
    // 同名宠物（不同形态）共享蛋组（合并）
    for (let item of eggDataList) {
        let name = (item.name || '').trim();
        if (!name) continue;
        let lower = name.toLowerCase();

        if (!petToGroups.has(lower)) {
            petToGroups.set(lower, { id: item.id, name: name, groups: new Set() });
        }
        // 如果当前条目有 id 且 id 更小（更早编号），更新 id
        let entry = petToGroups.get(lower);
        if (item.id && (!entry.id || item.id < entry.id)) {
            entry.id = item.id;
        }
        if (item.name === name) {
            entry.name = name; // 保留不带括号的名称
        }

        for (let g of (item.eggGroups || [])) {
            entry.groups.add(g);
            if (groupToPets.has(g)) {
                groupToPets.get(g).add(name);
            }
        }
    }

    // 优先使用不带括号的名称（最小形态名称）
    for (let [lower, entry] of petToGroups.entries()) {
        if (lower.includes('（') || lower.includes('(')) continue; // 已是非括号版本
        // 检查是否有括号版本
        let baseName = entry.name;
        // 保留原来的名字
    }

    // 预计算可配种宠物总数
    for (let [lower, entry] of petToGroups.entries()) {
        const allPets = new Set();
        for (let g of entry.groups) {
            if (g === '无法孵蛋') continue;
            const pets = groupToPets.get(g);
            if (pets) {
                for (let p of pets) {
                    if (p !== entry.name) allPets.add(p);
                }
            }
        }
        petMatchCount.set(lower, allPets.size);
    }
}

// ===== 查询接口 =====
function getPetGroups(petName) {
    const lower = petName.toLowerCase();
    const entry = petToGroups.get(lower);
    return entry ? Array.from(entry.groups) : [];
}

function getAllPetNames() {
    return Array.from(petToGroups.values())
        .map(e => e.name)
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function getPetMatchCount(petName) {
    const lower = petName.toLowerCase();
    return petMatchCount.get(lower) || 0;
}

function getPetsByGroup(groupName) {
    const set = groupToPets.get(groupName);
    return set ? Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN')) : [];
}

function getAllEggGroups() {
    return Array.from(groupToPets.keys()).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function getStudRanking() {
    const list = [];
    for (let [lower, entry] of petToGroups.entries()) {
        const groups = Array.from(entry.groups).filter(g => g !== '无法孵蛋');
        if (groups.length < 2) continue;
        const matchCount = petMatchCount.get(lower) || 0;
        list.push({
            name: entry.name,
            groupsCount: groups.length,
            matchCount: matchCount,
            groups: groups
        });
    }
    list.sort((a, b) => {
        if (a.matchCount !== b.matchCount) return b.matchCount - a.matchCount;
        return b.groupsCount - a.groupsCount;
    });
    return list;
}

function getTotalStats() {
    let totalPets = petToGroups.size;
    let totalGroups = groupToPets.size;
    return { totalPets, totalGroups };
}

// ===== 导出（保留用于种公仓库备份） =====
function exportStudData() {
    const stored = localStorage.getItem('my_pets');
    return stored || '[]';
}

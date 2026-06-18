// common.js - 洛克王国宠物蛋组数据引擎（BWIKI 实时数据版）
// 数据来源：BWIKI MediaWiki API（origin=* 解决 CORS）
// 策略：每次加载 fetch 最新数据，缓存 6 小时

const BWIKI_API_URL = 'https://wiki.biligame.com/rocom/api.php?action=query&titles=MediaWiki:Egg.json&prop=revisions&rvprop=content&format=json&origin=*';
const CACHE_KEY = 'bwiki_egg_data';
const CACHE_TS_KEY = 'bwiki_egg_ts';
const CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6小时

// ===== 全局状态 =====
let eggDataList = [];
let petToGroups = new Map();
let groupToPets = new Map();
let petMatchCount = new Map();

// ===== 数据加载 =====
function loadEggData() {
    return new Promise((resolve, reject) => {
        // 1. 有有效缓存则直接用
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0');
            if (cached && (Date.now() - ts) < CACHE_DURATION_MS) {
                eggDataList = JSON.parse(cached);
                buildMappings();
                resolve(eggDataList);
                // 后台静默刷新
                fetchFromWiki().catch(() => {});
                return;
            }
        } catch (e) {}

        // 2. 缓存过期，在线拉取
        fetchFromWiki().then(resolve).catch(reject);
    });
}

function fetchFromWiki() {
    return fetch(BWIKI_API_URL)
        .then(res => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(apiResult => {
            const pages = apiResult.query.pages;
            let content = null;
            for (let pid in pages) {
                if (pages[pid].revisions) {
                    content = pages[pid].revisions[0]['*'];
                    break;
                }
            }
            if (!content) throw new Error('未找到 Egg.json 页面内容');
            const data = JSON.parse(content);
            eggDataList = data;
            // 写入缓存
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify(data));
                localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
            } catch (e) {}
            buildMappings();
            return data;
        });
}

// ===== 构建映射 =====
function buildMappings() {
    petToGroups.clear();
    groupToPets.clear();
    petMatchCount.clear();

    const allGroups = new Set();
    for (let item of eggDataList) {
        for (let g of (item.eggGroups || [])) allGroups.add(g);
    }
    for (let g of allGroups) groupToPets.set(g, new Set());

    for (let item of eggDataList) {
        let name = (item.name || '').trim();
        if (!name) continue;
        let lower = name.toLowerCase();
        if (!petToGroups.has(lower)) {
            petToGroups.set(lower, { id: item.id, name: name, groups: new Set() });
        }
        let entry = petToGroups.get(lower);
        if (item.id && (!entry.id || item.id < entry.id)) entry.id = item.id;
        for (let g of (item.eggGroups || [])) {
            entry.groups.add(g);
            if (groupToPets.has(g)) groupToPets.get(g).add(name);
        }
    }

    for (let [lower, entry] of petToGroups.entries()) {
        const allPets = new Set();
        for (let g of entry.groups) {
            if (g === '无法孵蛋') continue;
            const pets = groupToPets.get(g);
            if (pets) {
                for (let p of pets) { if (p !== entry.name) allPets.add(p); }
            }
        }
        petMatchCount.set(lower, allPets.size);
    }
}

// ===== 查询接口 =====
function getPetGroups(petName) {
    const entry = petToGroups.get(petName.toLowerCase());
    return entry ? Array.from(entry.groups) : [];
}

function getAllPetNames() {
    return Array.from(petToGroups.values())
        .map(e => e.name)
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function getPetMatchCount(petName) {
    return petMatchCount.get(petName.toLowerCase()) || 0;
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
        list.push({
            name: entry.name,
            groupsCount: groups.length,
            matchCount: petMatchCount.get(lower) || 0,
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
    return { totalPets: petToGroups.size, totalGroups: groupToPets.size };
}

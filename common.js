// common.js - 洛克王国宠物蛋组数据引擎（BWIKI 实时数据版）
// 数据来源：BWIKI MediaWiki API（origin=* 解决 CORS）
// 策略：每次加载 fetch 最新数据，缓存 6 小时

const BWIKI_API_URL = 'https://wiki.biligame.com/rocom/api.php?action=query&titles=MediaWiki:Egg.json&prop=revisions&rvprop=content&format=json&origin=*';
const CACHE_KEY = 'bwiki_egg_data';
const CACHE_TS_KEY = 'bwiki_egg_ts';
const CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6小时

// ===== 全局状态 =====
let eggDataList = [];
// 完整映射：每个形态独立（用于查询/搜索/显示）
let petToGroups = new Map();      // name.lower -> { id, name, baseName, groups: Set }
let groupToPets = new Map();      // 蛋组名 -> Set(fullName)
let petMatchCount = new Map();    // fullName.lower -> 可配种数
// 去重映射：按家族（基础名）合并（用于排行榜）
let familyToGroups = new Map();   // baseName.lower -> { name, groups: Set }
let familyMatchCount = new Map(); // baseName.lower -> 可配种数

// ===== 工具 =====
function getBaseName(name) {
    return name.replace(/[（(][^）)]*[）)]/g, '').trim();
}

// ===== 数据加载 =====
function loadEggData() {
    return new Promise((resolve, reject) => {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0');
            if (cached && (Date.now() - ts) < CACHE_DURATION_MS) {
                eggDataList = JSON.parse(cached);
                buildMappings();
                resolve(eggDataList);
                fetchFromWiki().catch(() => {});
                return;
            }
        } catch (e) {}
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
    familyToGroups.clear();
    familyMatchCount.clear();

    const allGroups = new Set();
    for (let item of eggDataList) {
        for (let g of (item.eggGroups || [])) allGroups.add(g);
    }
    for (let g of allGroups) groupToPets.set(g, new Set());

    for (let item of eggDataList) {
        let name = (item.name || '').trim();
        if (!name) continue;
        let base = getBaseName(name);
        if (!base) continue;
        let lower = name.toLowerCase();
        let baseLower = base.toLowerCase();

        // 完整映射（每个形态独立）
        petToGroups.set(lower, { id: item.id, name: name, baseName: base, groups: new Set() });
        for (let g of (item.eggGroups || [])) {
            petToGroups.get(lower).groups.add(g);
            groupToPets.get(g).add(name);
        }

        // 家族映射（按基础名合并蛋组）
        if (!familyToGroups.has(baseLower)) {
            familyToGroups.set(baseLower, { name: base, groups: new Set() });
        }
        for (let g of (item.eggGroups || [])) {
            familyToGroups.get(baseLower).groups.add(g);
        }
    }

    // 可配种数（完整映射）
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

    // 可配种数（家族映射，按家族名去重后统计）
    for (let [baseLower, entry] of familyToGroups.entries()) {
        const allFamilies = new Set();
        for (let g of entry.groups) {
            if (g === '无法孵蛋') continue;
            for (let [otherLower, otherEntry] of familyToGroups.entries()) {
                if (otherLower === baseLower) continue;
                if (otherEntry.groups.has(g)) {
                    allFamilies.add(otherLower);
                }
            }
        }
        familyMatchCount.set(baseLower, allFamilies.size);
    }
}

// ===== 查询接口（完整数据，含所有形态） =====
function getPetGroups(petName) {
    const entry = petToGroups.get(petName.toLowerCase());
    return entry ? Array.from(entry.groups) : [];
}

function getPetBaseName(petName) {
    const entry = petToGroups.get(petName.toLowerCase());
    return entry ? entry.baseName : getBaseName(petName);
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

// ===== 排行榜接口（按家族去重） =====
function getStudRanking() {
    const list = [];
    for (let [baseLower, entry] of familyToGroups.entries()) {
        const groups = Array.from(entry.groups).filter(g => g !== '无法孵蛋');
        if (groups.length < 2) continue;
        list.push({
            name: entry.name,
            groupsCount: groups.length,
            matchCount: familyMatchCount.get(baseLower) || 0,
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

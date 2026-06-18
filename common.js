// common.js - 洛克王国宠物蛋组数据引擎（BWIKI 实时数据版）
// 数据来源：BWIKI MediaWiki API（origin=* 解决 CORS）
// 策略：每次加载 fetch 最新数据，缓存 6 小时

const BWIKI_EGG_URL = 'https://wiki.biligame.com/rocom/api.php?action=query&titles=MediaWiki:Egg.json&prop=revisions&rvprop=content&format=json&origin=*';
const BWIKI_CORE_URL = 'https://wiki.biligame.com/rocom/api.php?action=query&titles=%E6%A8%A1%E5%9D%97%3APetData%2FCore&prop=revisions&rvprop=content&format=json&origin=*';
const CACHE_KEY = 'bwiki_egg_data';
const CACHE_TS_KEY = 'bwiki_egg_ts';
const FAMILY_KEY = 'bwiki_family_map';
const FAMILY_TS_KEY = 'bwiki_family_ts';
const CACHE_DURATION_MS = 6 * 60 * 60 * 1000;

// ===== 全局状态 =====
let eggDataList = [];
// 完整映射：每个形态独立
let petToGroups = new Map();      // name -> { id, name, groups: Set }
let groupToPets = new Map();      // 蛋组名 -> Set(fullName)
let petMatchCount = new Map();    // fullName -> 可配种数
// 家族映射：按进化组合并
let nameToFamily = new Map();     // fullName -> familyRepName
let familyToGroups = new Map();   // familyRepName -> Set(eggGroups)
let familyMatchCount = new Map(); // familyRepName -> 可配种数

// ===== 工具 =====
function getBaseName(name) {
    return name.replace(/[（(][^）)]*[）)]/g, '').trim();
}

// ===== 数据加载 =====
function loadEggData() {
    return Promise.all([_loadEgg(), _loadFamily()]).then(() => {
        buildMappings();
        return eggDataList;
    });
}

function _loadEgg() {
    return new Promise((resolve, reject) => {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            const ts = parseInt(localStorage.getItem(CACHE_TS_KEY) || '0');
            if (cached && (Date.now() - ts) < CACHE_DURATION_MS) {
                eggDataList = JSON.parse(cached);
                resolve();
                fetchFromWiki(BWIKI_EGG_URL).then(data => {
                    eggDataList = data;
                    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); localStorage.setItem(CACHE_TS_KEY, String(Date.now())); } catch(e){}
                }).catch(() => {});
                return;
            }
        } catch (e) {}
        fetchFromWiki(BWIKI_EGG_URL).then(data => {
            eggDataList = data;
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); localStorage.setItem(CACHE_TS_KEY, String(Date.now())); } catch(e){}
            resolve();
        }).catch(reject);
    });
}

function _loadFamily() {
    return new Promise((resolve) => {
        try {
            const cached = localStorage.getItem(FAMILY_KEY);
            const ts = parseInt(localStorage.getItem(FAMILY_TS_KEY) || '0');
            if (cached && (Date.now() - ts) < CACHE_DURATION_MS) {
                nameToFamily = new Map(Object.entries(JSON.parse(cached)));
                resolve();
                _fetchFamily().catch(() => {});
                return;
            }
        } catch (e) {}
        _fetchFamily().then(() => resolve()).catch(() => resolve());
    });
}

function _fetchFamily() {
    return fetch(BWIKI_CORE_URL)
        .then(res => res.json())
        .then(apiResult => {
            const pages = apiResult.query.pages;
            let luaCode = null;
            for (let pid in pages) {
                if (pages[pid].revisions) { luaCode = pages[pid].revisions[0]['*']; break; }
            }
            if (!luaCode) return;
            nameToFamily = parseFamilyFromLua(luaCode);
            try {
                localStorage.setItem(FAMILY_KEY, JSON.stringify(Object.fromEntries(nameToFamily)));
                localStorage.setItem(FAMILY_TS_KEY, String(Date.now()));
            } catch (e) {}
        });
}

function fetchFromWiki(url) {
    return fetch(url)
        .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
        .then(apiResult => {
            const pages = apiResult.query.pages;
            let content = null;
            for (let pid in pages) {
                if (pages[pid].revisions) { content = pages[pid].revisions[0]['*']; break; }
            }
            if (!content) throw new Error('页面内容为空');
            return JSON.parse(content);
        });
}

// ===== 解析 Lua PetData/Core 提取家族映射 =====
function parseFamilyFromLua(luaCode) {
    const familyMap = new Map();

    // 提取所有 pet_XXXXXX={...} 块
    const petBlocks = [];
    const blockRe = /pet_\d+\s*=\s*\{/g;
    let m;
    while ((m = blockRe.exec(luaCode)) !== null) {
        const start = m.index + m[0].length;
        let depth = 1, i = start;
        while (i < luaCode.length && depth > 0) {
            if (luaCode[i] === '{') depth++;
            else if (luaCode[i] === '}') depth--;
            i++;
        }
        petBlocks.push(luaCode.substring(start, i - 1));
    }

    // 提取进化组信息
    const evoGroups = {};
    for (const block of petBlocks) {
        const nameM = block.match(/\bn\s*=\s*"([^"]*)"/);
        const stageM = block.match(/\bsg\s*=\s*(\d+)/);
        const titleM = block.match(/\bt\s*=\s*"([^"]*)"/);
        const evgM = block.match(/\bevg\s*=\s*\{([^}]*)\}/);
        if (!nameM || !stageM || !evgM) continue;

        const name = nameM[1];
        const stage = parseInt(stageM[1]);
        const title = titleM ? titleM[1] : '';
        const evgs = evgM[1].match(/"([^"]*)"/g).map(s => s.replace(/"/g, ''));

        for (const evg of evgs) {
            if (!evoGroups[evg]) evoGroups[evg] = [];
            evoGroups[evg].push({ name, stage, title });
        }
    }

    // 每个进化组取 stage=1 的成员的名称（去括号）作为家族代表
    for (const evg in evoGroups) {
        const members = evoGroups[evg];
        const stage1 = members.filter(m => m.stage === 1);
        const rep = (stage1.length > 0 ? stage1 : [members.reduce((a, b) => a.stage < b.stage ? a : b)])
            [0].name;
        const repClean = rep.replace(/[（(][^）)]*[）)]/g, '').trim();

        for (const m of members) {
            if (m.name) familyMap.set(m.name, repClean);
            if (m.title && m.title !== m.name) familyMap.set(m.title, repClean);
        }
    }

    return familyMap;
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
        petToGroups.set(name, { id: item.id, name: name, groups: new Set() });
        for (let g of (item.eggGroups || [])) {
            petToGroups.get(name).groups.add(g);
            groupToPets.get(g).add(name);
        }
    }

    // 宠物可配种数
    for (let [name, entry] of petToGroups.entries()) {
        const allPets = new Set();
        for (let g of entry.groups) {
            if (g === '无法孵蛋') continue;
            const pets = groupToPets.get(g);
            if (pets) for (let p of pets) { if (p !== name) allPets.add(p); }
        }
        petMatchCount.set(name, allPets.size);
    }

    // 家族聚合：每个家族取合并后的蛋组
    for (let [name, entry] of petToGroups.entries()) {
        const family = getFamilyName(name);
        if (!family) continue;
        if (!familyToGroups.has(family)) familyToGroups.set(family, new Set());
        for (let g of entry.groups) familyToGroups.get(family).add(g);
    }

    // 家族可配种数（按家族去重）
    const familyPetSet = new Map(); // family -> Set(family names)
    for (let [family, groups] of familyToGroups.entries()) {
        if (!familyPetSet.has(family)) familyPetSet.set(family, new Set());
        for (let g of groups) {
            if (g === '无法孵蛋') continue;
            for (let [otherName, otherEntry] of petToGroups.entries()) {
                const otherFamily = getFamilyName(otherName);
                if (otherFamily !== family && otherEntry.groups.has(g)) {
                    familyPetSet.get(family).add(otherFamily);
                }
            }
        }
    }
    for (let [family, others] of familyPetSet.entries()) {
        familyMatchCount.set(family, others.size);
    }
}

function getFamilyName(name) {
    if (nameToFamily.has(name)) return nameToFamily.get(name);
    return getBaseName(name);
}

// ===== 查询接口（完整数据，含所有形态） =====
function getPetGroups(petName) {
    const entry = petToGroups.get(petName);
    return entry ? Array.from(entry.groups) : [];
}

function getAllPetNames() {
    return Array.from(petToGroups.keys()).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function getPetMatchCount(petName) {
    return petMatchCount.get(petName) || 0;
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
    for (let [family, groups] of familyToGroups.entries()) {
        const activeGroups = Array.from(groups).filter(g => g !== '无法孵蛋');
        if (activeGroups.length < 2) continue;
        list.push({
            name: family,
            groupsCount: activeGroups.length,
            matchCount: familyMatchCount.get(family) || 0,
            groups: activeGroups
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

// common.js - 洛克王国宠物蛋组数据引擎（BWIKI 数据版）
// 数据来源：Bwiki MediaWiki:Egg.json
// 策略：内置 fallback 数据保证可用，后台尝试 CORS 代理拉取最新版本

const BWIKI_CACHE_KEY = 'bwiki_egg_cache';
const BWIKI_CACHE_TS_KEY = 'bwiki_egg_ts';
const BWIKI_CACHE_VERSION_KEY = 'bwiki_egg_version';
const BWIKI_VERSION = '2026-06-18';
const CACHE_DURATION_MS = 6 * 60 * 60 * 1000; // 6小时

// CORS 代理列表（依次尝试）
const CORS_PROXIES = [
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];
const BWIKI_EGG_JSON_URL = 'https://wiki.biligame.com/rocom/index.php?title=MediaWiki:Egg.json&action=raw';

// ===== 全局状态 =====
let eggDataList = [];
let petToGroups = new Map();
let groupToPets = new Map();
let petMatchCount = new Map();

// ===== 数据加载（入口） =====
function loadEggData() {
    return new Promise((resolve, reject) => {
        // 1. 尝试从缓存读取
        try {
            const cached = localStorage.getItem(BWIKI_CACHE_KEY);
            const ts = parseInt(localStorage.getItem(BWIKI_CACHE_TS_KEY) || '0');
            const ver = localStorage.getItem(BWIKI_CACHE_VERSION_KEY) || '';
            if (cached && ver === BWIKI_VERSION && (Date.now() - ts) < CACHE_DURATION_MS) {
                eggDataList = JSON.parse(cached);
                buildMappings();
                resolve(eggDataList);
                return; // 缓存有效，不后台刷新（版本未变）
            }
            if (cached && ver !== BWIKI_VERSION) {
                // 版本变了，先尝试更新
                tryFetchLatest().then(data => {
                    resolve(data);
                }).catch(() => {
                    // 网络失败但本地有旧数据，先用旧数据
                    eggDataList = JSON.parse(cached);
                    buildMappings();
                    resolve(eggDataList);
                });
                return;
            }
        } catch (e) {}

        // 2. 缓存无效，尝试在线拉取
        tryFetchLatest().then(data => {
            resolve(data);
        }).catch(() => {
            // 3. 网络失败，使用内置 fallback
            eggDataList = FALLBACK_EGG_DATA;
            buildMappings();
            resolve(eggDataList);
        });
    });
}

function tryFetchLatest() {
    // 直接请求 BWIKI（可能被 CORS 拦截）
    return tryFetchUrl(BWIKI_EGG_JSON_URL).catch(() => {
        // 直接失败，尝试 CORS 代理
        return tryCorsProxies();
    }).then(data => {
        if (Array.isArray(data) && data.length > 0 && data[0].eggGroups) {
            eggDataList = data;
            try {
                localStorage.setItem(BWIKI_CACHE_KEY, JSON.stringify(data));
                localStorage.setItem(BWIKI_CACHE_TS_KEY, String(Date.now()));
                localStorage.setItem(BWIKI_CACHE_VERSION_KEY, BWIKI_VERSION);
            } catch (e) {}
            buildMappings();
            return data;
        } else {
            throw new Error('数据格式无效');
        }
    });
}

function tryFetchUrl(url) {
    return fetch(url, { cache: 'no-cache' })
        .then(res => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        });
}

function tryCorsProxies() {
    let chain = Promise.reject(new Error('无可用代理'));
    for (const makeUrl of CORS_PROXIES) {
        chain = chain.catch(() => tryFetchUrl(makeUrl(BWIKI_EGG_JSON_URL)));
    }
    return chain;
}

// 强制刷新（绕过缓存）
function forceRefreshData() {
    return tryFetchLatest();
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

    // 可配种总数
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

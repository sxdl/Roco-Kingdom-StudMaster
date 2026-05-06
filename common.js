// 存储键名
const STORAGE_KEY = 'egg_group_data';

// 初始化数据
function initData() {
    if (!localStorage.getItem(STORAGE_KEY)) {
        const initialData = { eggGroups: EGG_GROUPS, tableData: TABLE_DATA };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initialData));
        return initialData;
    }
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
}

function getCurrentData() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
}

function saveData(eggGroups, tableData) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ eggGroups, tableData }));
}

let petToGroups = new Map();      // 宠物小写 -> { name, groups: Set }
let groupToPets = new Map();      // 蛋组名 -> Set(宠物名)
let petMatchCount = new Map();    // 宠物名小写 -> 可配种宠物总数（并集去重减自身）

function buildMappingsFromData(data) {
    const { eggGroups, tableData } = data;
    petToGroups.clear();
    groupToPets.clear();
    for (let g of eggGroups) groupToPets.set(g, new Set());

    for (let row of tableData) {
        for (let colIdx = 0; colIdx < eggGroups.length; colIdx++) {
            let pet = row[colIdx];
            if (!pet || pet.trim() === "") continue;
            let group = eggGroups[colIdx];
            let petKey = pet.trim();
            let lowerKey = petKey.toLowerCase();

            if (!petToGroups.has(lowerKey)) {
                petToGroups.set(lowerKey, { name: petKey, groups: new Set() });
            }
            petToGroups.get(lowerKey).groups.add(group);
            groupToPets.get(group).add(petKey);
        }
    }

    // 预计算可配种宠物总数（每个宠物的所有蛋组下的宠物并集，减去自身）
    petMatchCount.clear();
    for (let [lowerKey, entry] of petToGroups.entries()) {
        const groups = entry.groups;
        const allPets = new Set();
        for (let g of groups) {
            const petsInGroup = groupToPets.get(g);
            if (petsInGroup) {
                for (let p of petsInGroup) allPets.add(p);
            }
        }
        allPets.delete(entry.name); // 移除自身
        petMatchCount.set(lowerKey, allPets.size);
    }
}

function refreshData() {
    const data = getCurrentData();
    buildMappingsFromData(data);
}

function getPetGroups(petName) {
    const lower = petName.toLowerCase();
    const entry = petToGroups.get(lower);
    return entry ? Array.from(entry.groups) : [];
}

function getAllPetNames() {
    const names = new Set();
    for (let entry of petToGroups.values()) {
        names.add(entry.name);
    }
    return Array.from(names).sort((a,b) => a.localeCompare(b));
}

function getPetMatchCount(petName) {
    const lower = petName.toLowerCase();
    return petMatchCount.get(lower) || 0;
}

function getStudRanking() {
    const list = [];
    for (let [lowerKey, entry] of petToGroups.entries()) {
        const groupsCount = entry.groups.size;
        // 只保留至少两个蛋组的宠物（种公门槛）
        if (groupsCount < 2) continue;
        const matchCount = petMatchCount.get(lowerKey) || 0;
        list.push({
            name: entry.name,
            groupsCount: groupsCount,
            matchCount: matchCount,
            groups: Array.from(entry.groups)
        });
    }
    // 排序：先按可配种宠物总数降序，再按自身蛋组数降序
    list.sort((a, b) => {
        if (a.matchCount !== b.matchCount) return b.matchCount - a.matchCount;
        return b.groupsCount - a.groupsCount;
    });
    return list;
}

function getPetsByGroup(groupName) {
    const set = groupToPets.get(groupName);
    return set ? Array.from(set).sort() : [];
}

// CSV 导出（基于当前数据，不依赖映射）
function exportToCSV() {
    const data = getCurrentData();
    const { eggGroups, tableData } = data;
    const rows = [eggGroups];
    for (let row of tableData) {
        const fullRow = row.slice();
        while (fullRow.length < eggGroups.length) fullRow.push('');
        rows.push(fullRow);
    }
    return rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

function importFromCSV(csvText) {
    const lines = csvText.split(/\r?\n/).filter(l => l.trim() !== '');
    if (lines.length < 2) throw new Error('CSV至少包含表头+一行数据');
    const parseRow = (line) => {
        return line.split(',').map(cell => cell.replace(/^"|"$/g, '').replace(/""/g, '"'));
    };
    const header = parseRow(lines[0]);
    const dataRows = lines.slice(1).map(parseRow);
    const maxCols = header.length;
    const tableData = dataRows.map(row => {
        const newRow = [...row];
        while (newRow.length < maxCols) newRow.push('');
        return newRow;
    });
    return { eggGroups: header, tableData };
}

initData();
refreshData();
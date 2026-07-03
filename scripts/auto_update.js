const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const EXCEL_FILE = 'C:/Users/12565/GitHub/unicom-wenchuang/data/inventory.xlsx';
const PRODUCTS_JSON = 'C:/Users/12565/GitHub/unicom-wenchuang/data/products.json';

function main() {
    console.log('[1/5] 读取Excel:', EXCEL_FILE);
    
    if (!fs.existsSync(EXCEL_FILE)) {
        console.log('文件不存在，跳过');
        process.exit(0);
    }
    
    const workbook = xlsx.readFile(EXCEL_FILE);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    
    console.log('[2/5] Excel行数:', data.length);
    
    const headers = data[0] || [];
    console.log('列名:', headers);
    
    const findCol = (possibleNames) => {
        for (let i = 0; i < headers.length; i++) {
            const h = String(headers[i] || '').trim().toLowerCase();
            for (const name of possibleNames) {
                if (h === name.toLowerCase()) return i;
            }
        }
        return -1;
    };
    
    const colMap = {
        code74: findCol(['74编码', '74码', '编码', 'product_code_74', '产品编码']),
        beijing: findCol(['北京仓', '北京', 'beijing', '北京库存', '北京总仓']),
        kunshan: findCol(['昆山仓', '昆山', 'kunshan', '昆山库存', '昆山总仓']),
        dongguan: findCol(['东莞仓', '东莞', 'dongguan', '东莞库存', '东莞总仓']),
        chengdu: findCol(['成都仓', '成都', 'chengdu', '成都库存', '成都总仓']),
        xiaoku: findCol(['小库', '小库仓', 'xiaoku', '小库库存']),
    };
    
    console.log('列索引映射:', colMap);
    
    if (colMap.code74 === -1) {
        console.error('错误：未找到74编码/产品编码列');
        process.exit(1);
    }
    
    const inventoryMap = {};
    let validRows = 0;
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const code74 = String(row[colMap.code74] || '').trim();
        if (!code74 || code74 === 'nan' || code74 === 'undefined') continue;
        
        inventoryMap[code74] = {
            beijing: parseInt(row[colMap.beijing] || 0) || 0,
            kunshan: parseInt(row[colMap.kunshan] || 0) || 0,
            dongguan: parseInt(row[colMap.dongguan] || 0) || 0,
            chengdu: parseInt(row[colMap.chengdu] || 0) || 0,
            xiaoku: parseInt(row[colMap.xiaoku] || 0) || 0,
        };
        validRows++;
    }
    
    console.log('[3/5] 有效库存行数:', validRows);
    
    console.log('[4/5] 读取产品数据:', PRODUCTS_JSON);
    const products = JSON.parse(fs.readFileSync(PRODUCTS_JSON, 'utf8'));
    
    let updated = 0;
    let notFound = 0;
    for (const p of products) {
        const code = p.product_code_74;
        if (inventoryMap[code]) {
            const inv = inventoryMap[code];
            inv.total = inv.beijing + inv.kunshan + inv.dongguan + inv.chengdu + inv.xiaoku;
            p.inventory = inv;
            updated++;
        } else {
            notFound++;
        }
    }
    
    console.log(`更新: ${updated} / ${products.length}, 未匹配: ${notFound}`);
    
    fs.writeFileSync(PRODUCTS_JSON, JSON.stringify(products, null, 2), 'utf8');
    console.log('[5/5] 已保存:', PRODUCTS_JSON);
    console.log('\n✅ 库存更新完成！');
}

main();

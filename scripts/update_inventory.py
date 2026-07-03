#!/usr/bin/env python3
"""
联通文创库存更新脚本
从 Excel 库存表更新 products.json 中的库存数据

用法：python update_inventory.py <inventory.xlsx> <products.json>
"""

import json
import sys
import os
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    print("错误：缺少 pandas 库，请安装：pip install pandas openpyxl")
    sys.exit(1)


def update_inventory(excel_path, json_path):
    """从 Excel 库存表更新 products.json"""
    
    if not os.path.exists(excel_path):
        print(f"错误：找不到库存表 {excel_path}")
        sys.exit(1)
    
    if not os.path.exists(json_path):
        print(f"错误：找不到产品数据 {json_path}")
        sys.exit(1)
    
    # 读取 Excel 库存表
    print(f"正在读取库存表: {excel_path}")
    df = pd.read_excel(excel_path)
    
    # 显示列名，帮助调试
    print(f"库存表列名: {list(df.columns)}")
    print(f"库存表行数: {len(df)}")
    
    # 构建库存映射：74编码 -> 库存数据
    # 支持多种列名变体
    column_map = {
        '74编码': ['74编码', '74码', 'product_code_74', '编码'],
        '北京仓': ['北京仓', '北京', 'beijing', '北京库存'],
        '昆山仓': ['昆山仓', '昆山', 'kunshan', '昆山库存'],
        '东莞仓': ['东莞仓', '东莞', 'dongguan', '东莞库存'],
        '成都仓': ['成都仓', '成都', 'chengdu', '成都库存'],
        '小库': ['小库', '小库仓', 'xiaoku', '小库库存'],
    }
    
    def find_column(df, possible_names):
        """在 DataFrame 中查找匹配的列名"""
        for name in possible_names:
            if name in df.columns:
                return name
            # 尝试不区分大小写匹配
            for col in df.columns:
                if col.lower().strip() == name.lower().strip():
                    return col
        return None
    
    # 找到实际列名
    actual_cols = {}
    for key, possible in column_map.items():
        found = find_column(df, possible)
        if found:
            actual_cols[key] = found
        else:
            print(f"警告：未找到列 '{key}'，将使用默认值 0")
    
    # 构建库存映射
    inventory_map = {}
    missing_code = 0
    for idx, row in df.iterrows():
        code_74 = str(row.get(actual_cols.get('74编码', ''), '')).strip()
        if not code_74 or code_74.lower() == 'nan':
            missing_code += 1
            continue
        
        # 提取库存数据
        inventory_map[code_74] = {
            'beijing': int(row.get(actual_cols.get('北京仓', ''), 0) or 0),
            'kunshan': int(row.get(actual_cols.get('昆山仓', ''), 0) or 0),
            'dongguan': int(row.get(actual_cols.get('东莞仓', ''), 0) or 0),
            'chengdu': int(row.get(actual_cols.get('成都仓', ''), 0) or 0),
            'xiaoku': int(row.get(actual_cols.get('小库', ''), 0) or 0),
        }
    
    print(f"库存表解析完成：{len(inventory_map)} 个有效产品，{missing_code} 行缺少74编码")
    
    # 读取现有产品数据
    print(f"正在读取产品数据: {json_path}")
    with open(json_path, 'r', encoding='utf-8') as f:
        products = json.load(f)
    
    # 更新库存
    updated = 0
    not_found = 0
    for p in products:
        code_74 = p.get('product_code_74', '')
        if code_74 in inventory_map:
            inv = inventory_map[code_74].copy()
            inv['total'] = sum(inv.values())
            p['inventory'] = inv
            updated += 1
        else:
            not_found += 1
    
    # 保存更新后的数据
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(products, f, ensure_ascii=False, indent=2)
    
    print(f"\n更新完成：")
    print(f"  - 已更新: {updated} / {len(products)} 个产品")
    print(f"  - 未匹配: {not_found} 个产品（库存表中无记录）")
    print(f"  - 文件已保存: {json_path}")
    
    return updated


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("用法：python update_inventory.py <库存表.xlsx> <products.json>")
        print("示例：python update_inventory.py data/inventory.xlsx data/products.json")
        sys.exit(1)
    
    excel_path = sys.argv[1]
    json_path = sys.argv[2]
    
    update_inventory(excel_path, json_path)

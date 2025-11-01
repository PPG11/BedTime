#!/bin/bash

# 批量上传微信小程序云函数脚本
# 
# 使用方法:
# 1. 确保已安装微信开发者工具 CLI
# 2. 在微信开发者工具中登录账号并打开项目
# 3. 运行: bash scripts/upload-cloudfunctions.sh
# 
# 或者使用 npm script:
# yarn upload:cloudfunctions

set -e

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 获取脚本所在目录的父目录（项目根目录）
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
CLOUDFUNCTIONS_DIR="$PROJECT_ROOT/cloudfunctions"

# 从环境变量或配置文件中读取云环境 ID
CLOUD_ENV_ID="${CLOUD_ENV_ID:-}"

# 如果环境变量未设置，尝试从源代码读取
if [ -z "$CLOUD_ENV_ID" ]; then
    CLOUD_CONFIG_PATH="$PROJECT_ROOT/src/config/cloud.ts"
    if [ -f "$CLOUD_CONFIG_PATH" ]; then
        # 使用 sed 提取云环境 ID（兼容 macOS 和 Linux）
        CLOUD_ENV_ID=$(grep "CLOUD_ENV_ID" "$CLOUD_CONFIG_PATH" | sed -E "s/.*CLOUD_ENV_ID[[:space:]]*=[[:space:]]*['\"]([^'\"]+)['\"].*/\1/" | head -1)
    fi
fi

echo -e "${BLUE}🚀 开始批量上传云函数...${NC}\n"
echo -e "${BLUE}📁 云函数目录: $CLOUDFUNCTIONS_DIR${NC}\n"

# 检查云函数目录是否存在
if [ ! -d "$CLOUDFUNCTIONS_DIR" ]; then
    echo -e "${RED}❌ 错误: 云函数目录不存在: $CLOUDFUNCTIONS_DIR${NC}"
    exit 1
fi

# 检查云环境 ID
if [ -z "$CLOUD_ENV_ID" ]; then
    echo -e "${RED}❌ 错误: 未找到云环境 ID${NC}"
    echo -e "${YELLOW}   请设置环境变量 CLOUD_ENV_ID，或确保 src/config/cloud.ts 中有 CLOUD_ENV_ID 配置${NC}"
    echo -e "${YELLOW}   示例: CLOUD_ENV_ID=cloud1-xxx yarn upload:cloudfunctions:sh${NC}\n"
    exit 1
else
    echo -e "${GREEN}✅ 云环境 ID: $CLOUD_ENV_ID${NC}\n"
fi

# 获取所有云函数目录（排除 common 和 node_modules）
functions=()
while IFS= read -r -d '' dir; do
    dirname=$(basename "$dir")
    if [ "$dirname" != "common" ] && [ "$dirname" != "node_modules" ]; then
        functions+=("$dirname")
    fi
done < <(find "$CLOUDFUNCTIONS_DIR" -mindepth 1 -maxdepth 1 -type d -print0)

# 排序
IFS=$'\n' functions=($(sort <<<"${functions[*]}"))
unset IFS

if [ ${#functions[@]} -eq 0 ]; then
    echo -e "${YELLOW}⚠️  未找到任何云函数${NC}"
    exit 0
fi

echo -e "${BLUE}📋 找到 ${#functions[@]} 个云函数:${NC}\n"
for i in "${!functions[@]}"; do
    echo -e "   $((i+1)). ${functions[$i]}"
done
echo ""

success_count=0
fail_count=0

# 遍历上传每个云函数
for func in "${functions[@]}"; do
    func_path="$CLOUDFUNCTIONS_DIR/$func"
    
    # 检查是否有 index.js 或 package.json
    if [ ! -f "$func_path/index.js" ] && [ ! -f "$func_path/package.json" ]; then
        echo -e "${YELLOW}⏭️  跳过 $func (缺少 index.js 或 package.json)${NC}"
        continue
    fi
    
    echo -e "${BLUE}📤 正在上传云函数: $func...${NC}"
    
    # 使用微信开发者工具 CLI 上传
    # 注意: 需要先启动微信开发者工具并打开项目
    # 使用 --names 参数指定函数名，--remote-npm-install 在云端安装依赖
    if cli cloud functions deploy --env "$CLOUD_ENV_ID" --names "$func" --project "$PROJECT_ROOT" --remote-npm-install 2>/dev/null; then
        echo -e "${GREEN}✅ $func 上传成功${NC}\n"
        ((success_count++))
    else
        echo -e "${RED}❌ $func 上传失败${NC}"
        echo -e "${YELLOW}   提示: 请确保:${NC}"
        echo -e "${YELLOW}   1. 微信开发者工具已启动并登录${NC}"
        echo -e "${YELLOW}   2. 项目已在开发者工具中打开${NC}"
        echo -e "${YELLOW}   3. 已安装微信开发者工具 CLI${NC}\n"
        ((fail_count++))
    fi
done

echo ""
echo -e "${BLUE}$(printf '=%.0s' {1..50})${NC}"
echo -e "${BLUE}📊 上传完成:${NC}"
echo -e "   ${GREEN}✅ 成功: $success_count${NC}"
echo -e "   ${RED}❌ 失败: $fail_count${NC}"
echo -e "   ${BLUE}📦 总计: ${#functions[@]}${NC}"
echo -e "${BLUE}$(printf '=%.0s' {1..50})${NC}"


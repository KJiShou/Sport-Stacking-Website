# 🏆 运动叠杯记录系统

## 概述

这个记录系统允许用户查看各种运动叠杯项目的世界记录、排名和统计数据。系统支持个人项目和团队项目的记录管理。

## 功能特性

### 1. 世界记录概览
- 显示所有事件的前10名记录
- 按最佳时间排序
- 支持个人和团队项目

### 2. 详细排名查看
- 按事件类型查看排名
- 支持预赛和决赛筛选
- 支持按级别筛选（初级/中级/高级）
- 显示所有尝试次数和最佳时间

### 3. 支持的事件类型
- **3-3-3**: 经典的3-3-3项目
- **3-6-3**: 挑战性的3-6-3项目
- **Cycle**: 循环项目
- **Double**: 双人协作项目

## 技术实现

### 数据服务 (`recordService.ts`)

新增的函数：

```typescript
// 获取事件排名记录
getEventRankings(event: string, round: "prelim" | "final")

// 获取分类排名记录
getClassificationRankings(event: string, classification, round)

// 获取所有事件的世界记录
getWorldRecords()
```

### 组件结构

- **`RecordRankingTable`**: 通用的记录排名表格组件
- **`WorldRecordsOverview`**: 世界记录概览卡片组件
- **`RecordsIndex`**: 记录类型选择主页面

## 使用方法

### 1. 查看世界记录概览
访问任何记录页面，顶部会显示该事件的世界记录概览，包括前三名的成绩。

### 2. 查看详细排名
- 选择轮次：预赛或决赛
- 选择级别：所有级别、初级、中级、高级
- 表格会显示完整的排名信息

### 3. 导航
- 主页面：`/records` - 选择记录类型
- 具体事件：`/records/3-3-3`, `/records/3-6-3`, `/records/cycle`, `/records/double`

## 数据格式

### GlobalResult 结构
```typescript
interface GlobalResult {
  tournamentId: string;
  event: string;
  participantId?: string;
  participantName?: string;
  teamId?: string;
  teamName?: string;
  round: "prelim" | "final";
  classification?: "beginner" | "intermediate" | "advance";
  bestTime: number;
  try1?: number;
  try2?: number;
  try3?: number;
}
```

## 注意事项

1. 所有时间数据以秒为单位存储
2. 支持 DNF（未完成）记录
3. 排名按最佳时间升序排列
4. 需要确保 Firebase 权限配置正确
5. 建议在生产环境中添加适当的缓存机制

## 未来扩展

- [ ] 添加历史记录趋势图表
- [ ] 支持按国家/地区筛选
- [ ] 添加记录搜索功能
- [ ] 支持记录导出功能
- [ ] 添加记录验证状态显示

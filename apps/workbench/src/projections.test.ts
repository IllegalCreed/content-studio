import { describe, expect, it } from 'vitest'
import { preferRuntimeData } from './projections'

describe('workbench runtime projections', () => {
  it('运行时已连接时只显示运行时数据，即使运行时返回空列表', () => {
    expect(preferRuntimeData([], ['演示活动'], true)).toEqual([])
  })

  it('运行时未连接时保留只读演示数据', () => {
    expect(preferRuntimeData([], ['演示活动'], false)).toEqual(['演示活动'])
  })
})

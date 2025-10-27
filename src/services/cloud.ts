import Taro from '@tarojs/taro'
import {
  CLOUD_ENV_CONFIGURED,
  CLOUD_ENV_ID,
  CLOUD_SHOULD_ENABLE
} from '../config/cloud'

type CloudCommandDescriptor =
  | {
      __cloudType: 'command'
      kind: 'comparison'
      operator: 'gte' | 'lte'
      value: unknown
    }
  | {
      __cloudType: 'command'
      kind: 'in'
      values: unknown[]
    }
  | {
      __cloudType: 'command'
      kind: 'logical'
      operator: 'and'
      operands: CloudCommandDescriptor[]
    }

type ServerDateDescriptor = {
  __cloudType: 'serverDate'
  value: number
}

type DateDescriptor = {
  __cloudType: 'date'
  value: string
}

export type CloudDocumentSnapshot<T> = {
  data?: T
}

export type DbDocumentHandle<T> = {
  get(): Promise<CloudDocumentSnapshot<T>>
  set(options: { data: Partial<T> }): Promise<unknown>
  update(options: { data: Partial<T> }): Promise<unknown>
  remove(): Promise<unknown>
}

export type DbCollection<T> = {
  doc(id: string): DbDocumentHandle<T>
  where(query: Record<string, unknown>): DbCollection<T>
  count(): Promise<{ total: number }>
  orderBy(field: keyof T, order: 'asc' | 'desc'): DbCollection<T>
  limit(count: number): DbCollection<T>
  get(): Promise<{ data?: T[] }>
}

export type CloudCommand = {
  gte(value: unknown): CloudCommandDescriptor
  lte(value: unknown): CloudCommandDescriptor
  in(values: unknown[]): CloudCommandDescriptor
  and(conditions: CloudCommandDescriptor[]): CloudCommandDescriptor
}

export type CloudDatabase = {
  collection<T>(name: string): DbCollection<T>
  serverDate?: () => ServerDateDescriptor
  command: CloudCommand
}

type TaroCloud = {
  init(options: { traceUser?: boolean; env?: string }): void
  callFunction(options: { name: string; data?: Record<string, unknown> }): Promise<unknown>
}

type DatabaseRequest =
  | { action: 'doc.get'; collection: string; id: string }
  | { action: 'doc.set'; collection: string; id: string; data: Record<string, unknown> }
  | { action: 'doc.update'; collection: string; id: string; data: Record<string, unknown> }
  | { action: 'doc.remove'; collection: string; id: string }
  | {
      action: 'collection.get'
      collection: string
      query?: Record<string, unknown>
      orderBy?: Array<{ field: string; order: 'asc' | 'desc' }>
      limit?: number
    }
  | {
      action: 'collection.count'
      collection: string
      query?: Record<string, unknown>
    }

type DatabaseProxyResponse = {
  ok: boolean
  result?: unknown
  error?: {
    message?: string
    code?: string | number
    stack?: string
  }
}

type DatabaseCaller = (request: DatabaseRequest) => Promise<unknown>

type CollectionState = {
  query?: Record<string, unknown>
  orderBy?: Array<{ field: string; order: 'asc' | 'desc' }>
  limit?: number
}

let databaseCache: CloudDatabase | null = null
let cloudInstance: TaroCloud | null = null
let openIdCache: string | null = null
let openIdPromise: Promise<string> | null = null

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function isServerDateDescriptor(value: unknown): value is ServerDateDescriptor {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { __cloudType?: unknown }).__cloudType === 'serverDate'
  )
}

function isCommandDescriptor(value: unknown): value is CloudCommandDescriptor {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { __cloudType?: unknown }).__cloudType === 'command'
  )
}

function createServerDateDescriptor(): ServerDateDescriptor {
  return {
    __cloudType: 'serverDate',
    value: Date.now()
  }
}

function createComparisonDescriptor(
  operator: 'gte' | 'lte',
  value: unknown
): CloudCommandDescriptor {
  return {
    __cloudType: 'command',
    kind: 'comparison',
    operator,
    value
  }
}

function createInDescriptor(values: unknown[]): CloudCommandDescriptor {
  return {
    __cloudType: 'command',
    kind: 'in',
    values
  }
}

function createLogicalDescriptor(
  operator: 'and',
  operands: CloudCommandDescriptor[]
): CloudCommandDescriptor {
  return {
    __cloudType: 'command',
    kind: 'logical',
    operator,
    operands: operands.map((operand) => operand)
  }
}

function serializeCommandDescriptor(
  descriptor: CloudCommandDescriptor
): CloudCommandDescriptor {
  switch (descriptor.kind) {
    case 'comparison':
      return {
        __cloudType: 'command',
        kind: 'comparison',
        operator: descriptor.operator,
        value: serializeValue(descriptor.value)
      }
    case 'in':
      return {
        __cloudType: 'command',
        kind: 'in',
        values: descriptor.values.map((item) => serializeValue(item))
      }
    case 'logical':
      return {
        __cloudType: 'command',
        kind: 'logical',
        operator: descriptor.operator,
        operands: descriptor.operands.map((operand) =>
          serializeCommandDescriptor(operand)
        )
      }
    default:
      return descriptor
  }
}

function serializeValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item))
  }

  if (value instanceof Date) {
    const marker = (value as DateDescriptor | ServerDateDescriptor | Date) as {
      __cloudType?: string
      value?: number
    }
    if (marker.__cloudType === 'serverDate' && typeof marker.value === 'number') {
      return {
        __cloudType: 'serverDate',
        value: marker.value
      }
    }
    return {
      __cloudType: 'date',
      value: value.toISOString()
    }
  }

  if (isServerDateDescriptor(value)) {
    return {
      __cloudType: 'serverDate',
      value: value.value
    }
  }

  if (isCommandDescriptor(value)) {
    return serializeCommandDescriptor(value)
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) {
        continue
      }
      const serialized = serializeValue(entry)
      if (serialized !== undefined) {
        result[key] = serialized
      }
    }
    return result
  }

  return value
}

function serializeRecord(
  record?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!record) {
    return undefined
  }
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) {
      continue
    }
    const serialized = serializeValue(value)
    if (serialized !== undefined) {
      result[key] = serialized
    }
  }
  return result
}

function deserializeValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => deserializeValue(item)) as unknown as T
  }

  if (isPlainObject(value)) {
    const marker = (value as { __cloudType?: unknown }).__cloudType
    if (marker === 'date') {
      const iso = (value as { value?: unknown }).value
      if (typeof iso === 'string' || typeof iso === 'number') {
        return new Date(iso) as unknown as T
      }
      return new Date() as unknown as T
    }
    if (marker === 'serverDate') {
      const timestamp = (value as { value?: unknown }).value
      if (typeof timestamp === 'number') {
        return new Date(timestamp) as unknown as T
      }
      return new Date() as unknown as T
    }
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      result[key] = deserializeValue(entry)
    }
    return result as unknown as T
  }

  return value
}

function serializeRequest(request: DatabaseRequest): Record<string, unknown> {
  switch (request.action) {
    case 'doc.get':
      return {
        action: request.action,
        collection: request.collection,
        id: request.id
      }
    case 'doc.set':
    case 'doc.update':
      return {
        action: request.action,
        collection: request.collection,
        id: request.id,
        data: serializeRecord(request.data) ?? {}
      }
    case 'doc.remove':
      return {
        action: request.action,
        collection: request.collection,
        id: request.id
      }
    case 'collection.get':
      return {
        action: request.action,
        collection: request.collection,
        query: serializeRecord(request.query) ?? {},
        orderBy: request.orderBy ?? [],
        limit: request.limit
      }
    case 'collection.count':
      return {
        action: request.action,
        collection: request.collection,
        query: serializeRecord(request.query) ?? {}
      }
    default:
      return request as Record<string, unknown>
  }
}

function createDocumentHandle<T>(
  caller: DatabaseCaller,
  collection: string,
  id: string
): DbDocumentHandle<T> {
  return {
    async get() {
      const result = (await caller({
        action: 'doc.get',
        collection,
        id
      })) as CloudDocumentSnapshot<T>
      return {
        data: deserializeValue(result?.data) as T | undefined
      }
    },
    async set(options) {
      await caller({
        action: 'doc.set',
        collection,
        id,
        data: options.data as Record<string, unknown>
      })
    },
    async update(options) {
      await caller({
        action: 'doc.update',
        collection,
        id,
        data: options.data as Record<string, unknown>
      })
    },
    async remove() {
      await caller({
        action: 'doc.remove',
        collection,
        id
      })
    }
  }
}

function createCollectionHandle<T>(
  caller: DatabaseCaller,
  collection: string,
  state: CollectionState = {}
): DbCollection<T> {
  return {
    doc(id: string) {
      return createDocumentHandle<T>(caller, collection, id)
    },
    where(query: Record<string, unknown>) {
      return createCollectionHandle<T>(caller, collection, {
        ...state,
        query
      })
    },
    orderBy(field: keyof T, order: 'asc' | 'desc') {
      const nextOrder = [...(state.orderBy ?? []), { field: field as string, order }]
      return createCollectionHandle<T>(caller, collection, {
        ...state,
        orderBy: nextOrder
      })
    },
    limit(count: number) {
      return createCollectionHandle<T>(caller, collection, {
        ...state,
        limit: count
      })
    },
    async get() {
      const result = (await caller({
        action: 'collection.get',
        collection,
        query: state.query,
        orderBy: state.orderBy,
        limit: state.limit
      })) as { data?: T[] }
      return {
        data: deserializeValue(result?.data) as T[] | undefined
      }
    },
    async count() {
      const result = (await caller({
        action: 'collection.count',
        collection,
        query: state.query
      })) as { total: number }
      return {
        total: (result?.total as number) ?? 0
      }
    }
  }
}

function createDatabaseProxy(caller: DatabaseCaller): CloudDatabase {
  return {
    collection<T>(name: string) {
      return createCollectionHandle<T>(caller, name)
    },
    serverDate() {
      return createServerDateDescriptor()
    },
    command: {
      gte(value: unknown) {
        return createComparisonDescriptor('gte', value)
      },
      lte(value: unknown) {
        return createComparisonDescriptor('lte', value)
      },
      in(values: unknown[]) {
        return createInDescriptor(values)
      },
      and(conditions: CloudCommandDescriptor[]) {
        return createLogicalDescriptor('and', conditions)
      }
    }
  }
}

function ensureTaroCloud(): TaroCloud {
  if (!supportsCloud()) {
    throw new Error('当前运行环境不支持微信云开发，请在小程序端使用。')
  }

  if (cloudInstance) {
    return cloudInstance
  }

  const cloud = (Taro as unknown as { cloud?: TaroCloud }).cloud
  if (!cloud) {
    throw new Error('Taro.cloud 未初始化')
  }

  const envId = CLOUD_ENV_ID.trim()
  if (envId) {
    try {
      cloud.init({
        traceUser: true,
        env: envId
      })
    } catch (error) {
      console.warn('微信云开发初始化（带 envId）失败，使用默认环境', error)
      cloud.init({
        traceUser: true
      })
    }
  } else if (CLOUD_ENV_CONFIGURED) {
    console.warn('云开发环境 ID 为空字符串，已跳过自定义环境初始化')
    cloud.init({
      traceUser: true
    })
  } else {
    cloud.init({
      traceUser: true
    })
  }

  cloudInstance = cloud
  return cloudInstance
}

async function callDatabase(request: DatabaseRequest): Promise<unknown> {
  const cloud = ensureTaroCloud()
  const payload = serializeRequest(request)
  const response = (await cloud.callFunction({
    name: 'databaseProxy',
    data: payload
  })) as { result?: DatabaseProxyResponse }

  const result = response?.result
  if (!result) {
    return undefined
  }

  if (!result.ok) {
    const error = result.error ?? {}
    const message =
      (typeof error.message === 'string' && error.message.length
        ? error.message
        : '调用云数据库代理失败') ?? '调用云数据库代理失败'
    const failure = new Error(message)
    if (error.code !== undefined) {
      ;(failure as { code?: string | number }).code = error.code
    }
    throw failure
  }

  return deserializeValue(result.result)
}

export function supportsCloud(): boolean {
  if (!CLOUD_SHOULD_ENABLE) {
    return false
  }

  const env = Taro.getEnv?.()
  if (!env || env !== Taro.ENV_TYPE.WEAPP) {
    return false
  }

  return Boolean((Taro as unknown as { cloud?: unknown }).cloud)
}

export async function ensureCloud(): Promise<CloudDatabase> {
  if (!CLOUD_SHOULD_ENABLE) {
    throw new Error('未配置云开发环境，当前运行在本地模式')
  }

  if (!supportsCloud()) {
    throw new Error('当前运行环境不支持微信云开发，请在小程序端使用。')
  }

  if (databaseCache) {
    return databaseCache
  }

  ensureTaroCloud()
  databaseCache = createDatabaseProxy((request) => callDatabase(request))
  return databaseCache
}

type LoginResult = {
  result?: {
    openid?: string
  }
}

export async function getCurrentOpenId(): Promise<string> {
  if (openIdCache) {
    return openIdCache
  }

  if (!openIdPromise) {
    openIdPromise = (async () => {
      await ensureCloud()

      const response = (await ensureTaroCloud().callFunction({
        name: 'login'
      })) as LoginResult

      const openid = response?.result?.openid
      if (!openid) {
        throw new Error('登录云函数未返回 openid')
      }

      openIdCache = openid
      return openid
    })()
  }

  try {
    return await openIdPromise
  } catch (error) {
    console.error('获取 openid 失败，云函数可能未部署或云开发环境未配置', error)
    openIdPromise = null
    throw new Error('无法获取用户身份信息，请检查云函数配置或使用本地模式')
  } finally {
    if (openIdCache) {
      openIdPromise = null
    }
  }
}

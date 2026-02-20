import type { CallSite, DependencyGraphResult, InheritanceRelation } from '@pleaseai/rpg-encoder'
import { DependencyGraph } from '@pleaseai/rpg-encoder'
import { describe, expect, it } from 'vitest'

describe('DependencyGraph', () => {
  describe('addCall and getCalls', () => {
    it('should add and retrieve calls', () => {
      const graph = new DependencyGraph()
      const call: CallSite = {
        callerFile: 'src/module.ts',
        callerEntity: 'process',
        calleeSymbol: 'fetch',
        line: 42,
      }

      graph.addCall(call)
      const calls = graph.getCalls()

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual(call)
    })

    it('should add multiple calls', () => {
      const graph = new DependencyGraph()
      const call1: CallSite = {
        callerFile: 'src/module.ts',
        callerEntity: 'process',
        calleeSymbol: 'fetch',
      }
      const call2: CallSite = {
        callerFile: 'src/utils.ts',
        callerEntity: 'helper',
        calleeSymbol: 'parse',
        line: 10,
      }

      graph.addCall(call1)
      graph.addCall(call2)

      expect(graph.getCalls()).toHaveLength(2)
    })
  })

  describe('getCallsByFile', () => {
    it('should filter calls by file path', () => {
      const graph = new DependencyGraph()
      const call1: CallSite = {
        callerFile: 'src/module.ts',
        calleeSymbol: 'fetch',
      }
      const call2: CallSite = {
        callerFile: 'src/module.ts',
        calleeSymbol: 'parse',
      }
      const call3: CallSite = {
        callerFile: 'src/utils.ts',
        calleeSymbol: 'stringify',
      }

      graph.addCall(call1)
      graph.addCall(call2)
      graph.addCall(call3)

      const moduleCalls = graph.getCallsByFile('src/module.ts')
      expect(moduleCalls).toHaveLength(2)
      expect(moduleCalls[0].calleeSymbol).toBe('fetch')
      expect(moduleCalls[1].calleeSymbol).toBe('parse')
    })

    it('should return empty array for non-existent file', () => {
      const graph = new DependencyGraph()
      graph.addCall({
        callerFile: 'src/module.ts',
        calleeSymbol: 'fetch',
      })

      expect(graph.getCallsByFile('src/nonexistent.ts')).toEqual([])
    })
  })

  describe('getCallsToSymbol', () => {
    it('should filter calls by symbol name', () => {
      const graph = new DependencyGraph()
      const call1: CallSite = {
        callerFile: 'src/module.ts',
        calleeSymbol: 'fetch',
      }
      const call2: CallSite = {
        callerFile: 'src/utils.ts',
        calleeSymbol: 'fetch',
      }
      const call3: CallSite = {
        callerFile: 'src/data.ts',
        calleeSymbol: 'parse',
      }

      graph.addCall(call1)
      graph.addCall(call2)
      graph.addCall(call3)

      const fetchCalls = graph.getCallsToSymbol('fetch')
      expect(fetchCalls).toHaveLength(2)
      expect(fetchCalls[0].callerFile).toBe('src/module.ts')
      expect(fetchCalls[1].callerFile).toBe('src/utils.ts')
    })

    it('should return empty array for non-existent symbol', () => {
      const graph = new DependencyGraph()
      graph.addCall({
        callerFile: 'src/module.ts',
        calleeSymbol: 'fetch',
      })

      expect(graph.getCallsToSymbol('nonexistent')).toEqual([])
    })
  })

  describe('addInheritance and getInheritances', () => {
    it('should add and retrieve inheritances', () => {
      const graph = new DependencyGraph()
      const relation: InheritanceRelation = {
        childFile: 'src/models/user.ts',
        childClass: 'User',
        parentClass: 'BaseModel',
        kind: 'inherit',
      }

      graph.addInheritance(relation)
      const inheritances = graph.getInheritances()

      expect(inheritances).toHaveLength(1)
      expect(inheritances[0]).toEqual(relation)
    })

    it('should add multiple inheritances', () => {
      const graph = new DependencyGraph()
      const relation1: InheritanceRelation = {
        childFile: 'src/models/user.ts',
        childClass: 'User',
        parentClass: 'BaseModel',
        kind: 'inherit',
      }
      const relation2: InheritanceRelation = {
        childFile: 'src/interfaces/handler.ts',
        childClass: 'Handler',
        parentClass: 'EventEmitter',
        kind: 'implement',
      }

      graph.addInheritance(relation1)
      graph.addInheritance(relation2)

      expect(graph.getInheritances()).toHaveLength(2)
    })
  })

  describe('getInheritancesByChild', () => {
    it('should filter inheritances by child class name', () => {
      const graph = new DependencyGraph()
      const relation1: InheritanceRelation = {
        childFile: 'src/models/user.ts',
        childClass: 'User',
        parentClass: 'BaseModel',
        kind: 'inherit',
      }
      const relation2: InheritanceRelation = {
        childFile: 'src/models/admin.ts',
        childClass: 'Admin',
        parentClass: 'User',
        kind: 'inherit',
      }
      const relation3: InheritanceRelation = {
        childFile: 'src/models/guest.ts',
        childClass: 'Guest',
        parentClass: 'User',
        kind: 'inherit',
      }

      graph.addInheritance(relation1)
      graph.addInheritance(relation2)
      graph.addInheritance(relation3)

      const adminRelations = graph.getInheritancesByChild('Admin')
      expect(adminRelations).toHaveLength(1)
      expect(adminRelations[0].parentClass).toBe('User')
    })

    it('should return empty array for non-existent child class', () => {
      const graph = new DependencyGraph()
      graph.addInheritance({
        childFile: 'src/models/user.ts',
        childClass: 'User',
        parentClass: 'BaseModel',
        kind: 'inherit',
      })

      expect(graph.getInheritancesByChild('NonExistent')).toEqual([])
    })
  })

  describe('getInheritancesByParent', () => {
    it('should filter inheritances by parent class name', () => {
      const graph = new DependencyGraph()
      const relation1: InheritanceRelation = {
        childFile: 'src/models/admin.ts',
        childClass: 'Admin',
        parentClass: 'User',
        kind: 'inherit',
      }
      const relation2: InheritanceRelation = {
        childFile: 'src/models/moderator.ts',
        childClass: 'Moderator',
        parentClass: 'User',
        kind: 'inherit',
      }
      const relation3: InheritanceRelation = {
        childFile: 'src/models/user.ts',
        childClass: 'User',
        parentClass: 'BaseModel',
        kind: 'inherit',
      }

      graph.addInheritance(relation1)
      graph.addInheritance(relation2)
      graph.addInheritance(relation3)

      const userChildren = graph.getInheritancesByParent('User')
      expect(userChildren).toHaveLength(2)
      expect(userChildren[0].childClass).toBe('Admin')
      expect(userChildren[1].childClass).toBe('Moderator')
    })

    it('should return empty array for non-existent parent class', () => {
      const graph = new DependencyGraph()
      graph.addInheritance({
        childFile: 'src/models/user.ts',
        childClass: 'User',
        parentClass: 'BaseModel',
        kind: 'inherit',
      })

      expect(graph.getInheritancesByParent('NonExistent')).toEqual([])
    })
  })

  describe('getResult', () => {
    it('should return both calls and inheritances', () => {
      const graph = new DependencyGraph()

      const call: CallSite = {
        callerFile: 'src/module.ts',
        calleeSymbol: 'fetch',
      }
      const inheritance: InheritanceRelation = {
        childFile: 'src/models/user.ts',
        childClass: 'User',
        parentClass: 'BaseModel',
        kind: 'inherit',
      }

      graph.addCall(call)
      graph.addInheritance(inheritance)

      const result: DependencyGraphResult = graph.getResult()

      expect(result.calls).toHaveLength(1)
      expect(result.inheritances).toHaveLength(1)
      expect(result.calls[0]).toEqual(call)
      expect(result.inheritances[0]).toEqual(inheritance)
    })

    it('should return empty arrays when nothing added', () => {
      const graph = new DependencyGraph()
      const result = graph.getResult()

      expect(result.calls).toEqual([])
      expect(result.inheritances).toEqual([])
    })
  })

  describe('CallSite optional receiver fields', () => {
    it('should allow receiver field to be set on a CallSite', () => {
      const graph = new DependencyGraph()
      const call: CallSite = {
        callerFile: 'src/module.ts',
        calleeSymbol: 'doWork',
        receiver: 'self',
      }
      graph.addCall(call)
      const calls = graph.getCalls()
      expect(calls[0].receiver).toBe('self')
    })

    it('should allow receiverKind field to be set on a CallSite', () => {
      const graph = new DependencyGraph()
      const call: CallSite = {
        callerFile: 'src/module.ts',
        calleeSymbol: 'doWork',
        receiverKind: 'self',
      }
      graph.addCall(call)
      const calls = graph.getCalls()
      expect(calls[0].receiverKind).toBe('self')
    })

    it('should allow qualifiedName field to be set on a CallSite', () => {
      const graph = new DependencyGraph()
      const call: CallSite = {
        callerFile: 'src/module.ts',
        calleeSymbol: 'doWork',
        qualifiedName: 'MyClass.doWork',
      }
      graph.addCall(call)
      const calls = graph.getCalls()
      expect(calls[0].qualifiedName).toBe('MyClass.doWork')
    })

    it('should allow all three new fields together on a CallSite', () => {
      const graph = new DependencyGraph()
      const call: CallSite = {
        callerFile: 'src/module.ts',
        callerEntity: 'MyClass',
        calleeSymbol: 'helper',
        line: 10,
        receiver: 'self.helper',
        receiverKind: 'variable',
        qualifiedName: 'MyClass.helper',
      }
      graph.addCall(call)
      const calls = graph.getCalls()
      expect(calls[0].receiver).toBe('self.helper')
      expect(calls[0].receiverKind).toBe('variable')
      expect(calls[0].qualifiedName).toBe('MyClass.helper')
    })

    it('should have receiver, receiverKind, and qualifiedName undefined by default', () => {
      const graph = new DependencyGraph()
      const call: CallSite = {
        callerFile: 'src/module.ts',
        calleeSymbol: 'fetch',
      }
      graph.addCall(call)
      const calls = graph.getCalls()
      expect(calls[0].receiver).toBeUndefined()
      expect(calls[0].receiverKind).toBeUndefined()
      expect(calls[0].qualifiedName).toBeUndefined()
    })

    it('should support all receiverKind values', () => {
      const graph = new DependencyGraph()
      const kinds: Array<CallSite['receiverKind']> = ['self', 'super', 'variable', 'none']
      for (const kind of kinds) {
        const call: CallSite = {
          callerFile: 'src/module.ts',
          calleeSymbol: 'method',
          receiverKind: kind,
        }
        graph.addCall(call)
      }
      const calls = graph.getCalls()
      expect(calls[0].receiverKind).toBe('self')
      expect(calls[1].receiverKind).toBe('super')
      expect(calls[2].receiverKind).toBe('variable')
      expect(calls[3].receiverKind).toBe('none')
    })
  })

  describe('toDependencyEdges', () => {
    it('should convert calls to dependency edges', () => {
      const graph = new DependencyGraph()
      graph.addCall({
        callerFile: 'src/module.ts',
        callerEntity: 'process',
        calleeSymbol: 'fetch',
        line: 42,
      })

      const nodeResolver = (file: string, entity?: string) => {
        if (file === 'src/module.ts' && entity === 'process')
          return 'node:module:process'
        return null
      }

      const edges = graph.toDependencyEdges(nodeResolver)
      expect(edges).toHaveLength(1)
      expect(edges[0]).toMatchObject({
        source: 'node:module:process',
        dependencyType: 'call',
        symbol: 'fetch',
        line: 42,
      })
    })

    it('should skip calls with unresolved source nodes', () => {
      const graph = new DependencyGraph()
      graph.addCall({
        callerFile: 'src/module.ts',
        callerEntity: 'process',
        calleeSymbol: 'fetch',
      })

      const nodeResolver = () => null // Always returns null

      const edges = graph.toDependencyEdges(nodeResolver)
      expect(edges).toHaveLength(0)
    })

    it('should convert inheritances to dependency edges', () => {
      const graph = new DependencyGraph()
      graph.addInheritance({
        childFile: 'src/models/user.ts',
        childClass: 'User',
        parentClass: 'BaseModel',
        kind: 'inherit',
      })

      const nodeResolver = (file: string, entity?: string) => {
        if (file === 'src/models/user.ts' && entity === 'User')
          return 'node:models/user:User'
        return null
      }

      const edges = graph.toDependencyEdges(nodeResolver)
      expect(edges).toHaveLength(1)
      expect(edges[0]).toMatchObject({
        source: 'node:models/user:User',
        dependencyType: 'inherit',
      })
    })

    it('should set dependencyType to implement for implement kind', () => {
      const graph = new DependencyGraph()
      graph.addInheritance({
        childFile: 'src/interfaces/handler.ts',
        childClass: 'Handler',
        parentClass: 'EventEmitter',
        kind: 'implement',
      })

      const nodeResolver = (file: string, entity?: string) => {
        if (file === 'src/interfaces/handler.ts' && entity === 'Handler') {
          return 'node:interfaces/handler:Handler'
        }
        return null
      }

      const edges = graph.toDependencyEdges(nodeResolver)
      expect(edges).toHaveLength(1)
      expect(edges[0].dependencyType).toBe('implement')
    })

    it('should handle mixed calls and inheritances', () => {
      const graph = new DependencyGraph()
      graph.addCall({
        callerFile: 'src/module.ts',
        callerEntity: 'process',
        calleeSymbol: 'fetch',
      })
      graph.addInheritance({
        childFile: 'src/models/user.ts',
        childClass: 'User',
        parentClass: 'BaseModel',
        kind: 'inherit',
      })

      const nodeResolver = (file: string, entity?: string) => {
        if (file === 'src/module.ts' && entity === 'process')
          return 'node:module:process'
        if (file === 'src/models/user.ts' && entity === 'User')
          return 'node:models/user:User'
        return null
      }

      const edges = graph.toDependencyEdges(nodeResolver)
      expect(edges).toHaveLength(2)
      expect(edges.some(e => e.dependencyType === 'call')).toBe(true)
      expect(edges.some(e => e.dependencyType === 'inherit')).toBe(true)
    })

    it('should skip inheritances with unresolved source nodes', () => {
      const graph = new DependencyGraph()
      graph.addInheritance({
        childFile: 'src/models/user.ts',
        childClass: 'User',
        parentClass: 'BaseModel',
        kind: 'inherit',
      })

      const nodeResolver = () => null // Always returns null

      const edges = graph.toDependencyEdges(nodeResolver)
      expect(edges).toHaveLength(0)
    })
  })
})
